"""Merge query logs across independently routed Cloud connections, no workload reruns."""
import json
from pilot import Client,HERE,save

def main():
    path=HERE/'advanced-evidence.json';report=json.loads(path.read_text()); existing={tuple(str(x) for x in row[:3]):row for row in report['queries']['rows']}
    wanted={a['query_id'] for name in ('advanced-results.json','rollup-fine-results.json') for values in json.loads((HERE/name).read_text())['cases'].values() for a in values}
    observations=[]
    for i in range(12):
        client=Client()
        observation,rows=client.query("SELECT query_id,type,event_time,query_duration_ms,read_rows,read_bytes,written_rows,written_bytes,result_rows,memory_usage,exception_code,ProfileEvents['SelectedParts'],ProfileEvents['SelectedMarks'],projections FROM system.query_log WHERE query_id LIKE 'pilot-%' AND event_date>=today()-1 AND type IN ('QueryFinish','ExceptionWhileProcessing','ExceptionBeforeStart') ORDER BY event_time,query_id",timeout=60)
        if client.connection:client.connection.close()
        observations.append(observation)
        for row in rows or []:existing[tuple(str(x) for x in row[:3])]=row
        report['queries']['rows']=list(existing.values());report['query_log_reconciliation']=observations;save(path,report)
        found={row[0] for row in existing.values()};print('log reconciliation',i,len(wanted & found),'/',len(wanted),flush=True)
        if wanted<=found:break
if __name__=='__main__':main()
