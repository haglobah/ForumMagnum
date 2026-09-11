"""Summarize matched measured advanced observations without exposing identities."""
import argparse
import json
import statistics
from pilot import HERE,save

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--input',default='advanced-results.json'); parser.add_argument('--output',default='advanced-summary'); args=parser.parse_args()
    report=json.loads((HERE/args.input).read_text())
    evidence=json.loads((HERE/'advanced-evidence.json').read_text()) if (HERE/'advanced-evidence.json').exists() else {}
    logs={row[0]:row for row in evidence.get('queries',{}).get('rows',[]) or [] if row[1]=='QueryFinish'}
    groups={}
    for key,attempts in report['cases'].items():
        measured=[a for a in attempts if a['status']=='complete' and not a['warmup']]
        if not measured: continue
        groups[key]={'samples':len(measured),'median_client_ms':statistics.median(a['elapsed_ms'] for a in measured),'min_client_ms':min(a['elapsed_ms'] for a in measured),'max_client_ms':max(a['elapsed_ms'] for a in measured),'median_read_rows':statistics.median(int(a['statistics']['rows_read']) for a in measured),'all_match_raw':all(a['matches_raw_baseline'] for a in measured),'all_available_match_pg':all(a['matches_saved_postgres'] is not False for a in measured)}
    for key,values in groups.items():
        samples=[logs[a['query_id']] for a in report['cases'][key] if a['status']=='complete' and not a['warmup'] and a['query_id'] in logs]
        values['query_log_samples']=len(samples)
        if samples:
            values['median_server_ms']=statistics.median(row[3] for row in samples)
            values['median_memory_bytes']=statistics.median(row[9] for row in samples)
    lines=['# Advanced pilot results','','One warmup and three measured repeats, shuffled case/layout order; query and condition caches disabled. Same 13,711,369-row cohort. Client times include network latency. No new PostgreSQL requests.','','| Candidate / case / window | Client median ms | Typed baseline ms | Speedup | Read rows |','|---|---:|---:|---:|---:|']
    for key,value in sorted(groups.items()):
        candidate,case,profile=key.split('/')
        if candidate=='baseline':continue
        baseline=groups.get('baseline/'+case+'/'+profile)
        if baseline:
            value['speedup_vs_typed']=baseline['median_client_ms']/value['median_client_ms']
            lines.append(f"| {key} | {value['median_client_ms']:.1f} | {baseline['median_client_ms']:.1f} | {value['speedup_vs_typed']:.2f}× | {value['median_read_rows']:,.0f} |")
    save(HERE/(args.output+'.json'),groups)
    (HERE/(args.output+'.md')).write_text('\n'.join(lines)+'\n')
if __name__=='__main__': main()
