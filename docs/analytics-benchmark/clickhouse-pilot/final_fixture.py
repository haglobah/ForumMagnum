"""Independent explicit edge assertions, then live candidate equivalence."""
from datetime import timedelta
import duckdb
from advanced import candidate_sql, ROLLUP_SELECT
from semantic_fixture import fixture, normalize, fixture_source, PARAMS, START
from pilot import HERE, COLUMNS, raw_projection, result_digest, save, render
from final_repeat import RecordedClient
from queries import ddl


def edge_fixture():
    rows=fixture()
    specs=[
        (1,'ultraFeedItemViewed',{'tabId':'anonymous','feedItemId':'i'}),
        (2,'ultraFeedItemExpanded',{'tabId':'anonymous','feedItemId':'i','expansionLevel':1}),
        (1,'ultraFeedItemViewed',{'tabId':'t','feedItemId':'j'}),
        (3600,'pageLoadFinished',{'tabId':'t','clientId':'c'}),
        (3601,'pageLoadFinished',{'tabId':'t','clientId':None}),
        (0,'pageLoadFinished',{'tabId':'boundary'}),
        (-604800,'tabStarted',{'tabId':'boundary','abTestGroups':{'welcomeBoxABTest':'exact-boundary'}}),
        (-604801,'ssr',{'tabId':'boundary','abTestGroups':{'welcomeBoxABTest':'expired'}}),
        (6,'tabStarted',{'tabId':'boundary','abTestGroups':{'welcomeBoxABTest':'too-late'}}),
        (0,'pageLoadFinished',{'tabId':'null-winner'}),
        (5,'ssr',{'tabId':'null-winner','abTestGroups':{'welcomeBoxABTest':'loser'}}),
        (5,'tabStarted',{'tabId':'null-winner'}),
    ]
    for index,(seconds,event_type,event) in enumerate(specs):
        rows.append(normalize((2**53+20000+index,START+timedelta(seconds=seconds),'lesswrong.com',event_type,event),PARAMS['experiment']))
    return rows


def main():
    canonical=edge_fixture();db=duckdb.connect(':memory:');db.execute(ddl('duckdb'));db.executemany('INSERT INTO events VALUES ('+','.join('?' for _ in COLUMNS)+')',canonical)
    hour=[('hour',START,START+timedelta(hours=1))]
    assert db.execute(render('duckdb','feature_funnel','hour',PARAMS,custom_windows=hour)).fetchall()==[('hour',2,1)]
    metadata=db.execute(render('duckdb','metadata_join','hour',PARAMS,custom_windows=hour)).fetchall()
    assert ('hour','exact-boundary','tabStarted','unknown',1,1) in metadata
    assert ('hour',None,'tabStarted','unknown',2,2) in metadata  # Existing unknown tab plus null-valued tie winner
    day=[('day',START,START+timedelta(days=1))]
    traffic=db.execute(render('duckdb','traffic_day','day',PARAMS,custom_windows=day)).fetchall()
    assert next(row for row in traffic if row[2]=='pageLoadFinished')[4]==2
    client=RecordedClient();report={'explicit_assertions':4,'comparisons':{}}
    source='edge_fixture';projection=raw_projection('raw_fixture').replace('FROM raw_fixture','FROM '+fixture_source(canonical))
    prefix=f"WITH {source} AS ({projection}), compact AS (SELECT event_id,occurred_at,environment,event_type,tab_id,ab_variant,user_agent FROM {source} WHERE event_type IN ('tabStarted','ssr')), rollup AS ("+ROLLUP_SELECT.format(source=source)+') '
    for label,start,end in [('hour',START,START+timedelta(hours=1)),('day',START,START+timedelta(days=1)),('partial',START+timedelta(seconds=1),START+timedelta(hours=1,seconds=1)),('empty',START+timedelta(days=2),START+timedelta(days=3))]:
        ranges=[(label,start,end)]
        for candidate,case in [('metadata','metadata_join'),('funnel','feature_funnel'),('rollup','event_counts'),('rollup','traffic_hour'),('rollup','traffic_day')]:
            if label=='partial' and candidate=='rollup':continue
            expected=db.execute(render('duckdb',case,'hour',PARAMS,custom_windows=ranges)).fetchall()
            query=candidate_sql(candidate,case,'hour',PARAMS,ranges,source=source,metadata='compact',rollup='rollup')
            observation,rows=client.query(prefix+'SELECT * FROM ('+query+')')
            observation['matches_duckdb']=rows is not None and result_digest(rows)==result_digest(expected)
            report['comparisons'][candidate+'/'+case+'/'+label]=observation;save(HERE/'final-fixture.json',report)
            if not observation['matches_duckdb']:raise RuntimeError('Fixture mismatch')
    print('Four explicit edge assertions and 17 live comparisons passed',flush=True)
    db.close()
if __name__=='__main__':main()
