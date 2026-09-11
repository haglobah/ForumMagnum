"""Controlled follow-up for coarse exact-state granules; preserves first results."""
import argparse
import json
import random
from advanced import candidate_sql,ROLLUP_SELECT
from pilot import Client,DB,HERE,save

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['build','benchmark']);parser.add_argument('--output',default='rollup-fine-results.json');parser.add_argument('--seed',type=int,default=12481);args=parser.parse_args()
    client=Client()
    if args.action=='build':
        client.mutate('rollup-fine-create',f'CREATE TABLE {DB}.hourly_rollup_fine ENGINE=AggregatingMergeTree ORDER BY (environment,hour,event_type) SETTINGS index_granularity=64 AS '+ROLLUP_SELECT.format(source=DB+'.typed')+' LIMIT 0')
        client.mutate('rollup-fine-copy',f'INSERT INTO {DB}.hourly_rollup_fine SELECT * FROM {DB}.hourly_rollup',900)
        return
    path=HERE/args.output;report=json.loads(path.read_text()) if path.exists() else {'settings':{'result_cache':False,'condition_cache':False,'max_threads':2},'cases':{},'plans':{}}
    baseline=json.loads((HERE/'baseline.json').read_text())['cases'];saved=json.loads((HERE.parent/'2026-09-10-cloud-results.json').read_text())['cases']
    jobs=[(candidate,case,profile) for candidate in ('baseline','rollup','rollup_fine') for case in ('event_counts','traffic_hour','traffic_day') for profile in ('hour','day')];random.Random(args.seed).shuffle(jobs)
    for candidate,case,profile in jobs:
        key='/'.join((candidate,case,profile));attempts=report['cases'].setdefault(key,[])
        query=candidate_sql('rollup' if candidate=='rollup_fine' else candidate,case,profile,client.params,rollup=DB+'.hourly_rollup_fine' if candidate=='rollup_fine' else None)
        for repeat in range(4):
            if any(a['repeat']==repeat for a in attempts):continue
            observation,_=client.query(query);observation.update(repeat=repeat,warmup=repeat==0)
            if observation['status']=='complete':
                observation['matches_raw_baseline']=observation['sha256'] in {a['sha256'] for a in baseline['raw/'+case+'/'+profile] if a['status']=='complete'}
                pg={a['sha256'] for a in saved.get(case+'/'+profile,{}).get('postgres',{}).get('attempts',[]) if a['status']=='complete'}
                observation['matches_saved_postgres']=observation['sha256'] in pg if pg else None
            attempts.append(observation);save(path,report)
            print(key,repeat,observation['status'],round(observation['elapsed_ms'],1),observation.get('matches_raw_baseline'),flush=True)
            if observation['status']!='complete' or observation.get('matches_raw_baseline') is False or observation.get('matches_saved_postgres') is False:raise RuntimeError('Mismatch '+key)
    # Explain after timing is finished. Redact even though these have no private identities.
    for candidate in ('rollup','rollup_fine'):
        for profile in ('hour','day'):
            observation,rows=client.query('EXPLAIN indexes=1, projections=1 '+candidate_sql('rollup','traffic_day',profile,client.params,rollup=DB+'.hourly_rollup_fine' if candidate=='rollup_fine' else None))
            if rows is not None:
                rows=[[str(value) for value in row] for row in rows]
                for row in rows:
                    for i,value in enumerate(row):
                        for secret in client.secrets:value=value.replace(secret,'[REDACTED]')
                        row[i]=value
            report['plans'][candidate+'/'+profile]={'observation':observation,'rows':rows};save(path,report)
if __name__=='__main__':main()
