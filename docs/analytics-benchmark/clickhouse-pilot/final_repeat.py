"""Independent repeats and novel predicates; ClickHouse-only, no table writes."""
import argparse
from datetime import datetime, timezone
import json
import random
import sys
import time
import advanced
import pilot
import rollup_fine
from pilot import Client, HERE, DB, CASES, save, sql_for

LOG_SQL = "SELECT query_id,type,event_time,query_duration_ms,read_rows,read_bytes,written_rows,written_bytes,result_rows,memory_usage,exception_code,ProfileEvents['SelectedParts'],ProfileEvents['SelectedMarks'],ProfileEvents['SelectedRows'],projections FROM system.query_log WHERE query_id LIKE 'pilot-%' AND event_date>=today()-1 AND type IN ('QueryFinish','ExceptionWhileProcessing','ExceptionBeforeStart') ORDER BY event_time,query_id"

class RecordedClient(Client):
    def __init__(self):
        super().__init__()
        self.count = 0

    def collect(self):
        path = HERE/'final-query-logs.json'
        report = json.loads(path.read_text()) if path.exists() else {'rows': [], 'collections': []}
        observation, rows = super().query(LOG_SQL, timeout=60)
        report['collections'].append(observation)
        merged = {(row[0],row[1],str(row[2])):row for row in report['rows']}
        for row in rows or []:
            merged[(row[0],row[1],str(row[2]))] = row
        report['rows'] = list(merged.values())
        save(path,report)
        if observation['status'] != 'complete':
            raise RuntimeError('Query-log collection failed')

    def query(self, sql, **kwargs):
        if self.count and self.count % 16 == 0:
            self.collect()
        result = super().query(sql, **kwargs)
        self.count += 1
        return result


def novel(client):
    path=HERE/'novel-results.json'
    report=json.loads(path.read_text()) if path.exists() else {'settings':{'result_cache':False,'condition_cache':False,'max_threads':2},'cases':{},'references':{},'plans':{},'rollup_rejections':[]}
    ranges=[('new_10h',10,11,0,0),('new_18h',18,19,0,0),('new_04_to_09',4,9,0,0),('partial_13_17_to_15_43',13,15,17,43)]
    for label,sh,eh,sm,em in ranges:
        windows=[(label,datetime(2026,9,7,sh,sm,tzinfo=timezone.utc),datetime(2026,9,7,eh,em,tzinfo=timezone.utc))]
        for case in CASES:
            key=case+'/'+label
            if key in report['references']:continue
            observation,_=client.query(sql_for('raw',case,'hour',client.params,custom_windows=windows))
            report['references'][key]=observation;save(path,report)
            if observation['status']!='complete':raise RuntimeError('Raw reference failed')
        jobs=[('raw',case) for case in CASES]+[('typed',case) for case in CASES]+[('event',case) for case in CASES]+[('metadata','metadata_join'),('funnel','feature_funnel'),('user','user'),('session','session'),('tab','tab'),('minmax','event_counts'),('projection','event_counts')]
        if sm==em==0:
            jobs += [(candidate,case) for candidate in ('rollup','rollup_fine') for case in ('event_counts','traffic_hour','traffic_day')]
        else:
            for case in ('event_counts','traffic_hour','traffic_day'):
                try:advanced.candidate_sql('rollup',case,'hour',client.params,custom_windows=windows)
                except ValueError as error:report['rollup_rejections'].append({'window':label,'case':case,'reason':str(error)})
                else:raise RuntimeError('Partial-hour rollup accepted')
            save(path,report)
        random.Random(91238+sh).shuffle(jobs)
        for candidate,case in jobs:
            key='/'.join((candidate,case,label));attempts=report['cases'].setdefault(key,[])
            if candidate in ('raw','typed','minmax','projection'):
                query=sql_for(candidate,case,'hour',client.params,custom_windows=windows)
            else:
                query=advanced.candidate_sql('rollup' if candidate=='rollup_fine' else candidate,case,'hour',client.params,custom_windows=windows,rollup=DB+'.hourly_rollup_fine' if candidate=='rollup_fine' else None)
            for repeat in range(4):
                if any(a['repeat']==repeat for a in attempts):continue
                observation,_=client.query(query)
                observation.update(repeat=repeat,warmup=repeat==0,matches_saved_postgres=None,matches_raw_baseline=observation.get('sha256')==report['references'][case+'/'+label]['sha256'])
                attempts.append(observation);save(path,report)
                print(key,repeat,observation['status'],round(observation['elapsed_ms'],1),observation['matches_raw_baseline'],flush=True)
                if observation['status']!='complete' or not observation['matches_raw_baseline']:raise RuntimeError('Novel mismatch '+key)
            if case in ('event_counts','metadata_join','traffic_day','user') and key not in report['plans']:
                observation,rows=client.query('EXPLAIN indexes=1, projections=1 '+query)
                redacted=[]
                for row in rows or []:
                    values=[]
                    for value in row:
                        value=str(value)
                        for secret in client.secrets:value=value.replace(secret,'[REDACTED]')
                        values.append(value)
                    redacted.append(values)
                report['plans'][key]={'observation':observation,'rows':redacted};save(path,report)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('stage',choices=['core','advanced','fine','novel']);args=parser.parse_args()
    client=RecordedClient()
    if args.stage=='core':pilot.benchmark(client,['raw','minmax','projection','typed'],passes=2)
    elif args.stage=='advanced':advanced.benchmark(client,'advanced-repeat-results.json',94732)
    elif args.stage=='fine':
        rollup_fine.Client=lambda:client
        sys.argv=['rollup_fine.py','benchmark','--output','rollup-fine-repeat-results.json','--seed','12482']
        rollup_fine.main()
    else:novel(client)
    time.sleep(8)
    client.collect()
    if client.connection:client.connection.close()
if __name__=='__main__':main()
