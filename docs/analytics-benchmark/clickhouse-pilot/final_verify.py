"""Final metadata-only checks; never reads PostgreSQL or scans source events."""
import json
from pilot import Client,DB,HERE,save,result_digest


def same_rows(current, saved):
    return result_digest(current) == result_digest(saved)


def main():
    client=Client();report={}
    statements={
        'source':'SHOW CREATE TABLE default.public_raw',
        'source_parts':"SELECT count(),sum(rows),sum(bytes_on_disk) FROM system.parts WHERE database='default' AND table='public_raw' AND active",
        'pilot_parts':f"SELECT table,sum(rows),sum(bytes_on_disk),count() FROM system.parts WHERE database='{DB}' AND active GROUP BY table ORDER BY table",
        'mutations':f"SELECT table,mutation_id,is_done,parts_to_do FROM system.mutations WHERE database='{DB}'",
        'running':"SELECT query_id,elapsed,read_rows,memory_usage FROM system.processes WHERE query_id LIKE 'pilot-%' AND query_id!=currentQueryID()",
    }
    for key,query in statements.items():
        observation,rows=client.query(query,timeout=30);report[key]={'observation':observation,'rows':rows}
        save(HERE/'final-verification.json',report)
        if observation['status']!='complete':raise RuntimeError('Metadata verification failed: '+key)
    initial=json.loads((HERE/'metadata.json').read_text())
    report['source_ddl_unchanged']=same_rows(report['source']['rows'],initial['source']['rows'])
    report['source_part_totals_unchanged']=same_rows(report['source_parts']['rows'],initial['source_parts']['rows'])
    journal=json.loads((HERE/'build-journal.json').read_text())
    report['journal_entries']=len(journal);report['all_build_entries_complete']=all(item['status']=='complete' for item in journal)
    report['no_active_benchmark_queries']=not report['running']['rows']
    report['all_pilot_mutations_done']=all(row[2] and row[3]==0 for row in report['mutations']['rows'])
    save(HERE/'final-verification.json',report)
    for key in ('source_ddl_unchanged','source_part_totals_unchanged','all_build_entries_complete','no_active_benchmark_queries','all_pilot_mutations_done'):
        print(key,report[key],flush=True)
        if not report[key]:raise RuntimeError('Final verification failed: '+key)
    if client.connection:client.connection.close()
if __name__=='__main__':main()
