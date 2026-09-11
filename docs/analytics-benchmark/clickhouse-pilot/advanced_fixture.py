"""Compare advanced rewrites to canonical SQL on synthetic edge cases, live."""
from datetime import timedelta
import duckdb
from advanced import candidate_sql, ROLLUP_SELECT
from semantic_fixture import fixture, fixture_source, PARAMS, START
from pilot import Client, DB, HERE, raw_projection, result_digest, save, render, COLUMNS
from queries import ddl


def main():
    canonical=fixture()
    # Repeated client across hours must merge as one daily client; null excluded.
    extra=list(canonical[1]); extra[0]+=10000; extra[1]+=timedelta(hours=1); canonical.append(tuple(extra))
    extra=list(canonical[6]); extra[0]+=20000; extra[1]-=timedelta(seconds=1); extra[10]=None; canonical.append(tuple(extra))
    db=duckdb.connect(':memory:'); db.execute(ddl('duckdb')); db.executemany('INSERT INTO events VALUES ('+','.join('?' for _ in COLUMNS)+')',canonical)
    client=Client()
    projection=raw_projection('raw_fixture').replace('FROM raw_fixture','FROM '+fixture_source(canonical))
    # CTEs avoid any additional fixture writes or accidental shared fixture replacement.
    source='advanced_fixture'
    prefix=f'WITH {source} AS ({projection}), compact AS (SELECT event_id,occurred_at,environment,event_type,tab_id,ab_variant,user_agent FROM {source} WHERE event_type IN (\'tabStarted\',\'ssr\')), rollup AS ('+ROLLUP_SELECT.format(source=source)+') '
    report={}
    for candidate,cases in [('metadata',['metadata_join']),('funnel',['feature_funnel']),('rollup',['event_counts','traffic_hour','traffic_day'])]:
        for case in cases:
            for label,start,end in [('hour',START,START+timedelta(hours=1)),('day',START,START+timedelta(days=1)),('empty',START+timedelta(days=2),START+timedelta(days=3))]:
                ranges=[(label,start,end)]
                expected=db.execute(render('duckdb',case,'hour',PARAMS,custom_windows=ranges)).fetchall()
                query=candidate_sql(candidate,case,'hour',PARAMS,ranges,source=source,metadata='compact',rollup='rollup')
                query=prefix+('SELECT * FROM ('+query+')')
                observation,rows=client.query(query,timeout=30)
                observation['matches_duckdb']=rows is not None and result_digest(rows)==result_digest(expected)
                report[candidate+'/'+case+'/'+label]=observation; save(HERE/'advanced-fixture.json',report)
                print(candidate,case,label,observation['status'],observation['matches_duckdb'],flush=True)
                if not observation['matches_duckdb']: raise RuntimeError(str(observation))
    db.close()
if __name__=='__main__': main()
