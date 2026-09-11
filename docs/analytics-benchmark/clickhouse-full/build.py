"""ClickHouse-only fixed snapshot foundation; never retries uncertain mutations.

Reuses the tested pilot HTTP transport and exact projection, not its mutation
runner. All evidence and mutation journals live in this directory.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import uuid

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'clickhouse-pilot'))
from pilot import Client, COLUMNS, raw_projection

DB = 'benchmark_full_20260910'
SNAPSHOT = DB + '.raw_snapshot'
JOURNAL = HERE / 'build-journal.json'


def save(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as handle:
        json.dump(value, handle, indent=2, default=str)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def check_new_operation(path, label):
    journal = json.loads(path.read_text()) if path.exists() else []
    for entry in journal:
        if entry['label'] == label:
            if entry['status'] == 'complete':
                raise RuntimeError('Operation already complete: ' + label)
            raise RuntimeError('Must reconcile uncertain operation before retry: ' + label)
    return journal


def mutate(client, label, sql, timeout=120):
    journal = check_new_operation(JOURNAL, label)
    entry = dict(label=label, query_id='full-build-' + str(uuid.uuid4()), status='submitted', sql=sql, utc=datetime.now(timezone.utc).isoformat())
    journal.append(entry)
    save(JOURNAL, journal)
    observation, _ = client.query(sql, timeout=timeout, mutation=True, query_id=entry['query_id'])
    entry.update(observation)
    save(JOURNAL, journal)
    print(json.dumps(entry, default=str), flush=True)
    if entry['status'] != 'complete':
        raise RuntimeError('Mutation failed; reconcile server state: ' + label)


def read(client, label, sql, timeout=30):
    observation, rows = client.query(sql, timeout=timeout, query_id='full-check-' + str(uuid.uuid4()))
    result = dict(sql=sql, observation=observation, rows=rows)
    save(HERE / (label + '.json'), result)
    print(label, observation['status'], json.dumps(rows, default=str), flush=True)
    if observation['status'] != 'complete':
        raise RuntimeError('Read failed: ' + json.dumps(observation))
    return rows


def parts_sql(database, table):
    return f"SELECT name,partition_id,rows,bytes_on_disk,hash_of_all_files FROM system.parts WHERE database='{database}' AND table='{table}' AND active ORDER BY name"


def metadata(client):
    queries = {
        'version': 'SELECT version()',
        'source-ddl': 'SHOW CREATE TABLE default.public_raw',
        'source-parts-before': parts_sql('default', 'public_raw'),
        'resources': "SELECT metric,value FROM system.asynchronous_metrics WHERE metric IN ('OSMemoryTotal','CGroupMemoryLimit','CGroupMaxCPU','NumberOfCPUCores')",
        'grants': 'SHOW GRANTS FOR default_role',
        'table-settings': "SELECT name,value FROM system.merge_tree_settings WHERE name IN ('max_bytes_to_merge_at_max_space_in_pool','min_bytes_for_wide_part')",
    }
    for label, sql in queries.items():
        read(client, label, sql)


def typed_ddl(table):
    fields = []
    for column in COLUMNS:
        kind = 'Nullable(Int64)' if column == 'event_id' else "DateTime64(6, 'UTC')" if column == 'occurred_at' else 'String' if column in ('environment','event_type') else 'Nullable(Decimal(38,6))' if column == 'expansion_level' else 'Nullable(String)'
        fields.append(column + ' ' + kind)
    return f"CREATE TABLE {table} ({','.join(fields)}) ENGINE=MergeTree PARTITION BY toYYYYMM(occurred_at) ORDER BY (environment,occurred_at,event_type)"


def snapshot(client):
    mutate(client, 'database-create', f'CREATE DATABASE {DB}')
    mutate(client, 'snapshot-clone', f'CREATE TABLE {SNAPSHOT} CLONE AS default.public_raw ENGINE=MergeTree ORDER BY tuple() SETTINGS max_bytes_to_merge_at_max_space_in_pool=1, max_bytes_to_merge_at_min_space_in_pool=1, min_age_to_force_merge_seconds=0')
    read(client, 'snapshot-ddl', f'SHOW CREATE TABLE {SNAPSHOT}')
    read(client, 'snapshot-parts', parts_sql(DB, 'raw_snapshot'))
    read(client, 'source-parts-after', parts_sql('default', 'public_raw'))
    read(client, 'snapshot-count', f'SELECT count() FROM {SNAPSHOT}')


def chunk_plan(parts, chunk_rows):
    if chunk_rows <= 0:
        raise ValueError('chunk_rows must be positive')
    chunks = []
    for part, _, rows, _, checksum in parts:
        for start in range(0, rows, chunk_rows):
            end = min(start + chunk_rows, rows)
            chunks.append(dict(part=part, start=start, end=end,
                               expected_rows=end-start, source_checksum=checksum))
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['metadata','snapshot'])
    args = parser.parse_args()
    client = Client()
    try:
        if args.action == 'metadata':
            metadata(client)
        else:
            snapshot(client)
    finally:
        if client.connection:
            client.connection.close()

if __name__ == '__main__':
    main()
