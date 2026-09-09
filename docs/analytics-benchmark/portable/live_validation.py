#!/usr/bin/env python3
"""Run disposable local ClickHouse/StarRocks against a synthetic DuckDB reference.

Requires Docker and requirements.txt. Never connects to the analytics database.
Images may be supplied by immutable digest; see live-validation-results.json.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from types import SimpleNamespace
import uuid
import urllib.error

import duckdb

from load_snapshot import load
from queries import CASES, COLUMNS, PROFILES, ddl, render, windows
from runner import attempt, connect, execute, result_digest
from test_suite import PARAMS, START, check_results, fixture, write_fixture


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def port(container, internal):
    return int(docker('port', container, str(internal) + '/tcp').rsplit(':', 1)[1])


def extended_fixture():
    original = fixture()
    rows = list(original)
    for index, (_, start, _) in enumerate(windows('monthly24')):
        shift = start - START
        for event in original:
            row = list(event)
            row[0] += (index + 1) * 10000
            row[1] += shift
            # Keep selected identities populated. September 1 metadata can also
            # enrich September 7; the reference checks that overlap explicitly.
            rows.append(tuple(row))
    return rows


def wait_ready(engine, args, seconds=240):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            conn, version = connect(engine, args)
            if engine == 'starrocks':
                with conn.cursor() as cursor:
                    cursor.execute('SHOW BACKENDS')
                    columns = [column[0] for column in cursor.description]
                    backends = [dict(zip(columns, row)) for row in cursor.fetchall()]
                    if not any(str(row['Alive']).lower() == 'true' for row in backends):
                        conn.close()
                        time.sleep(2)
                        continue
            return conn, version
        except Exception:
            time.sleep(2)
    raise RuntimeError(engine + ' did not become ready within timeout')


def validate(engine, conn, reference, timeout):
    raw_sql = 'SELECT ' + ','.join(COLUMNS) + ' FROM events'
    actual = execute(engine, conn, raw_sql, timeout)
    expected = reference.execute(raw_sql).fetchall()
    assert result_digest(actual) == result_digest(expected), engine + ': imported canonical rows differ'
    results = []
    for profile in PROFILES:
        for case in CASES:
            expected = reference.execute(render('duckdb', case, profile, PARAMS)).fetchall()
            try:
                actual = execute(engine, conn, render(engine, case, profile, PARAMS), timeout)
            except urllib.error.HTTPError as error:
                raise RuntimeError((engine, case, profile, error.read().decode())) from error
            assert result_digest(actual) == result_digest(expected), (engine, case, profile, actual, expected)
            results.append({'case': case, 'profile': profile, 'rows': len(actual), 'sha256': result_digest(actual)})
        print(engine + ': ' + profile + ' all 15 cases match', flush=True)
    smoke = attempt(engine, conn, render(engine, 'metadata_join', 'hour', PARAMS), timeout, case='metadata_join', expected_windows=['hour'])
    assert smoke['status'] == 'complete' and smoke['window_coverage_complete'], smoke
    assert smoke['result_sha256'] == result_digest(reference.execute(render('duckdb', 'metadata_join', 'hour', PARAMS)).fetchall())
    return {'runner_smoke': smoke, 'canonical_rows': reference.execute('SELECT count(*) FROM events').fetchone()[0],
            'canonical_sha256': result_digest(reference.execute(raw_sql).fetchall()), 'cases': results}



def validate_timeout(engine, conn):
    tag = 'live_timeout_' + uuid.uuid4().hex
    if engine == 'clickhouse':
        sql = f'/* {tag} */ SELECT sum(cityHash64(number)) FROM numbers(1000000000000)'
    else:
        with conn.cursor() as cursor:
            cursor.execute('SET query_timeout=1')
        sql = f'/* {tag} */ SELECT sum(a.event_id ^ b.event_id ^ c.event_id ^ d.event_id ^ e.event_id) FROM events a CROSS JOIN events b CROSS JOIN events c CROSS JOIN events d CROSS JOIN events e'
    outcome = attempt(engine, conn, sql, 1)
    assert outcome['status'] == 'timed_out', (engine, 'timeout not confirmed', outcome)
    assert execute(engine, conn, 'SELECT 1', 10)[0][0] == 1
    if engine == 'clickhouse':
        active = execute(engine, conn, f"SELECT count(*) FROM system.processes WHERE position(query,'{tag}')>0 AND position(query,'system.processes')=0", 10)[0][0]
    else:
        with conn.cursor() as cursor:
            cursor.execute('SHOW PROCESSLIST')
            active = sum(tag in str(row) for row in cursor.fetchall())
            cursor.execute('SET query_timeout=60')
    assert active == 0, (engine, 'timed-out query remains active')
    outcome.update(health_query_passed=True, active_queries_after_timeout=active)
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clickhouse-image', default='clickhouse/clickhouse-server@sha256:fa394da808cc53f76d0344429421d6c422a6ee85fe7450135c0e3cff4df9bcbb')
    parser.add_argument('--starrocks-image', default='starrocks/allin1-ubuntu@sha256:faf7ce9c24d9c29c9431b4e8cbd4bb7a74cd169907c63f0c5ebaacc7f9df276b')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=60)
    args = parser.parse_args()
    containers = []
    report = {'created_at': datetime.now(timezone.utc).isoformat(), 'purpose': 'synthetic correctness and compatibility; not a performance ranking', 'engines': {}}
    try:
        with tempfile.TemporaryDirectory(prefix='analytics-live-') as directory:
            snapshot = Path(directory) / 'fixture'
            reference = duckdb.connect(':memory:')
            reference.execute(ddl('duckdb'))
            reference.executemany('INSERT INTO events VALUES (' + ','.join('?' for _ in COLUMNS) + ')', fixture())
            check_results(reference)
            reference.execute('DELETE FROM events')
            rows = extended_fixture()
            reference.executemany('INSERT INTO events VALUES (' + ','.join('?' for _ in COLUMNS) + ')', rows)
            write_fixture(reference, snapshot, rows)
            report['reference'] = {'engine': 'duckdb', 'version': reference.execute('SELECT version()').fetchone()[0], 'rows': len(rows)}
            for engine, image, internal in [('clickhouse', args.clickhouse_image, 8123), ('starrocks', args.starrocks_image, 9030)]:
                docker('pull', image)
                name = 'analytics-live-' + engine + '-' + uuid.uuid4().hex[:10]
                options = ['run', '-d', '--name', name, '--memory=12g', '--cpus=4', '-p', '127.0.0.1::' + str(internal)]
                if engine == 'clickhouse':
                    options += ['-e', 'CLICKHOUSE_PASSWORD=fixture-only-password']
                container = docker(*options, image)
                containers.append(container)
                mapped = port(container, internal)
                if engine == 'clickhouse':
                    os.environ.update(BENCH_CLICKHOUSE_URL=f'http://127.0.0.1:{mapped}', BENCH_CLICKHOUSE_USER='default', BENCH_CLICKHOUSE_PASSWORD='fixture-only-password', BENCH_CLICKHOUSE_DATABASE='default')
                else:
                    os.environ.update(BENCH_STARROCKS_HOST='127.0.0.1', BENCH_STARROCKS_PORT=str(mapped), BENCH_STARROCKS_USER='root', BENCH_STARROCKS_PASSWORD='', BENCH_STARROCKS_DATABASE='information_schema')
                    os.environ.pop('BENCH_STARROCKS_SSL_CA', None)
                connection_args = SimpleNamespace(timeout=args.timeout)
                conn, version = wait_ready(engine, connection_args)
                if engine == 'starrocks':
                    with conn.cursor() as cursor:
                        cursor.execute('CREATE DATABASE analytics_fixture')
                    conn.close()
                    os.environ['BENCH_STARROCKS_DATABASE'] = 'analytics_fixture'
                    conn, version = connect(engine, connection_args)
                print(engine + ' ready: ' + version, flush=True)
                load(SimpleNamespace(engine=engine, snapshot=snapshot, table='events', database='unused', batch_rows=1000))
                result = validate(engine, conn, reference, args.timeout)
                result['timeout_probe'] = validate_timeout(engine, conn)
                result.update(version=version, image=image, image_digests=json.loads(docker('image', 'inspect', image, '--format', '{{json .RepoDigests}}')))
                report['engines'][engine] = result
                if conn is not None:
                    conn.close()
                docker('rm', '-fv', container)
                containers.remove(container)
            reference.close()
        report['source_sha256'] = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ('queries.py', 'runner.py', 'load_snapshot.py', 'test_suite.py', 'live_validation.py')}
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print('Live validation complete: ' + str(args.output), flush=True)
    finally:
        for container in containers:
            subprocess.run(['docker', 'rm', '-fv', container], check=False)


if __name__ == '__main__':
    main()
