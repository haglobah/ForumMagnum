#!/usr/bin/env python3
"""Isolated ClickHouse-only pilot. No PostgreSQL driver or connection path.

Credentials/private selections are read locally and excluded from evidence.
Each mutation is journaled before execution. Never retry a failed INSERT:
inspect system.processes and table state before explicitly replacing its table.
"""
import argparse
import base64
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import http.client
import json
import os
from pathlib import Path
import random
import sys
import time
import urllib.parse
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent / 'portable'))
from queries import CASES, COLUMNS, literal, render, table_name
DB = 'benchmark_20260910'
ENDPOINT = 's4e9nqdfrf.us-east-1.aws.clickhouse.cloud'

# Keep these normalization functions equivalent to portable/runner.py without
# importing that module, which imports PostgreSQL-capable database drivers.
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



def raw_projection(source):
    table_name(source)
    def field(key):
        return f"JSONExtract(event,{literal(key)},'Nullable(String)')"
    path = f"CASE WHEN event_type='navigate' THEN {field('to')} WHEN event_type='pageLoadFinished' THEN {field('url')} ELSE {field('path')} END"
    path = f"replaceRegexpOne({path},'^https?://[^/]+','')"
    level = "if(JSONType(event,'expansionLevel')='Null',NULL,toDecimal128(if(JSONType(event,'expansionLevel')='String',JSONExtractString(event,'expansionLevel'),JSONExtractRaw(event,'expansionLevel')),6))"
    variant = "JSONExtract(event,'abTestGroups','welcomeBoxABTest','Nullable(String)')"
    values = ['id','timestamp','environment','event_type',field('userId'),field('clientId'),field('sessionId'),field('tabId'),path,field('feedItemId'),level,field('userAgent'),variant]
    return 'SELECT ' + ','.join(f'{v} AS {c}' for v,c in zip(values,COLUMNS)) + ' FROM ' + source


def sql_for(layout, case, profile, params, custom_windows=None):
    source = table_name(DB + '.' + layout)
    if layout.startswith('typed'):
        return render('clickhouse', case, profile, params, table=source, custom_windows=custom_windows)
    canonical = raw_projection(source)
    return render('clickhouse', case, profile, params, table='canonical_events', custom_windows=custom_windows).replace('WITH windows AS', f'WITH canonical_events AS ({canonical}), windows AS')


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2, default=str))
    temporary.replace(path)


class Client:
    def __init__(self):
        settings = {}
        for line in (ROOT / '.env.local').read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and not key.strip().startswith('#'):
                settings[key.strip()] = value.strip().strip(chr(34) + chr(39))
        settings.update(os.environ)
        self.secrets = [value for key, value in settings.items() if isinstance(value, str) and value and any(token in key.lower() for token in ('password', 'secret', 'key', 'connectionstring'))]
        self.auth = 'Basic ' + base64.b64encode((settings['CLICKHOUSE_USER'] + ':' + settings['CLICKHOUSE_PASSWORD']).encode()).decode()
        self.connection = None
        self.params = json.loads(Path('/tmp/analytics-benchmark/private-params.json').read_text())
        self.params.update(environment='lesswrong.com', experiment='welcomeBoxABTest')
        self.secrets.extend(self.params.values())

    def query(self, sql, timeout=180, mutation=False, query_id=None):
        query_id = query_id or 'pilot-' + str(uuid.uuid4())
        options = dict(max_execution_time=timeout, timeout_overflow_mode='throw', wait_end_of_query=1,
                       join_use_nulls=1, count_distinct_implementation='uniqExact', session_timezone='UTC',
                       use_query_cache=0, use_query_condition_cache=0, max_memory_usage=4000000000,
                       max_threads=2, query_id=query_id, readonly=0 if mutation else 1)
        start = time.perf_counter()
        try:
            if self.connection is None:
                self.connection = http.client.HTTPSConnection(ENDPOINT, 8443, timeout=15)
                self.connection.connect()
            if self.connection.sock:
                self.connection.sock.settimeout(timeout+30)
            self.connection.request('POST', '/?' + urllib.parse.urlencode(options), body=(sql if mutation else sql + ' FORMAT JSON').encode(), headers={'Authorization': self.auth, 'Content-Type':'text/plain'})
            response = self.connection.getresponse()
            body = response.read().decode()
            if response.status != 200: raise RuntimeError(body)
            payload = json.loads(body, parse_float=Decimal) if body.strip() else None
            rows = ch_rows(payload) if payload else []
            observation = dict(status='complete', query_id=query_id, elapsed_ms=(time.perf_counter()-start)*1000)
            if payload:
                observation.update(rows=len(rows), sha256=result_digest(rows), statistics=payload['statistics'])
            return observation, rows
        except Exception as error:
            if self.connection:
                self.connection.close()
                self.connection = None
            detail = str(error)
            for secret in sorted(self.secrets, key=len, reverse=True):
                if secret: detail = detail.replace(secret, '[REDACTED]')
            return dict(status='error', query_id=query_id, elapsed_ms=(time.perf_counter()-start)*1000, detail=detail[:2000]), None

    def mutate(self, label, sql, timeout=600):
        path = HERE / 'build-journal.json'
        journal = json.loads(path.read_text()) if path.exists() else []
        entry = dict(label=label, query_id='pilot-build-' + str(uuid.uuid4()), status='submitted', sql=sql, utc=datetime.now(timezone.utc).isoformat())
        journal.append(entry)
        save(path, journal)
        print('BUILD', label, entry['query_id'], flush=True)
        observation, _ = self.query(sql, timeout, mutation=True, query_id=entry['query_id'])
        entry.update(observation)
        save(path, journal)
        print('BUILD', label, observation, flush=True)
        if observation['status'] != 'complete': raise RuntimeError('Build failed; reconcile server state before retrying: ' + label)
        return observation


def metadata(client):
    statements = {
        'version': 'SELECT version()',
        'grants': 'SHOW GRANTS',
        'source': 'SHOW CREATE TABLE default.public_raw',
        'disks': 'SELECT name,total_space,free_space FROM system.disks',
        'source_parts': "SELECT count(),sum(rows),sum(bytes_on_disk) FROM system.parts WHERE database='default' AND table='public_raw' AND active",
        'running': "SELECT query_id,elapsed,read_rows,memory_usage FROM system.processes WHERE query_id LIKE 'pilot-%'",
        'tables': f"SELECT name,total_rows,total_bytes,sorting_key,partition_key FROM system.tables WHERE database='{DB}'",
    }
    report = {}
    for label, sql in statements.items():
        observation, rows = client.query(sql, timeout=30)
        print('METADATA', label, observation['status'], round(observation['elapsed_ms'],1), flush=True)
        report[label] = dict(observation=observation, rows=rows)
    save(HERE / 'metadata.json', report)
    print(json.dumps(report, default=str), flush=True)


def build(client, layout):
    client.mutate('database', f'CREATE DATABASE IF NOT EXISTS {DB}')
    source = DB + '.' + layout
    raw_fields = "id Nullable(Int64), timestamp DateTime64(6), environment String, event_type String, event String"
    if layout == 'raw':
        client.mutate('raw-create', f'CREATE TABLE {source} ({raw_fields}) ENGINE=MergeTree ORDER BY tuple()')
        client.mutate('raw-copy', f"INSERT INTO {source} SELECT id,timestamp,environment,event_type,event FROM default.public_raw PREWHERE timestamp>=toDateTime64('2026-08-31 00:00:00',6,'UTC') AND timestamp<toDateTime64('2026-09-08 00:05:00',6,'UTC') AND environment='lesswrong.com'", 900)
    elif layout in ('minmax', 'projection'):
        client.mutate(layout+'-create', f'CREATE TABLE {source} ({raw_fields}) ENGINE=MergeTree ORDER BY tuple()')
        client.mutate(layout+'-copy', f'INSERT INTO {source} SELECT * FROM {DB}.raw', 900)
        if layout == 'minmax':
            client.mutate('minmax-index', f'ALTER TABLE {source} ADD INDEX timestamp_minmax timestamp TYPE minmax GRANULARITY 1')
            client.mutate('minmax-materialize', f'ALTER TABLE {source} MATERIALIZE INDEX timestamp_minmax SETTINGS mutations_sync=2', 900)
        else:
            client.mutate('projection-add', f'ALTER TABLE {source} ADD PROJECTION time_order (SELECT _part_offset ORDER BY (environment,timestamp))')
            client.mutate('projection-materialize', f'ALTER TABLE {source} MATERIALIZE PROJECTION time_order SETTINGS mutations_sync=2', 900)
    elif layout == 'typed':
        fields = []
        for column in COLUMNS:
            kind = 'Nullable(Int64)' if column == 'event_id' else "DateTime64(6, 'UTC')" if column == 'occurred_at' else 'String' if column in ('environment','event_type') else 'Nullable(Decimal(38,6))' if column == 'expansion_level' else 'Nullable(String)'
            fields.append(column + ' ' + kind)
        client.mutate('typed-create', f"CREATE TABLE {source} ({','.join(fields)}) ENGINE=MergeTree PARTITION BY toYYYYMM(occurred_at) ORDER BY (environment,occurred_at,event_type)")
        client.mutate('typed-copy', f'INSERT INTO {source} ' + raw_projection(DB+'.raw'), 900)
    else:
        raise ValueError('Unknown layout')


def benchmark(client, layouts, repeats=3, passes=1, output='results.json'):
    path = HERE / output
    saved = json.loads((HERE.parent / '2026-09-10-cloud-results.json').read_text())
    baseline_path = HERE / 'baseline.json'
    baseline = json.loads(baseline_path.read_text()) if baseline_path.exists() else {'cases': {}}
    report = dict(started_utc=datetime.now(timezone.utc).isoformat(), settings=dict(result_cache=False,condition_cache=False,max_threads=2,max_memory_usage=4000000000), cases={})
    if path.exists(): report = json.loads(path.read_text())
    for pass_index in range(passes):
        jobs = [(layout, case, profile) for layout in layouts for case in CASES for profile in ('hour','day')]
        random.Random(1729+pass_index).shuffle(jobs)
        for layout, case, profile in jobs:
            key = layout + '/' + case + '/' + profile
            attempts = report['cases'].setdefault(key, [])
            old = saved['cases'].get(case+'/'+profile, {}).get('postgres', {}).get('attempts', [])
            pg_hashes = {a['sha256'] for a in old if a['status']=='complete'}
            for repeat in range(repeats+1):
                if any(a.get('pass') == pass_index and a.get('repeat') == repeat for a in attempts): continue
                observation, _ = client.query(sql_for(layout, case, profile, client.params), timeout=180)
                observation.update(warmup=repeat==0, repeat=repeat, **{'pass':pass_index})
                if observation['status']=='complete':
                    observation['matches_saved_postgres'] = observation['sha256'] in pg_hashes if pg_hashes else None
                    raw_hashes = {a['sha256'] for a in baseline['cases'].get('raw/'+case+'/'+profile, []) if a['status']=='complete'}
                    observation['matches_raw_baseline'] = observation['sha256'] in raw_hashes if raw_hashes else None
                attempts.append(observation)
                save(path, report)
                print(key, pass_index, repeat, observation['status'], round(observation['elapsed_ms'],1), observation.get('matches_saved_postgres'), flush=True)
                if observation['status']!='complete': break
                if observation.get('matches_saved_postgres') is False or observation.get('matches_raw_baseline') is False: raise RuntimeError('Result mismatch: '+key)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['metadata','build','benchmark'])
    parser.add_argument('--layouts', default='raw,minmax,projection,typed')
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--passes', type=int, default=1)
    parser.add_argument('--output', default='results.json')
    args = parser.parse_args()
    client = Client()
    if args.action == 'metadata': metadata(client)
    elif args.action == 'build':
        for layout in args.layouts.split(','): build(client, layout)
    else: benchmark(client, args.layouts.split(','), args.repeats, args.passes, args.output)

if __name__ == '__main__': main()
