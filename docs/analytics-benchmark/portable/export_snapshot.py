#!/usr/bin/env python3
"""Explicit bounded PostgreSQL raw -> canonical Parquet snapshot (writes local files)."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import threading
import time

import psycopg
import pyarrow as pa
import pyarrow.parquet as pq

from queries import COLUMNS, PROFILES, windows
from runner import digest


PARQUET_SCHEMA = pa.schema([
    pa.field(column, pa.int64(), nullable=False) if column == 'event_id' else
    pa.field(column, pa.timestamp('us'), nullable=False) if column == 'occurred_at' else
    pa.field(column, pa.decimal128(18, 6)) if column == 'expansion_level' else
    pa.field(column, pa.string())
    for column in COLUMNS
])


def write_batch(batch, destination):
    """Write already normalized rows without per-row SQL insertion or type inference."""
    columns = list(zip(*batch)) if batch else [[] for _ in COLUMNS]
    arrays = [pa.array(values, type=field.type) for values, field in zip(columns, PARQUET_SCHEMA)]
    table = pa.Table.from_arrays(arrays, schema=PARQUET_SCHEMA)
    pq.write_table(table, destination, compression='zstd', store_decimal_as_integer=True)


def phase_summary(progress):
    timings = progress.get('timings', {})
    return ' | phases ' + ', '.join(f'{phase} {seconds:.2f}s' for phase, seconds in timings.items()) if timings else ''


def merged_intervals(profiles):
    intervals = sorted((start - timedelta(days=7), end + timedelta(minutes=5))
                       for profile in profiles for _, start, end in windows(profile))
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def normalize(row, experiment):
    event_id, occurred_at, environment, event_type, event = row
    if not isinstance(event_id, int):
        raise ValueError('Source event id must be an exact integer')
    if not -(2**63) <= event_id < 2**63:
        raise ValueError('Source id outside signed BIGINT range')
    if occurred_at.tzinfo is not None:
        occurred_at = occurred_at.astimezone(timezone.utc).replace(tzinfo=None)
    if not isinstance(event, dict):
        raise ValueError('Event must be a JSON object')
    path_key = 'to' if event_type == 'navigate' else 'url' if event_type == 'pageLoadFinished' else 'path'
    path = event.get(path_key)
    if path is not None:
        if not isinstance(path, str):
            raise ValueError('Expected string path')
        path = re.sub(r'^https?://[^/]+', '', path)
    fields = []
    for key in ('userId', 'clientId', 'sessionId', 'tabId'):
        value = event.get(key)
        if value is not None and not isinstance(value, str):
            raise ValueError('Expected string identity: ' + key)
        fields.append(value)
    level = event.get('expansionLevel')
    level = Decimal(str(level)) if level is not None else None
    if level is not None and (not level.is_finite() or abs(level) >= Decimal('1000000000000') or level != level.quantize(Decimal('0.000001'))):
        raise ValueError('expansionLevel not representable exactly as DECIMAL(18,6)')
    ab_groups = event.get('abTestGroups')
    variant = ab_groups.get(experiment) if isinstance(ab_groups, dict) else None
    for value in (event.get('feedItemId'), event.get('userAgent'), variant):
        if value is not None and not isinstance(value, str):
            raise ValueError('Expected nullable string for item/UA/experiment variant')
    return (event_id, occurred_at, environment, event_type, *fields, path,
            event.get('feedItemId'), level, event.get('userAgent'), variant)


def duration(seconds):
    minutes, seconds = divmod(max(0, int(seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d}'


def progress_line(progress):
    elapsed = time.monotonic() - progress['started']
    total = progress.get('total')
    rows = progress.get('rows', 0)
    if total is None:
        return f"{progress['phase']} | elapsed {duration(elapsed)} | ETA pending"
    export_elapsed = time.monotonic() - progress['export_started']
    rate = rows / export_elapsed if export_elapsed > 0 else 0
    fraction = rows / total if total else 1
    filled = min(24, int(fraction * 24))
    eta = duration((total - rows) / rate) if rate else 'pending first batch'
    approximate = progress.get('approximate', False)
    if approximate and rows >= total:
        eta = 'row estimate exceeded; pending completion'
    return (f"[{('#' * filled).ljust(24, '-')}] {fraction:6.1%} | "
            f"{rows:,}/{'~' if approximate else ''}{total:,} rows | {rate:,.0f} rows/s | "
            f'elapsed {duration(elapsed)} | ETA {eta}' + phase_summary(progress))


def report_progress(progress, stop):
    while not stop.is_set():
        print(('\r\033[2K' if sys.stderr.isatty() else '') + progress_line(progress),
              end='' if sys.stderr.isatty() else '\n', file=sys.stderr, flush=True)
        stop.wait(1 if sys.stderr.isatty() else 10)
    if sys.stderr.isatty():
        print(file=sys.stderr, flush=True)


def export(args):
    progress = {'started': time.monotonic(), 'phase': 'Connecting'}
    stop = threading.Event()
    reporter = threading.Thread(target=report_progress, args=(progress, stop), daemon=True)
    if args.progress:
        reporter.start()
    try:
        export_snapshot(args, progress)
    finally:
        stop.set()
        if args.progress:
            reporter.join()
    print(f"Complete: {progress['rows']:,} rows in {duration(time.monotonic() - progress['started'])}. "
          f"Manifest: {args.output / 'manifest.json'}" + phase_summary(progress), flush=True)


def export_snapshot(args, progress):
    if args.output.exists():
        raise ValueError('Output must not exist; prevents mixing snapshots')
    intervals = merged_intervals(args.profile)
    predicate = ' OR '.join('(timestamp >= %s AND timestamp < %s)' for _ in intervals)
    values = [args.environment]
    for start, end in intervals:
        values.extend([start, end])
    query = f'SELECT id,timestamp,environment,event_type,event FROM public.raw WHERE environment=%s AND ({predicate})'
    args.output.mkdir(parents=True)
    timings = dict.fromkeys(('fetch', 'normalize', 'write', 'accounting'), 0.0)
    progress['timings'] = timings.copy()
    counts = Counter()
    files = []
    row_count = 0
    min_id = None
    max_id = None
    with psycopg.connect(
        os.environ['BENCH_POSTGRES_DSN'],
        application_name='analytics_snapshot_export',
        connect_timeout=10,
        keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=3,
        tcp_user_timeout=60000,
    ) as source:
        source.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        source.execute("SET LOCAL timezone='UTC'")
        source.execute(f'SET LOCAL statement_timeout={args.timeout * 1000}')
        if args.read_strategy == 'bitmap':
            # Bulk exports can benefit from reading heap pages in physical order
            # with prefetching instead of following one index entry at a time.
            source.execute('SET LOCAL enable_indexscan=off')
            source.execute("SET LOCAL work_mem='64MB'")
            source.execute('SET LOCAL effective_io_concurrency=32')
            source.execute('SET LOCAL cursor_tuple_fraction=1.0')
        snapshot = source.execute('SELECT pg_current_snapshot()::text,current_timestamp').fetchone()
        if args.progress:
            if args.exact_count:
                progress['phase'] = 'Counting matching rows (including join lookback/follow-up)'
                total = source.execute(f'SELECT count(*) FROM public.raw WHERE environment=%s AND ({predicate})', values).fetchone()[0]
            else:
                progress['phase'] = 'Estimating matching rows from query plan'
                plan = source.execute('EXPLAIN (FORMAT JSON) ' + query, values).fetchone()[0]
                total = plan[0]['Plan']['Plan Rows']
                progress['approximate'] = True
            progress['export_started'] = time.monotonic()
            progress['total'] = total
        progress['rows'] = 0
        with source.cursor(name='analytics_portable_export') as cursor:
            cursor.execute(query, values)
            while True:
                phase_started = time.monotonic()
                raw = cursor.fetchmany(args.batch_rows)
                timings['fetch'] += time.monotonic() - phase_started
                if not raw:
                    progress['timings'] = timings.copy()
                    break
                phase_started = time.monotonic()
                batch = [normalize(row, args.experiment) for row in raw]
                timings['normalize'] += time.monotonic() - phase_started
                filename = f'part-{len(files):06d}.parquet'
                destination = args.output / filename
                phase_started = time.monotonic()
                write_batch(batch, destination)
                timings['write'] += time.monotonic() - phase_started
                phase_started = time.monotonic()
                files.append({'file': filename, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'rows': len(batch)})
                for row in batch:
                    counts[(row[1].date().isoformat(), row[2], row[3])] += 1
                    min_id = row[0] if min_id is None else min(min_id, row[0])
                    max_id = row[0] if max_id is None else max(max_id, row[0])
                row_count += len(batch)
                timings['accounting'] += time.monotonic() - phase_started
                progress['timings'] = timings.copy()
                progress['rows'] = row_count
                if not args.progress:
                    print(f'Exported {row_count} rows' + phase_summary(progress), flush=True)
    manifest = {'dataset_id': args.dataset_id, 'schema_version': 1,
                'snapshot': {'postgres_snapshot': snapshot[0], 'started_at': snapshot[1].isoformat(),
                             'isolation': 'repeatable read; one transaction',
                             'min_event_id': min_id, 'max_event_id': max_id,
                             'note': 'IDs are identities, not commit-order checkpoints'},
                'experiment': args.experiment, 'environment': args.environment,
                'profiles': args.profile, 'row_count': row_count,
                'coverage': [[start.isoformat(), end.isoformat()] for start, end in intervals],
                'daily_counts': [{'date': key[0], 'environment': key[1], 'event_type': key[2], 'rows': count} for key, count in sorted(counts.items())],
                'files': files, 'content_sha256': digest(files)}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', choices=PROFILES, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dataset-id', required=True)
    parser.add_argument('--environment', default='lesswrong.com')
    parser.add_argument('--experiment', default='welcomeBoxABTest')
    parser.add_argument('--batch-rows', type=int, default=10000)
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--read-strategy', choices=('default', 'bitmap'), default='default',
                        help='bitmap discourages index scans and enables prefetching using session-only settings; planner may choose a sequential scan')
    parser.add_argument('--progress', action='store_true', help='Show percentage, throughput and ETA using an approximate planner row total')
    parser.add_argument('--exact-count', action='store_true', help='With --progress, run an extra full count for an exact total (can be slow)')
    args = parser.parse_args()
    if args.batch_rows < 1 or args.timeout < 1:
        parser.error('batch size and timeout must be positive')
    export(args)


if __name__ == '__main__':
    main()
