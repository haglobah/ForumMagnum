"""Collect isolated pilot storage, plans, mutations and query-log counters."""
import argparse
import json
from pilot import Client, DB, HERE, save, sql_for


def collect(client, output):
    report = {}
    statements = {
        'tables': f"SELECT name,total_rows,total_bytes,sorting_key,partition_key FROM system.tables WHERE database='{DB}'",
        'parts': f"SELECT table,partition,count() AS parts,sum(rows) AS rows,sum(bytes_on_disk) AS bytes FROM system.parts WHERE database='{DB}' AND active GROUP BY table,partition ORDER BY table,partition",
        'projections': f"SELECT table,name,count() AS parts,sum(rows) AS rows,sum(bytes_on_disk) AS bytes FROM system.projection_parts WHERE database='{DB}' AND active GROUP BY table,name",
        'mutations': f"SELECT table,mutation_id,is_done,parts_to_do,latest_fail_reason FROM system.mutations WHERE database='{DB}'",
        'queries': "SELECT query_id,type,event_time,query_duration_ms,read_rows,read_bytes,written_rows,written_bytes,result_rows,memory_usage,exception_code,ProfileEvents['SelectedParts'] AS selected_parts,ProfileEvents['SelectedMarks'] AS selected_marks,ProfileEvents['SelectedRows'] AS selected_rows FROM system.query_log WHERE query_id LIKE 'pilot-%' AND event_date>=today()-1 AND type IN ('QueryFinish','ExceptionWhileProcessing','ExceptionBeforeStart') ORDER BY event_time,query_id",
        'role_grants': 'SHOW GRANTS FOR default_role',
        'raw_range': f"SELECT count(),min(timestamp),max(timestamp),countIf(id IS NULL) AS null_ids FROM {DB}.raw",
        'raw_daily': f"SELECT toDate(timestamp) AS day,count() AS events,countIf(event_type='ssr') AS ssrs FROM {DB}.raw GROUP BY day ORDER BY day",
    }
    for label, sql in statements.items():
        observation, rows = client.query(sql, timeout=30)
        report[label] = dict(observation=observation, rows=rows)
        save(HERE / output, report)
        print(label, observation['status'], flush=True)
    report['plans'] = {}
    for layout in ('raw','minmax','projection','typed'):
        for case in ('event_counts','user','metadata_join'):
            observation, rows = client.query('EXPLAIN indexes=1, projections=1 ' + sql_for(layout, case, 'hour', client.params), timeout=30)
            # Plans may echo private predicates: redact them before storing.
            if rows is not None:
                rows = [[str(value) for value in row] for row in rows]
                for row in rows:
                    for index, value in enumerate(row):
                        for secret in client.secrets:
                            value = value.replace(secret, '[REDACTED]')
                        row[index] = value
            report['plans'][layout+'/'+case] = dict(observation=observation, rows=rows)
            save(HERE / output, report)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='evidence.json')
    args = parser.parse_args()
    collect(Client(), args.output)
