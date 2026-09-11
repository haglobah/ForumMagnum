"""Synthetic all-workload validation with local DuckDB and ClickHouse only.

Fixture, Python normalization and assertions copied from portable test_suite.py
and export_snapshot.py to avoid importing their PostgreSQL-capable modules.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import re
import duckdb
from pilot import Client, DB, HERE, COLUMNS, CASES, literal, raw_projection, render, result_digest, save
from queries import ddl, timestamp
START = datetime(2026, 9, 7, tzinfo=timezone.utc)
PARAMS = {'environment':'lesswrong.com','experiment':'welcomeBoxABTest','user_id':'u','session_id':'s','tab_id':'t'}

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

def fixture_source(canonical):
    branches = []
    for row in canonical:
        d = dict(zip(COLUMNS, row))
        event = {}
        for field,key in [('user_id','userId'),('client_id','clientId'),('session_id','sessionId'),('tab_id','tabId'),('feed_item_id','feedItemId'),('user_agent','userAgent')]:
            if d[field] is not None: event[key] = d[field]
        if d['path'] is not None:
            event['to' if d['event_type']=='navigate' else 'url' if d['event_type']=='pageLoadFinished' else 'path'] = d['path']
        if d['expansion_level'] is not None: event['expansionLevel'] = str(d['expansion_level'])
        if d['ab_variant'] is not None: event['abTestGroups'] = {'welcomeBoxABTest': d['ab_variant']}
        branches.append(f"SELECT toInt64({d['event_id']}) AS id,{timestamp('clickhouse',d['occurred_at'])} AS timestamp,{literal(d['environment'])} AS environment,{literal(d['event_type'])} AS event_type,{literal(json.dumps(event))} AS event")
    return '(' + ' UNION ALL '.join(branches) + ')'


def main():
    canonical = fixture()
    db = duckdb.connect(':memory:')
    db.execute(ddl('duckdb'))
    db.executemany('INSERT INTO events VALUES ('+','.join('?' for _ in COLUMNS)+')',canonical)
    expected = check_results(db)
    client = Client()
    projection = raw_projection('raw_fixture').replace('FROM raw_fixture','FROM '+fixture_source(canonical))
    client.mutate('synthetic-typed-create', f'CREATE TABLE {DB}.typed_fixture AS {DB}.typed')
    client.mutate('synthetic-typed-copy', f'INSERT INTO {DB}.typed_fixture ' + projection)
    report = {}
    for case in CASES:
        report[case] = {}
        for layout in ('raw', 'typed'):
            if layout == 'raw':
                query = render('clickhouse',case,'hour',PARAMS,table='canonical_events').replace('WITH windows AS',f'WITH canonical_events AS ({projection}), windows AS')
            else:
                query = render('clickhouse',case,'hour',PARAMS,table=DB+'.typed_fixture')
            observation, rows = client.query(query, timeout=30)
            observation['matches_duckdb'] = rows is not None and result_digest(rows)==result_digest(expected[case])
            report[case][layout] = observation
            save(HERE/'semantic-fixture.json',report)
            assert observation['matches_duckdb'], (case,layout,observation)
        print(case,'raw and typed match canonical DuckDB fixture',flush=True)
    db.close()

if __name__ == '__main__': main()
