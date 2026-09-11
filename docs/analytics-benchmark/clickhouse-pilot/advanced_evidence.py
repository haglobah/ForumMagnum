"""Redacted advanced plans, footprints and query-log timing evidence."""
import json
from pilot import Client,DB,HERE,save
from advanced import candidate_sql,PROJECTIONS

def main():
    client=Client(); report={}
    statements={
        'parts':f"SELECT table,count(),sum(rows),sum(bytes_on_disk) FROM system.parts WHERE database='{DB}' AND active GROUP BY table ORDER BY table",
        'projections':f"SELECT table,name,count(),sum(rows),sum(bytes_on_disk) FROM system.projection_parts WHERE database='{DB}' AND active GROUP BY table,name ORDER BY table,name",
        'mutations':f"SELECT table,mutation_id,is_done,parts_to_do,latest_fail_reason FROM system.mutations WHERE database='{DB}'",
        'queries':"SELECT query_id,type,event_time,query_duration_ms,read_rows,read_bytes,written_rows,written_bytes,result_rows,memory_usage,exception_code,ProfileEvents['SelectedParts'],ProfileEvents['SelectedMarks'],projections FROM clusterAllReplicas(default,system.query_log) WHERE query_id LIKE 'pilot-%' AND event_date>=today()-1 AND type IN ('QueryFinish','ExceptionWhileProcessing','ExceptionBeforeStart') ORDER BY event_time,query_id",
    }
    for label,sql in statements.items():
        observation,rows=client.query(sql,timeout=60); report[label]={'observation':observation,'rows':rows}; save(HERE/'advanced-evidence.json',report)
        print(label,observation['status'],flush=True)
    report['plans']={}
    for candidate,cases in [('event',['feature_counts','ab_assignments','metadata_join']),('user',['user']),('session',['session']),('tab',['tab']),('metadata',['metadata_join']),('funnel',['feature_funnel']),('rollup',['traffic_day'])]:
        for case in cases:
            observation,rows=client.query('EXPLAIN indexes=1, projections=1 '+candidate_sql(candidate,case,'day',client.params))
            if rows is not None:
                rows=[[str(value) for value in row] for row in rows]
                for row in rows:
                    for i,value in enumerate(row):
                        for secret in client.secrets:
                            value=value.replace(secret,'[REDACTED]')
                        row[i]=value
            report['plans'][candidate+'/'+case]={'observation':observation,'rows':rows}; save(HERE/'advanced-evidence.json',report)
            print('plan',candidate,case,observation['status'],flush=True)
if __name__=='__main__':main()
