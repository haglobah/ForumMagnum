from build import Client, DB, SNAPSHOT, read, mutate, parts_sql

client = Client()
read(client, 'clone-failure-tables', f"SELECT name,total_rows,sorting_key FROM system.tables WHERE database='{DB}'")
read(client, 'clone-failure-parts', parts_sql(DB, 'raw_snapshot'))
read(client, 'clone-failure-running', "SELECT query_id FROM system.processes WHERE query_id='full-build-c4b1d100-7e7b-4f55-8a4d-8391165961c5'")
read(client, 'clone-failure-ddl', f'SHOW CREATE TABLE {SNAPSHOT}')
if client.connection: client.connection.close()
