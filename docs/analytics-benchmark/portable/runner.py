#!/usr/bin/env python3
"""Explicit, read-only analytical benchmark; setup/load are separate commands."""
import argparse
import base64
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import random
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import duckdb
import psycopg
import pymysql

from queries import CASES, ENGINES, PROFILES, ddl, literal, render, table_name, windows


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def scalar(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return ['bool', value]
    if isinstance(value, (int, Decimal)):
        number = Decimal(value)
        return ['number', format(number.normalize(), 'f')]
    if isinstance(value, float):
        raise ValueError('Unexpected float in exact aggregate results')
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return ['timestamp', value.isoformat(timespec='microseconds')]
    return ['string', str(value)]


def result_digest(rows):
    # Canonicalize an unordered multiset, preserving duplicate rows and nulls.
    normalized = [[scalar(value) for value in row] for row in rows]
    normalized.sort(key=lambda row: json.dumps(row, sort_keys=True))
    return digest(normalized)


def ch_rows(payload):
    if not isinstance(payload, dict) or not all(key in payload for key in ('meta', 'data', 'rows', 'statistics')):
        raise ValueError('Incomplete ClickHouse response')
    if len(payload['data']) != payload['rows']:
        raise ValueError('Truncated ClickHouse result')
    rows = []
    for row in payload['data']:
        converted = []
        for field in payload['meta']:
            value = row[field['name']]
            kind = field['type'].replace('Nullable(', '').rstrip(')')
            if value is not None and (kind.startswith('UInt') or kind.startswith('Int')):
                value = int(value)
            elif value is not None and kind.startswith('Decimal'):
                value = Decimal(str(value))
            elif value is not None and kind.startswith('DateTime'):
                value = datetime.fromisoformat(value)
            converted.append(value)
        rows.append(tuple(converted))
    return rows


def ch_request(sql, timeout, query_id):
    endpoint = os.environ['BENCH_CLICKHOUSE_URL']
    settings = {'query_id': query_id, 'readonly': '1', 'max_execution_time': str(timeout),
                'timeout_overflow_mode': 'throw', 'wait_end_of_query': '1',
                'join_use_nulls': '1', 'count_distinct_implementation': 'uniqExact',
                'session_timezone': 'UTC', 'use_query_cache': '0'}
    if os.getenv('BENCH_CLICKHOUSE_DATABASE'):
        settings['database'] = os.environ['BENCH_CLICKHOUSE_DATABASE']
    url = endpoint + ('&' if '?' in endpoint else '?') + urllib.parse.urlencode(settings)
    headers = {'Content-Type': 'text/plain; charset=utf-8'}
    if os.getenv('BENCH_CLICKHOUSE_USER'):
        auth = os.environ['BENCH_CLICKHOUSE_USER'] + ':' + os.getenv('BENCH_CLICKHOUSE_PASSWORD', '')
        headers['Authorization'] = 'Basic ' + base64.b64encode(auth.encode()).decode()
    request = urllib.request.Request(url, data=(sql + ' FORMAT JSON').encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=timeout + 15) as response:
        body = response.read()
    # JSON decoding rejects a late HTTP 200 exception appended after partial data.
    return ch_rows(json.loads(body, parse_float=Decimal))


def connect(engine, args):
    if engine == 'postgres':
        conn = psycopg.connect(os.environ['BENCH_POSTGRES_DSN'], autocommit=True)
        conn.execute("SET timezone='UTC'")
        conn.execute('SET default_transaction_read_only=on')
        conn.execute(f'SET statement_timeout={args.timeout * 1000}')
        version = conn.execute('SELECT version()').fetchone()[0]
    elif engine == 'duckdb':
        if args.parquet:
            conn = duckdb.connect(':memory:')
            conn.execute(f'CREATE VIEW {table_name(args.table)} AS SELECT * FROM read_parquet({literal(str(Path(args.parquet).resolve()))})')
        else:
            conn = duckdb.connect(args.database, read_only=True)
        conn.execute("SET TimeZone='UTC'")
        conn.execute(f'SET threads={args.threads}')
        version = conn.execute('SELECT version()').fetchone()[0]
    elif engine == 'starrocks':
        conn = pymysql.connect(host=os.environ['BENCH_STARROCKS_HOST'],
                               port=int(os.getenv('BENCH_STARROCKS_PORT', '9030')),
                               user=os.environ['BENCH_STARROCKS_USER'],
                               password=os.getenv('BENCH_STARROCKS_PASSWORD', ''),
                               database=os.environ['BENCH_STARROCKS_DATABASE'],
                               autocommit=True, connect_timeout=15,
                               read_timeout=args.timeout + 15,
                               ssl={'ca': os.environ['BENCH_STARROCKS_SSL_CA']} if os.getenv('BENCH_STARROCKS_SSL_CA') else None)
        with conn.cursor() as cursor:
            cursor.execute("SET time_zone='+00:00'")
            cursor.execute(f'SET query_timeout={args.timeout}')
            cursor.execute('SET enable_query_cache=false')
            cursor.execute('SELECT current_version()')
            version = cursor.fetchone()[0]
    else:
        conn = None
        version = ch_request('SELECT version() AS version', args.timeout, str(uuid.uuid4()))[0][0]
    return conn, version


def execute(engine, conn, sql, timeout):
    if engine == 'clickhouse':
        return ch_request(sql, timeout, str(uuid.uuid4()))
    if engine == 'duckdb':
        timer = threading.Timer(timeout, conn.interrupt)
        timer.start()
        try:
            return conn.execute(sql).fetchall()
        finally:
            timer.cancel()
            timer.join()
    with conn.cursor() as cursor:
        cursor.execute(sql)
        return cursor.fetchall()


def failure_status(error):
    if isinstance(error, psycopg.errors.QueryCanceled):
        return 'timed_out'
    if isinstance(error, duckdb.InterruptException):
        return 'timed_out'
    if isinstance(error, pymysql.err.OperationalError) and error.args:
        if error.args[0] == 5024:
            # StarRocks ER_QUERY_TIMEOUT, observed on 4.1.4.
            return 'timed_out'
        if error.args[0] in (2006, 2013):
            return 'transport_failed'
    text = str(error).lower()
    if 'timeout_exceeded' in text or 'query timeout' in text or 'query timed out' in text:
        return 'timed_out'
    # A transport timeout is not evidence that server execution was cancelled.
    if isinstance(error, TimeoutError) or 'timed out' in text:
        return 'transport_failed'
    return 'failed'


def attempt(engine, conn, sql, timeout, case=None, expected_windows=None):
    started = time.perf_counter()
    try:
        rows = execute(engine, conn, sql, timeout)
        elapsed = time.perf_counter() - started
        primary_count = {'traffic_hour': 3, 'traffic_day': 3, 'event_counts': 2, 'user': 2, 'session': 2, 'tab': 2, 'post_paths': 2, 'feature_counts': 2, 'feature_funnel': 1, 'ab_assignments': 2, 'ab_outcome': 2, 'ua_bot': 2, 'metadata_join': 4, 'ssr_association': 1, 'coverage': 1}.get(case)
        nonempty_windows = {row[0] for row in rows if primary_count is None or int(row[primary_count]) > 0}
        return {'status': 'complete' if nonempty_windows else 'empty', 'elapsed_ms': elapsed * 1000,
                'window_coverage_complete': expected_windows is None or set(expected_windows) <= nonempty_windows,
                'result_rows': len(rows), 'result_sha256': result_digest(rows)}
    except Exception as error:
        if isinstance(error, urllib.error.HTTPError):
            # Inspect server code but never persist bodies which may echo identities.
            server_error = error.read().decode(errors='replace')
            status = 'timed_out' if 'TIMEOUT_EXCEEDED' in server_error else 'failed'
        else:
            status = failure_status(error)
        return {'status': status, 'elapsed_ms': (time.perf_counter() - started) * 1000,
                'error_type': type(error).__name__,
                'timeout_seconds': timeout,
                'server_cancellation_confirmed': status == 'timed_out'}


def summarize(attempts):
    values = [a['elapsed_ms'] for a in attempts if a['status'] == 'complete' and not a['warmup']]
    measured = [a for a in attempts if not a['warmup']]
    return {'median_complete_ms': statistics.median(values) if values else None,
            'counts': {status: sum(a['status'] == status for a in measured) for status in
                       ('complete', 'empty', 'timed_out', 'transport_failed', 'failed')},
            'stable_result': len({a.get('result_sha256') for a in measured if a['status'] in ('complete', 'empty')}) <= 1}


def compare(reference, candidate):
    required = ('dataset_sha256', 'parameters_sha256', 'semantics_version', 'renderer_sha256')
    if any(reference[key] != candidate[key] for key in required):
        raise ValueError('Different dataset, parameters, or semantics: comparison refused')
    results = []
    for key in sorted(set(reference['cases']) & set(candidate['cases'])):
        left = reference['cases'][key]
        right = candidate['cases'][key]
        a = [x for x in left['attempts'] if not x['warmup']]
        b = [x for x in right['attempts'] if not x['warmup']]
        hashes = {x.get('result_sha256') for x in a + b}
        valid = bool(a and b) and all(x['status'] == 'complete' and x.get('window_coverage_complete', False) for x in a + b) and len(hashes) == 1
        results.append({'case': key, 'comparable_complete_results': valid,
                        'result_hashes_match': len(hashes) == 1 and None not in hashes,
                        'reason': 'complete matching results' if valid else 'Inspect attempts: incomplete/empty windows, failed repetitions, or differing result hashes',
                        'reference_median_ms': left['summary']['median_complete_ms'] if valid else None,
                        'candidate_median_ms': right['summary']['median_complete_ms'] if valid else None})
    return results


def validate_manifest(manifest, params, profiles):
    if manifest.get('environment') != params.get('environment', 'lesswrong.com'):
        raise ValueError('Environment differs from frozen snapshot')
    available = [(datetime.fromisoformat(a), datetime.fromisoformat(b)) for a, b in manifest['coverage']]
    if any(a.tzinfo is None or b.tzinfo is None for a, b in available):
        raise ValueError('Manifest coverage timestamps must include UTC offsets')
    for profile in profiles:
        for label, start, end in windows(profile):
            # All cases share a dataset with enough metadata/follow-up context.
            from_start = start.timestamp() - 604800
            to_end = end.timestamp() + 300
            if not any(a.timestamp() <= from_start and b.timestamp() >= to_end for a, b in available):
                raise ValueError('Snapshot does not cover window and enrichment halo: ' + label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('render', 'ddl', 'run', 'compare'))
    parser.add_argument('--engine', choices=ENGINES)
    parser.add_argument('--case', choices=CASES, action='append')
    parser.add_argument('--profile', choices=PROFILES, action='append')
    parser.add_argument('--params', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--table', default='events')
    parser.add_argument('--database', default='analytics.duckdb')
    parser.add_argument('--parquet', help='Local path/glob; DuckDB creates an in-memory view before timing')
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--timeout', type=int, default=60)
    parser.add_argument('--warmups', type=int, default=0)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--seed', type=int, default=1729)
    parser.add_argument('--cache-label', default='uncontrolled')
    parser.add_argument('--layout', default='canonical-typed')
    parser.add_argument('--resources', required=False, help='Describe CPU/RAM/storage and engine tuning; recorded verbatim, no secrets')
    args = parser.parse_args()
    if args.command == 'compare':
        if not args.reference or not args.output:
            parser.error('compare needs --reference and --output (candidate result file)')
        print(json.dumps(compare(json.loads(args.reference.read_text()), json.loads(args.output.read_text())), indent=2))
        return
    if not args.engine:
        parser.error('--engine is required')
    if args.command == 'ddl':
        print(ddl(args.engine, args.table))
        return
    if not args.case or not args.profile or not args.params:
        parser.error('Specify --case, --profile and --params; full matrix is never implicit')
    params = json.loads(args.params.read_text())
    queries = {(case + '/' + profile): render(args.engine, case, profile, params, args.table)
               for case in args.case for profile in args.profile}
    if args.command == 'render':
        for key, sql in queries.items():
            print('-- ' + key + '\n' + sql + ';\n')
        return
    if not args.manifest or not args.output or not args.resources:
        parser.error('run requires --manifest, --output and --resources')
    if args.timeout < 1 or args.repeats < 1 or args.warmups < 0 or args.threads < 1:
        parser.error('Invalid timeout/repeats/warmups/threads')
    manifest = json.loads(args.manifest.read_text())
    for field in ('dataset_id', 'snapshot', 'experiment', 'coverage', 'row_count', 'content_sha256'):
        if field not in manifest:
            parser.error('Manifest missing ' + field)
    if manifest['experiment'] != params.get('experiment'):
        parser.error('Manifest and parameters must specify the same experiment')
    validate_manifest(manifest, params, args.profile)
    conn, version = connect(args.engine, args)
    report = {'semantics_version': 1, 'renderer_sha256': hashlib.sha256(Path(__file__).with_name('queries.py').read_bytes()).hexdigest(), 'engine': args.engine, 'version': version,
              'dataset_sha256': digest(manifest), 'parameters_sha256': digest(params),
              'started_at': datetime.now(timezone.utc).isoformat(), 'resources': args.resources,
              'layout': args.layout, 'cache_label': args.cache_label, 'concurrency': 1,
              'seed': args.seed, 'timeout_seconds': args.timeout, 'threads': args.threads if args.engine == 'duckdb' else None,
              'timing': 'client execute + complete fetch; hashing excluded; HTTP connection included for ClickHouse, SQL connection setup excluded for other engines', 'cases': {}}
    rng = random.Random(args.seed)
    try:
        for iteration in range(args.warmups + args.repeats):
            order = list(queries)
            rng.shuffle(order)
            for key in order:
                case, profile = key.split('/')
                outcome = attempt(args.engine, conn, queries[key], args.timeout, case, [window[0] for window in windows(profile)])
                outcome.update({'warmup': iteration < args.warmups, 'iteration': iteration})
                entry = report['cases'].setdefault(key, {'query_sha256': digest(queries[key]), 'attempts': []})
                entry['attempts'].append(outcome)
                entry['summary'] = summarize(entry['attempts'])
                args.output.parent.mkdir(parents=True, exist_ok=True)
                temporary = args.output.with_suffix(args.output.suffix + '.tmp')
                temporary.write_text(json.dumps(report, indent=2) + '\n')
                temporary.replace(args.output)
                print(key, outcome['status'], round(outcome['elapsed_ms'], 2), flush=True)
                if outcome['status'] == 'transport_failed':
                    raise RuntimeError('Transport failure: stop and verify server query cancellation before rerunning')
    finally:
        if conn is not None:
            conn.close()


if __name__ == '__main__':
    main()
