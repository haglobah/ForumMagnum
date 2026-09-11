"""Isolated advanced candidates; imports no PostgreSQL connection code."""
import argparse
from datetime import datetime, timezone
import json
import random
from pilot import Client, DB, HERE, CASES, render, sql_for, save
from queries import windows, literal, timestamp

PROJECTIONS = {'event': '(environment,event_type,occurred_at)', 'user': '(environment,ifNull(user_id,\'\'),occurred_at)', 'session': '(environment,ifNull(session_id,\'\'),occurred_at)', 'tab': '(environment,ifNull(tab_id,\'\'),occurred_at)'}
ROLLUP_SELECT = "SELECT environment,toStartOfHour(occurred_at) AS hour,event_type,countState() AS events,uniqExactState(client_id) AS clients FROM {source} GROUP BY environment,hour,event_type"


def candidate_sql(candidate,case,profile,params,custom_windows=None,source=None,metadata=None,rollup=None):
    source=source or DB+'.typed'
    ranges=custom_windows if custom_windows is not None else windows(profile)
    if candidate=='baseline': return render('clickhouse',case,profile,params,table=source,custom_windows=ranges)
    if candidate in PROJECTIONS: return sql_for('typed_'+candidate,case,profile,params,custom_windows=ranges)
    if len(ranges)!=1: raise ValueError('Advanced rewrite requires exactly one window')
    label,start,end=ranges[0]
    if candidate in ('metadata','funnel'):
        canonical=render('clickhouse',case,profile,params,table=source,custom_windows=ranges)
    if candidate=='metadata':
        if case!='metadata_join': raise ValueError('Unsupported metadata case')
        return canonical.replace('JOIN '+source+' m ON','JOIN '+(metadata or DB+'.metadata_compact')+' m ON')
    if candidate=='funnel':
        if case!='feature_funnel': raise ValueError('Unsupported funnel case')
        prefix=canonical.split(', exposures AS')[0]
        return prefix+", grouped AS (SELECT window_id,tab_id,feed_item_id,minOrNullIf(occurred_at,event_type='ultraFeedItemViewed' AND user_id IS NOT NULL) AS first_view,maxOrNullIf(occurred_at,event_type='ultraFeedItemExpanded' AND expansion_level>0) AS last_expansion FROM base WHERE event_type IN ('ultraFeedItemViewed','ultraFeedItemExpanded') AND tab_id IS NOT NULL AND feed_item_id IS NOT NULL GROUP BY window_id,environment,tab_id,feed_item_id), outcomes AS (SELECT window_id,tab_id,if(ifNull(last_expansion>=first_view,0),1,0) AS expanded FROM grouped WHERE first_view IS NOT NULL) SELECT w.window_id,count(o.tab_id) AS exposed_items,coalesce(sum(o.expanded),0) AS expanded_items FROM windows w LEFT JOIN outcomes o ON o.window_id=w.window_id GROUP BY w.window_id"
    if candidate=='rollup':
        if case not in ('event_counts','traffic_hour','traffic_day'): raise ValueError('Unsupported rollup case')
        if start.minute or start.second or start.microsecond or end.minute or end.second or end.microsecond or end<=start: raise ValueError('Rollup requires increasing hour-aligned windows')
        where=f"environment={literal(params.get('environment','lesswrong.com'))} AND hour>={timestamp('clickhouse',start)} AND hour<{timestamp('clickhouse',end)}"
        if case=='event_counts':
            return f"SELECT {literal(label)} AS window_id,event_type,countMerge(events) AS events FROM {rollup or DB+'.hourly_rollup'} WHERE {where} GROUP BY event_type"
        unit='hour' if case=='traffic_hour' else 'day'
        return f"SELECT {literal(label)} AS window_id,date_trunc('{unit}',hour) AS bucket,event_type,countMerge(events) AS events,uniqExactMerge(clients) AS clients FROM {rollup or DB+'.hourly_rollup'} WHERE {where} AND event_type IN ('navigate','pageLoadFinished') GROUP BY bucket,event_type"
    raise ValueError('Unknown candidate')


def build(client):
    for name,order in PROJECTIONS.items():
        table=DB+'.typed_'+name
        client.mutate(name+'-create',f'CREATE TABLE {table} AS {DB}.typed')
        client.mutate(name+'-copy',f'INSERT INTO {table} SELECT * FROM {DB}.typed',900)
        client.mutate(name+'-projection-add',f'ALTER TABLE {table} ADD PROJECTION {name}_order (SELECT _part_offset ORDER BY {order})')
        client.mutate(name+'-projection-materialize',f'ALTER TABLE {table} MATERIALIZE PROJECTION {name}_order SETTINGS mutations_sync=2',900)
    client.mutate('metadata-create',f'CREATE TABLE {DB}.metadata_compact ENGINE=MergeTree ORDER BY (environment,ifNull(tab_id,\'\'),occurred_at) AS SELECT event_id,occurred_at,environment,event_type,tab_id,ab_variant,user_agent FROM {DB}.typed WHERE 0')
    client.mutate('metadata-copy',f"INSERT INTO {DB}.metadata_compact SELECT event_id,occurred_at,environment,event_type,tab_id,ab_variant,user_agent FROM {DB}.typed WHERE event_type IN ('tabStarted','ssr')",900)
    client.mutate('rollup-create',f'CREATE TABLE {DB}.hourly_rollup ENGINE=AggregatingMergeTree ORDER BY (environment,hour,event_type) AS '+ROLLUP_SELECT.format(source=DB+'.typed')+' LIMIT 0')
    client.mutate('rollup-copy',f'INSERT INTO {DB}.hourly_rollup '+ROLLUP_SELECT.format(source=DB+'.typed'),900)


def benchmark(client, output='advanced-results.json', seed=94731):
    path=HERE/output
    report=json.loads(path.read_text()) if path.exists() else {'settings':{'result_cache':False,'condition_cache':False,'max_threads':2},'cases':{}}
    baseline=json.loads((HERE/'baseline.json').read_text())['cases']
    saved=json.loads((HERE.parent/'2026-09-10-cloud-results.json').read_text())['cases']
    jobs=[(candidate,case,profile) for candidate,cases in [('event',CASES),('user',['user']),('session',['session']),('tab',['tab']),('metadata',['metadata_join']),('funnel',['feature_funnel']),('rollup',['event_counts','traffic_hour','traffic_day']),('baseline',CASES)] for case in cases for profile in ('hour','day')]
    random.Random(seed).shuffle(jobs)
    for candidate,case,profile in jobs:
        key='/'.join((candidate,case,profile))
        attempts=report['cases'].setdefault(key,[])
        for repeat in range(4):
            if any(a['repeat']==repeat for a in attempts): continue
            observation,_=client.query(candidate_sql(candidate,case,profile,client.params))
            observation.update(repeat=repeat,warmup=repeat==0)
            if observation['status']=='complete':
                observation['matches_raw_baseline']=observation['sha256'] in {a['sha256'] for a in baseline['raw/'+case+'/'+profile] if a['status']=='complete'}
                pg={a['sha256'] for a in saved.get(case+'/'+profile,{}).get('postgres',{}).get('attempts',[]) if a['status']=='complete'}
                observation['matches_saved_postgres']=observation['sha256'] in pg if pg else None
            attempts.append(observation); save(path,report)
            print(key,repeat,observation['status'],round(observation['elapsed_ms'],1),observation.get('matches_raw_baseline'),flush=True)
            if observation['status']!='complete' or observation.get('matches_raw_baseline') is False or observation.get('matches_saved_postgres') is False: raise RuntimeError('Advanced result failed: '+key)


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('action',choices=['build','benchmark']); parser.add_argument('--output',default='advanced-results.json'); parser.add_argument('--seed',type=int,default=94731); args=parser.parse_args()
    client=Client()
    if args.action=='build': build(client)
    else: benchmark(client,args.output,args.seed)
if __name__=='__main__': main()
