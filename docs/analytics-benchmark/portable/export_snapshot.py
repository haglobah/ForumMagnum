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

import duckdb
import psycopg

from queries import COLUMNS, PROFILES, ddl, literal, windows
from runner import digest


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


def export(args):
    if args.output.exists():
        raise ValueError('Output must not exist; prevents mixing snapshots')
    intervals = merged_intervals(args.profile)
    predicate = ' OR '.join('(timestamp >= %s AND timestamp < %s)' for _ in intervals)
    values = [args.environment]
    for start, end in intervals:
        values.extend([start, end])
    query = f'SELECT id,timestamp,environment,event_type,event FROM public.raw WHERE environment=%s AND ({predicate})'
    args.output.mkdir(parents=True)
    db = duckdb.connect(':memory:')
    db.execute(ddl('duckdb'))
    counts = Counter()
    files = []
    row_count = 0
    min_id = None
    max_id = None
    with psycopg.connect(os.environ['BENCH_POSTGRES_DSN']) as source:
        source.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        source.execute("SET LOCAL timezone='UTC'")
        source.execute(f'SET LOCAL statement_timeout={args.timeout * 1000}')
        snapshot = source.execute('SELECT pg_current_snapshot()::text,current_timestamp').fetchone()
        with source.cursor(name='analytics_portable_export') as cursor:
            cursor.execute(query, values)
            while True:
                raw = cursor.fetchmany(args.batch_rows)
                if not raw:
                    break
                batch = [normalize(row, args.experiment) for row in raw]
                db.executemany('INSERT INTO events VALUES (' + ','.join('?' for _ in COLUMNS) + ')', batch)
                filename = f'part-{len(files):06d}.parquet'
                destination = args.output / filename
                db.execute(f"COPY events TO {literal(str(destination.resolve()))} (FORMAT PARQUET, COMPRESSION ZSTD)")
                db.execute('DELETE FROM events')
                files.append({'file': filename, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'rows': len(batch)})
                for row in batch:
                    counts[(row[1].strftime('%Y-%m-%d'), row[2], row[3])] += 1
                    min_id = row[0] if min_id is None else min(min_id, row[0])
                    max_id = row[0] if max_id is None else max(max_id, row[0])
                row_count += len(batch)
                print(f'Exported {row_count} rows', flush=True)
    db.close()
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
    args = parser.parse_args()
    if args.batch_rows < 1 or args.timeout < 1:
        parser.error('batch size and timeout must be positive')
    export(args)


if __name__ == '__main__':
    main()
