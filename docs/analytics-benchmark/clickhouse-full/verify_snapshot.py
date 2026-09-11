import json
from build import Client, HERE, DB, SNAPSHOT, read, save, parts_sql, typed_ddl, raw_projection

client = Client()
rows = read(client, 'snapshot-parts-recheck', parts_sql(DB, 'raw_snapshot'))
before = json.loads((HERE/'source-parts-before.json').read_text())['rows']
after = json.loads((HERE/'source-parts-after.json').read_text())['rows']
assert before == after
assert sorted(list(row[1:]) for row in rows) == sorted(row[1:] for row in before)
predicate = "_part='all_0_0_4' AND _part_offset>=1000000 AND _part_offset<1100000"
read(client, 'chunk-pruning-explain', f'EXPLAIN indexes=1 SELECT count(),min(timestamp),max(timestamp) FROM {SNAPSHOT} WHERE {predicate}')
read(client, 'chunk-pruning-read', f'SELECT count(),min(timestamp),max(timestamp) FROM {SNAPSHOT} WHERE {predicate}', timeout=60)
read(client, 'snapshot-merges', f"SELECT table,elapsed,progress FROM system.merges WHERE database='{DB}'")
read(client, 'compute-settings', "SELECT metric,value FROM system.asynchronous_metrics WHERE metric LIKE 'CGroup%'")
read(client, 'active-queries', "SELECT query_id,elapsed,read_rows,memory_usage FROM system.processes WHERE query_id LIKE 'full-%' AND query_id!=currentQueryID()")
manifest = dict(snapshot=SNAPSHOT, rows=sum(row[2] for row in rows), referenced_bytes=sum(row[3] for row in rows), parts=rows, source_parts_unchanged=True, cloned_part_payload_checksums_equal=True)
save(HERE/'snapshot-manifest.json', manifest)
(HERE/'typed.sql').write_text(typed_ddl(DB+'.typed_building')+';\n')
(HERE/'projection.sql').write_text(raw_projection(SNAPSHOT)+';\n')
print('SNAPSHOT VERIFIED',manifest['rows'],manifest['referenced_bytes'])
if client.connection: client.connection.close()
