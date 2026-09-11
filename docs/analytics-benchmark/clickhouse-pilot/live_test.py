"""Read-only synthetic checks for nullable JSON, exact IDs/decimals and UTC."""
from datetime import datetime, timezone
from decimal import Decimal
import json
from pilot import Client, HERE, literal, raw_projection, result_digest, save


def check(client):
    events = [
        ('navigate', {'to':'https://lesswrong.com/posts/x','clientId':'','expansionLevel':1.25,'abTestGroups':{'welcomeBoxABTest':'001'}}),
        ('pageLoadFinished', {'url':'https://lesswrong.com/posts/y','clientId':None,'expansionLevel':None}),
        ('timerEvent', {'path':'/posts/z','userId':'u','sessionId':'s','tabId':'t','expansionLevel':-0.125}),
        ('timerEvent', {}),
        ('ultraFeedItemExpanded', {'expansionLevel':'2.500000','feedItemId':'','userAgent':''}),
    ]
    expected = [
        (9007199254740993, datetime(2026,9,7), 'lesswrong.com', 'navigate', None, '', None, None, '/posts/x', None, Decimal('1.25'), None, '001'),
        (9007199254740994, datetime(2026,9,7), 'lesswrong.com', 'pageLoadFinished', None, None, None, None, '/posts/y', None, None, None, None),
        (9007199254740995, datetime(2026,9,7), 'lesswrong.com', 'timerEvent', 'u', None, 's', 't', '/posts/z', None, Decimal('-0.125'), None, None),
        (9007199254740996, datetime(2026,9,7), 'lesswrong.com', 'timerEvent', None, None, None, None, None, None, None, None, None),
        (9007199254740997, datetime(2026,9,7), 'lesswrong.com', 'ultraFeedItemExpanded', None, None, None, None, None, '', Decimal('2.5'), '', None),
    ]
    branches = [f"SELECT toInt64({9007199254740993+index}) AS id,toDateTime64('2026-09-07 00:00:00',6,'UTC') AS timestamp,'lesswrong.com' AS environment,{literal(kind)} AS event_type,{literal(json.dumps(event))} AS event" for index,(kind,event) in enumerate(events)]
    source = '(' + ' UNION ALL '.join(branches) + ')'
    sql = raw_projection('raw_fixture').replace('FROM raw_fixture', 'FROM '+source)
    observation, rows = client.query(sql, timeout=30)
    observation['matches_expected'] = rows is not None and result_digest(rows)==result_digest(expected)
    save(HERE / 'live-test.json', observation)
    assert observation['matches_expected'], observation
    print('Live raw normalization fixture passed', flush=True)

if __name__ == '__main__': check(Client())
