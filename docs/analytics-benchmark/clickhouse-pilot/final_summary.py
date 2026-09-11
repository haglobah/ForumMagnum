"""Consolidate immutable measurements; original missing logs stay explicit."""
import json
from statistics import median
from pilot import HERE,save

FILES={'core':'results.json','advanced_initial':'advanced-results.json','advanced_repeat':'advanced-repeat-results.json','fine_initial':'rollup-fine-results.json','fine_repeat':'rollup-fine-repeat-results.json','novel':'novel-results.json'}


def main():
    logs={}
    for name in ('evidence.json','advanced-evidence.json','final-query-logs.json'):
        data=json.loads((HERE/name).read_text())
        for row in (data.get('rows') if name=='final-query-logs.json' else data.get('queries',{}).get('rows')) or []:
            if row[1]=='QueryFinish':logs[row[0]]=row
    summary={'settings':{'query_cache':False,'query_condition_cache':False,'max_threads':2,'postgres_requests':0},'stages':{}}
    for stage,name in FILES.items():
        data=json.loads((HERE/name).read_text()); attempts=[a for values in data['cases'].values() for a in values]
        counts={'requests':len(attempts),'complete':sum(a['status']=='complete' for a in attempts),'matching_raw':sum(a.get('matches_raw_baseline') is True for a in attempts),'pg_available':sum(a.get('matches_saved_postgres') is not None for a in attempts),'pg_matches':sum(a.get('matches_saved_postgres') is True for a in attempts),'query_logs':sum(a['query_id'] in logs for a in attempts)}
        expected_counts={'core':960,'advanced_initial':304,'advanced_repeat':304,'fine_initial':72,'fine_repeat':72,'novel':904}
        if counts['requests']!=expected_counts[stage] or counts['complete']!=counts['requests'] or counts['matching_raw']!=counts['requests'] or counts['pg_available']!=counts['pg_matches']:
            raise RuntimeError('Incomplete or mismatched stage: '+stage)
        if stage!='advanced_initial' and counts['query_logs']!=counts['requests']:
            raise RuntimeError('Missing query logs in stage: '+stage)
        groups={}
        for key,values in data['cases'].items():
            measured=[a for a in values if a['status']=='complete' and not a['warmup']]
            if not measured:continue
            query_logs=[logs[a['query_id']] for a in measured if a['query_id'] in logs]
            item={'samples':len(measured),'median_client_ms':median(a['elapsed_ms'] for a in measured),'min_client_ms':min(a['elapsed_ms'] for a in measured),'max_client_ms':max(a['elapsed_ms'] for a in measured),'median_http_elapsed_ms':median(float(a['statistics']['elapsed'])*1000 for a in measured),'median_read_rows':median(int(a['statistics']['rows_read']) for a in measured),'median_read_bytes':median(int(a['statistics']['bytes_read']) for a in measured),'query_log_samples':len(query_logs),'all_match_raw':all(a.get('matches_raw_baseline') is True for a in measured)}
            if query_logs:item.update(median_server_ms=median(row[3] for row in query_logs),median_peak_memory_bytes=median(row[9] for row in query_logs),median_selected_parts=median(row[11] for row in query_logs),median_selected_marks=median(row[12] for row in query_logs))
            selected_rows=[row[13] for row in query_logs if len(row)>13 and isinstance(row[13],int)]
            if selected_rows:item['median_selected_rows']=median(selected_rows)
            if stage=='core':item['pass_medians_ms']={str(p):median(a['elapsed_ms'] for a in measured if a['pass']==p) for p in sorted({a['pass'] for a in measured})}
            groups[key]=item
        for key,item in groups.items():
            candidate,case,window=key.split('/')
            control=('raw' if stage=='core' else 'typed' if stage=='novel' else 'baseline')+'/'+case+'/'+window
            if control in groups:item['speedup_vs_control']=groups[control]['median_client_ms']/item['median_client_ms']
        summary['stages'][stage]={'counts':counts,'groups':groups}
        if stage=='novel':summary['novel_reference_requests']=len(data['references']);summary['partial_hour_rollup_rejections']=data['rollup_rejections']
    saved=json.loads((HERE.parent/'2026-09-10-cloud-results.json').read_text())
    pg={}
    for key,case in saved['cases'].items():
        attempts=case.get('postgres',{}).get('attempts',[])
        measured=[a for a in attempts if a['status']=='complete' and not a.get('warmup',False)]
        if measured:pg[key]={'median_client_ms':median(a['elapsed_ms'] for a in measured),'samples':len(measured)}
    summary['saved_postgres']=pg
    verification=json.loads((HERE/'final-verification.json').read_text())
    summary['dataset']={'rows':13711369,'start_utc':'2026-08-31T00:00:00Z','end_utc_exclusive':'2026-09-08T00:05:00Z','source_rows':2315652132,'ssr_rows':0,'static_derived_tables':True}
    summary['retained_tables']=[{'table':row[0],'rows':row[1],'bytes':row[2],'active_parts':row[3]} for row in verification['pilot_parts']['rows']]
    summary['retained_total_bytes']=sum(row['bytes'] for row in summary['retained_tables'])
    summary['verification']={key:verification[key] for key in ('source_ddl_unchanged','source_part_totals_unchanged','all_build_entries_complete','no_active_benchmark_queries','all_pilot_mutations_done')}
    save(HERE/'final-summary.json',summary)
    print(json.dumps({stage:values['counts'] for stage,values in summary['stages'].items()},indent=2))
if __name__=='__main__':main()
