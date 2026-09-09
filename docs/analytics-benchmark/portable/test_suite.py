#!/usr/bin/env python3
"""Synthetic semantic tests. Optional BENCH_TEST_POSTGRES_DSN must be disposable."""
import argparse
from collections import Counter
import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import tempfile

import duckdb
import psycopg
import pymysql
import sqlglot

from export_snapshot import normalize, merged_intervals
from queries import CASES, COLUMNS, ENGINES, ddl, render, windows
from runner import failure_status, attempt, ch_rows, compare, digest, result_digest, scalar, summarize, validate_manifest

START = datetime(2026, 9, 7, tzinfo=timezone.utc)
PARAMS = {'environment': 'lesswrong.com', 'experiment': 'welcomeBoxABTest',
          'user_id': 'u', 'session_id': 's', 'tab_id': 't'}


def fixture():
    rows = []
    specs = [
        (-604800, 'tabStarted', {'tabId': 't', 'userAgent': 'old', 'abTestGroups': {'welcomeBoxABTest': 'old'}}),
        (0, 'pageLoadFinished', {'tabId': 't', 'clientId': 'c', 'userId': 'u', 'sessionId': 's', 'url': 'https://lesswrong.com/posts/x'}),
        (5, 'ssr', {'tabId': 't', 'userAgent': 'Crawler', 'abTestGroups': {'welcomeBoxABTest': '001'}}),
        (5, 'tabStarted', {'tabId': 't', 'userAgent': 'Browser', 'abTestGroups': {'welcomeBoxABTest': '002'}}),
        (6, 'navigate', {'tabId': 't', 'clientId': 'c', 'to': '/posts/x'}),
        (7, 'navigate', {'tabId': 't', 'clientId': 'c', 'to': '/elsewhere'}),
        (10, 'ultraFeedItemViewed', {'tabId': 't', 'userId': 'u', 'feedItemId': 'i'}),
        (11, 'ultraFeedItemViewed', {'tabId': 't', 'userId': 'u', 'feedItemId': 'i'}),
        (12, 'ultraFeedItemExpanded', {'tabId': 't', 'feedItemId': 'i', 'expansionLevel': 0}),
        (13, 'ultraFeedItemExpanded', {'tabId': 't', 'feedItemId': 'i', 'expansionLevel': 1}),
        (14, 'ultraFeedItemExpanded', {'tabId': 't', 'feedItemId': 'i', 'expansionLevel': 2}),
        (15, 'ultraFeedItemExpanded', {'tabId': 't', 'feedItemId': 'j', 'expansionLevel': 1}),
        (16, 'ultraFeedItemViewed', {'tabId': 't', 'userId': 'u', 'feedItemId': 'j'}),
        (17, 'ultraFeedItemViewed', {'userId': 'u', 'feedItemId': 'orphan'}),
        (20, 'navigate', {'to': '/posts/anonymous'}),
        (25, 'ssr', {'tabId': 'historic', 'userAgent': 'HeadlessBrowser', 'abTestGroups': {'welcomeBoxABTest': '001'}}),
        (30, 'pageLoadFinished', {'tabId': 'historic', 'clientId': 'h', 'url': '/posts/h'}),
        (31, 'pageLoadFinished', {'tabId': 'historic', 'clientId': 'h', 'url': '/posts/h'}),
        (32, 'tabStarted', {'tabId': 'unknown', 'userAgent': ''}),
        (33, 'navigate', {'tabId': 'unknown'}),
        (3599, 'tabStarted', {'tabId': 'late', 'abTestGroups': {'welcomeBoxABTest': 'late'}}),
        (3600, 'navigate', {'tabId': 'late'}),
        (-604801, 'ssr', {'tabId': 'expired', 'userAgent': 'bot'}),
        (0, 'navigate', {'tabId': 'expired'}),
        (3599, 'ssr', {'tabId': 'followup'}),
        (3601, 'pageLoadFinished', {'tabId': 'followup'}),
    ]
    for index, (seconds, event_type, event) in enumerate(specs):
        rows.append(normalize((2**53 + index + 1, START + timedelta(seconds=seconds), 'lesswrong.com', event_type, event), PARAMS['experiment']))
    precise = list(rows[4])
    precise[1] = precise[1].replace(microsecond=123456)
    rows[4] = tuple(precise)
    rows.append(normalize((2**53 + 1000, START + timedelta(seconds=5), 'other.example', 'tabStarted', {'tabId': 't', 'userAgent': 'bot', 'abTestGroups': {'welcomeBoxABTest': 'wrong-environment'}}), PARAMS['experiment']))
    return rows


def check_results(db):
    outputs = {}
    for case in CASES:
        outputs[case] = db.execute(render('duckdb', case, 'hour', PARAMS)).fetchall()
    assert outputs['feature_funnel'] == [('hour', 2, 1)]
    assert outputs['ssr_association'] == [('hour', 3, 3)]  # one SSR has two page loads; count it once
    assert outputs['user'] == [('hour', 'pageLoadFinished', 1), ('hour', 'ultraFeedItemViewed', 4)] or set(outputs['user']) == {('hour', 'pageLoadFinished', 1), ('hour', 'ultraFeedItemViewed', 4)}
    outcomes = {row[1]: row[2:] for row in outputs['ab_outcome']}
    assert outcomes['late'] == (1, 0)  # navigation at end is excluded
    assert outcomes['001'] == (2, 1)  # earliest same-time assignment uses exact smaller id
    metadata = outputs['metadata_join']
    assert ('hour', '002', 'tabStarted', 'not_matched', 3, 1) in metadata  # latest metadata tie uses larger id
    assert ('hour', '001', 'ssr', 'bot_like', 2, 1) in metadata
    assert ('hour', None, None, 'unknown', 2, 1) in metadata  # anonymous + expired metadata
    assert sum(row[4] for row in metadata) == 8
    assert set(outputs['post_paths']) == {('hour', 'pageLoadFinished', 3), ('hour', 'navigate', 2)}
    assert outputs['coverage'] == [('hour', 22, 6)]
    monthly = db.execute(render('duckdb', 'coverage', 'monthly24', PARAMS)).fetchall()
    assert len(monthly) == 24
    assert sum(row[1] for row in monthly) == 0
    return outputs


def test_protocol():
    assert failure_status(pymysql.err.OperationalError(5024, "Query reached its timeout of 1 seconds")) == 'timed_out'
    assert failure_status(pymysql.err.OperationalError(2013, "Lost connection to MySQL server during query")) == 'transport_failed'
    assert scalar(2**53 + 1) != scalar(2**53)
    assert scalar(1) == scalar(Decimal('1.000000'))
    assert scalar('001') != scalar(1)
    assert result_digest([(None, 1), ('x', 2)]) == result_digest([('x', 2), (None, 1)])
    payload = {'meta': [{'name': 'n', 'type': 'UInt64'}, {'name': 'v', 'type': 'Nullable(String)'}, {'name': 't', 'type': "DateTime64(6, 'UTC')"}], 'data': [{'n': str(2**53 + 1), 'v': '001', 't': '2026-09-07 00:00:00.000000'}], 'rows': 1, 'statistics': {}}
    assert ch_rows(payload) == [(2**53 + 1, '001', datetime(2026, 9, 7))]
    try:
        ch_rows({'data': []})
        raise AssertionError('Truncated response accepted')
    except ValueError:
        pass
    a = {'status': 'complete', 'elapsed_ms': 10, 'warmup': False, 'result_sha256': 'same', 'window_coverage_complete': True}
    b = {'status': 'timed_out', 'elapsed_ms': 60000, 'warmup': False}
    assert summarize([a, b])['median_complete_ms'] == 10
    report = {'dataset_sha256': 'd', 'parameters_sha256': 'p', 'semantics_version': 1, 'renderer_sha256': 'r', 'cases': {'x': {'attempts': [a], 'summary': summarize([a])}}}
    assert compare(report, report)[0]['comparable_complete_results']
    bad = dict(report, dataset_sha256='different')
    try:
        compare(report, bad)
        raise AssertionError('Different dataset accepted')
    except ValueError:
        pass
    partial = dict(report, cases={'x': {'attempts': [a, b], 'summary': summarize([a, b])}})
    assert not compare(report, partial)[0]['comparable_complete_results']
    manifest = {'environment': 'lesswrong.com', 'coverage': [[a.isoformat(), b.isoformat()] for a, b in merged_intervals(['hour'])]}
    validate_manifest(manifest, PARAMS, ['hour'])
    try:
        validate_manifest(manifest, PARAMS, ['six_months'])
        raise AssertionError('Undercovered dataset accepted')
    except ValueError:
        pass
    for engine in ENGINES:
        for case in CASES:
            for profile in ('hour', 'monthly24'):
                sqlglot.parse_one(render(engine, case, profile, PARAMS), read=engine)
        sqlglot.parse_one(ddl(engine), read=engine)


def write_fixture(db, destination, rows=None):
    if destination.exists():
        raise ValueError('Fixture destination must not exist')
    destination.mkdir(parents=True)
    path = destination / 'part-000000.parquet'
    db.execute("COPY events TO '" + str(path.resolve()).replace("'", "''") + "' (FORMAT PARQUET, COMPRESSION ZSTD)")
    rows = fixture() if rows is None else rows
    files = [{'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rows': len(rows)}]
    counts = Counter((row[1].strftime('%Y-%m-%d'), row[2], row[3]) for row in rows)
    manifest = {'dataset_id': 'portable-synthetic-v1', 'schema_version': 1,
                'snapshot': {'kind': 'complete synthetic universe; not a production extract'},
                'experiment': PARAMS['experiment'], 'environment': PARAMS['environment'],
                'row_count': len(rows), 'content_sha256': digest(files), 'files': files,
                'coverage': [[a.isoformat(), b.isoformat()] for a, b in merged_intervals(['hour', 'day', 'week', 'month', 'six_months', 'monthly24'])],
                'daily_counts': [{'date': key[0], 'environment': key[1], 'event_type': key[2], 'rows': value} for key, value in sorted(counts.items())]}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (destination / 'params.json').write_text(json.dumps(PARAMS, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-fixture', type=Path)
    args = parser.parse_args()
    test_protocol()
    rows = fixture()
    db = duckdb.connect(':memory:')
    db.execute(ddl('duckdb'))
    db.executemany('INSERT INTO events VALUES (' + ','.join('?' for _ in COLUMNS) + ')', rows)
    expected = check_results(db)
    assert db.execute('SELECT occurred_at FROM events WHERE event_id=?', [2**53 + 5]).fetchone()[0].microsecond == 123456
    if args.write_fixture:
        write_fixture(db, args.write_fixture)
    with tempfile.TemporaryDirectory(prefix='analytics-perf-fixture-') as directory:
        path = str(Path(directory) / 'events.parquet')
        db.execute("COPY events TO '" + path + "' (FORMAT PARQUET, COMPRESSION ZSTD)")
        parquet = duckdb.connect(':memory:')
        parquet.execute("CREATE VIEW events AS SELECT * FROM read_parquet('" + path + "')")
        parquet_outputs = check_results(parquet)
        assert all(result_digest(parquet_outputs[case]) == result_digest(expected[case]) for case in CASES)
        parquet.close()
    timeout = attempt('duckdb', db, 'SELECT sum(i*j) FROM range(1000000000) a(i) CROSS JOIN range(1000000000) b(j)', 0.02)
    assert timeout['status'] == 'timed_out', timeout
    assert db.execute('SELECT 1').fetchone() == (1,)
    if os.getenv('BENCH_TEST_POSTGRES_DSN'):
        with psycopg.connect(os.environ['BENCH_TEST_POSTGRES_DSN']) as pg:
            pg.execute('CREATE TEMP TABLE ' + ddl('postgres').split('CREATE TABLE ', 1)[1])
            with pg.cursor() as cursor:
                cursor.executemany('INSERT INTO events VALUES (' + ','.join('%s' for _ in COLUMNS) + ')', rows)
            for case in CASES:
                actual = pg.execute(render('postgres', case, 'hour', PARAMS)).fetchall()
                assert result_digest(actual) == result_digest(expected[case]), (case, actual, expected[case])
            assert len(pg.execute(render('postgres', 'coverage', 'monthly24', PARAMS)).fetchall()) == 24
            pg.execute('SET LOCAL statement_timeout=20')
            outcome = attempt('postgres', pg, 'SELECT pg_sleep(1)', 1)
            assert outcome['status'] == 'timed_out', outcome
            pg.rollback()
        print('PostgreSQL: all 15 cases matched DuckDB, monthly coverage preserved, timeout confirmed')
    else:
        print('PostgreSQL execution skipped; set BENCH_TEST_POSTGRES_DSN to a disposable local database')
    db.close()
    print('DuckDB table + Parquet: semantic assertions passed; four dialects parsed; timeout and comparison guards passed')


if __name__ == '__main__':
    main()
