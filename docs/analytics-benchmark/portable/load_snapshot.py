#!/usr/bin/env python3
"""Explicit setup/import into a NEW canonical table; never called by runner."""
import argparse
import base64
from datetime import datetime
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

import duckdb
import psycopg
import pymysql

from queries import COLUMNS, ENGINES, ddl, literal, table_name
from runner import digest


def ch_write(sql, data=b''):
    endpoint = os.environ['BENCH_CLICKHOUSE_URL']
    options = {'query': sql, 'wait_end_of_query': '1'}
    if os.getenv('BENCH_CLICKHOUSE_DATABASE'):
        options['database'] = os.environ['BENCH_CLICKHOUSE_DATABASE']
    headers = {}
    if os.getenv('BENCH_CLICKHOUSE_USER'):
        credentials = os.environ['BENCH_CLICKHOUSE_USER'] + ':' + os.getenv('BENCH_CLICKHOUSE_PASSWORD', '')
        headers['Authorization'] = 'Basic ' + base64.b64encode(credentials.encode()).decode()
    request = urllib.request.Request(endpoint + ('&' if '?' in endpoint else '?') + urllib.parse.urlencode(options), data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=300) as response:
        body = response.read()
    if body.strip():
        raise ValueError('Unexpected nonempty ClickHouse write response; verify table before retry')


def json_value(value):
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d %H:%M:%S.%f')
    if isinstance(value, Decimal):
        return str(value)
    return value


def verified_files(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    if digest(manifest['files']) != manifest['content_sha256']:
        raise ValueError('Manifest content checksum mismatch')
    files = []
    for entry in manifest['files']:
        path = directory / entry['file']
        if path.resolve().parent != directory.resolve():
            raise ValueError('Manifest file must be directly inside dataset directory')
        with path.open('rb') as stream:
            checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
        if checksum != entry['sha256']:
            raise ValueError('Parquet checksum mismatch: ' + entry['file'])
        files.append(path)
    if not files:
        raise ValueError('Empty snapshot has no Parquet files')
    return manifest, files


def load(args):
    table = table_name(args.table)
    manifest, files = verified_files(args.snapshot)
    source = duckdb.connect(':memory:')
    paths = '[' + ','.join(literal(str(path.resolve())) for path in files) + ']'
    source.execute(f'CREATE VIEW source_events AS SELECT * FROM read_parquet({paths})')
    counts = source.execute('SELECT count(*),count(DISTINCT event_id) FROM source_events').fetchone()
    if counts != (manifest['row_count'], manifest['row_count']):
        raise ValueError('Snapshot row count or unique event IDs invalid')
    actual = source.execute("SELECT strftime(occurred_at,'%Y-%m-%d'),environment,event_type,count(*) FROM source_events GROUP BY 1,2,3 ORDER BY 1,2,3").fetchall()
    expected = [(row['date'], row['environment'], row['event_type'], row['rows']) for row in manifest['daily_counts']]
    if actual != expected:
        raise ValueError('Snapshot daily counts differ from manifest')
    conn = None
    if args.engine == 'postgres':
        conn = psycopg.connect(os.environ['BENCH_POSTGRES_DSN'])
        conn.execute("SET timezone='UTC'")
        conn.execute(ddl(args.engine, table))
    elif args.engine == 'duckdb':
        conn = duckdb.connect(args.database)
        conn.execute(ddl(args.engine, table))
    elif args.engine == 'starrocks':
        conn = pymysql.connect(host=os.environ['BENCH_STARROCKS_HOST'], port=int(os.getenv('BENCH_STARROCKS_PORT', '9030')),
                               user=os.environ['BENCH_STARROCKS_USER'], password=os.getenv('BENCH_STARROCKS_PASSWORD', ''),
                               database=os.environ['BENCH_STARROCKS_DATABASE'], autocommit=True,
                               ssl={'ca': os.environ['BENCH_STARROCKS_SSL_CA']} if os.getenv('BENCH_STARROCKS_SSL_CA') else None)
        with conn.cursor() as cursor:
            cursor.execute("SET time_zone='+00:00'")
            cursor.execute(ddl(args.engine, table))
    else:
        ch_write(ddl(args.engine, table))
    loaded = 0
    try:
        source.execute('SELECT ' + ','.join(COLUMNS) + ' FROM source_events')
        while True:
            rows = source.fetchmany(args.batch_rows)
            if not rows:
                break
            if args.engine == 'postgres':
                with conn.cursor() as cursor:
                    with cursor.copy(f'COPY {table} (' + ','.join(COLUMNS) + ') FROM STDIN') as copy:
                        for row in rows:
                            copy.write_row(row)
            elif args.engine == 'duckdb':
                conn.executemany(f'INSERT INTO {table} VALUES (' + ','.join('?' for _ in COLUMNS) + ')', rows)
            elif args.engine == 'starrocks':
                with conn.cursor() as cursor:
                    cursor.executemany(f'INSERT INTO {table} VALUES (' + ','.join('%s' for _ in COLUMNS) + ')', rows)
            else:
                payload = '\n'.join(json.dumps(dict(zip(COLUMNS, [json_value(value) for value in row]))) for row in rows) + '\n'
                ch_write(f'INSERT INTO {table} FORMAT JSONEachRow', payload.encode())
            loaded += len(rows)
            print(f'Loaded {loaded} rows', flush=True)
        if args.engine == 'postgres':
            conn.commit()
        print('Load complete; run coverage and differential result checks before comparing performance.')
    finally:
        source.close()
        if conn is not None:
            conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=ENGINES, required=True)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--table', default='events')
    parser.add_argument('--database', default='analytics.duckdb')
    parser.add_argument('--batch-rows', type=int, default=1000)
    args = parser.parse_args()
    if args.batch_rows < 1:
        parser.error('batch rows must be positive')
    load(args)


if __name__ == '__main__':
    main()
