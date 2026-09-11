from build import Client, DB, SNAPSHOT, read, mutate, parts_sql

client = Client()
assert read(client, 'clone-retry-tables', f"SELECT name FROM system.tables WHERE database='{DB}'") == []
assert read(client, 'clone-retry-running', "SELECT query_id FROM system.processes WHERE query_id='full-build-c4b1d100-7e7b-4f55-8a4d-8391165961c5'") == []
mutate(client, 'snapshot-clone-explicit-key', f'CREATE TABLE {SNAPSHOT} CLONE AS default.public_raw ENGINE=MergeTree ORDER BY tuple() SETTINGS max_bytes_to_merge_at_max_space_in_pool=1, max_bytes_to_merge_at_min_space_in_pool=1, min_age_to_force_merge_seconds=0')
read(client, 'snapshot-ddl', f'SHOW CREATE TABLE {SNAPSHOT}')
read(client, 'snapshot-parts', parts_sql(DB, 'raw_snapshot'))
read(client, 'source-parts-after', parts_sql('default', 'public_raw'))
read(client, 'snapshot-count', f'SELECT count() FROM {SNAPSHOT}')
if client.connection: client.connection.close()
