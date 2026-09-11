"""Resumable ClickHouse-only typed snapshot loader.

All writes target the isolated full-build database. INSERT attempts are never
replayed. A failed/unknown attempt must be terminal on every replica before a
fresh table can replace it. Retained verified stages permit assembly recovery
without JSON extraction. Raw source and snapshot are never mutated.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import time
import uuid

from build import HERE, DB, SNAPSHOT, Client, COLUMNS, raw_projection, typed_ddl, parts_sql, save

FROZEN = ('max_bytes_to_merge_at_max_space_in_pool=1, '
          'max_bytes_to_merge_at_min_space_in_pool=1, min_age_to_force_merge_seconds=0')


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


@contextmanager
def exclusive(directory):
    with (directory / 'loader.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Loader is locked by another process') from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def may_submit(attempt):
    return 'insert' not in attempt


def stage_complete(attempt):
    return attempt.get('status') == 'complete' and attempt.get('validation', {}).get('matches') is True


def payloads(parts):
    return Counter(tuple(part[1:]) for part in parts)


def assert_snapshot(expected, actual):
    if sorted(map(tuple, expected)) != sorted(map(tuple, actual)):
        raise RuntimeError('Snapshot manifest drift; refusing further work')


def attach_state(actual, before, chunk):
    if payloads(actual) == payloads(before) + payloads(chunk):
        return 'complete'
    if payloads(actual) == payloads(before):
        return 'not_applied'
    return 'ambiguous'


def publication_state(published_uuid, building_uuid, expected_uuid):
    if published_uuid == expected_uuid and building_uuid is None:
        return 'complete'
    if published_uuid is None and building_uuid == expected_uuid:
        return 'not_applied'
    return 'ambiguous'


def predicate(chunk):
    if not re.fullmatch(r'[a-zA-Z0-9_]+', chunk['part']):
        raise ValueError('Invalid part name')
    return f"_part='{chunk['part']}' AND _part_offset>={int(chunk['start'])} AND _part_offset<{int(chunk['end'])}"


def fingerprint_sql(projection):
    # Tuple wrapping prevents aggregate NULL-skipping. Include every typed field,
    # individual null counts, two multiset summaries, and a whole-row hash.
    expressions = [f"tuple(isNull({c}),ifNull(toString({c}),''))" for c in COLUMNS]
    hashes = [f'reinterpretAsUInt128(sipHash128({expression}))' for expression in expressions]
    hashes.append('reinterpretAsUInt128(sipHash128(tuple(' + ','.join(expressions) + ')))')
    aggregates = ['count()', 'min(occurred_at)', 'max(occurred_at)', 'uniqExact(toYYYYMM(occurred_at))']
    aggregates += [f'countIf(isNull({c}))' for c in COLUMNS]
    for hashed in hashes:
        aggregates += [f'toString(sumWithOverflow({hashed}))', f'toString(groupBitXor({hashed}))']
    return 'SELECT ' + ','.join(aggregates) + ' FROM (' + projection + ')'


def read(client, state, label, sql, timeout=900, fingerprint_threads=None):
    query_id = 'full-loader-read-' + str(uuid.uuid4())
    options = {}
    if fingerprint_threads is not None:
        if fingerprint_threads not in (2, 4) or not sql.startswith('SELECT count(),min(occurred_at),max(occurred_at),uniqExact(toYYYYMM(occurred_at))'):
            raise ValueError('Query-local threads require the expected fingerprint SELECT')
        # The shared transport's flag controls readonly mode and formatting;
        # this remains a SELECT, with only a request-local setting. Never
        # change INSERT threads, the4GB memory cap, or global settings.
        sql += f' SETTINGS max_threads={fingerprint_threads} FORMAT JSON'
        options['mutation'] = True
    observation, rows = client.query(sql, timeout=timeout, query_id=query_id, **options)
    evidence = dict(label=label, sql=sql, observation=observation, rows=rows)
    save(HERE / 'evidence' / (query_id + '.json'), evidence)
    print(label, observation['status'], round(observation['elapsed_ms']), flush=True)
    if observation['status'] != 'complete':
        raise RuntimeError('Read failed; see evidence ' + query_id)
    return json.loads(json.dumps(rows, default=str))


def persist(state):
    save(HERE / 'loader-state.json', state)


def query_terminal(client, state, operation):
    qid = operation['query_id']
    active = read(client, state, 'reconcile-active', f"SELECT query_id FROM clusterAllReplicas('default',system.processes) WHERE query_id='{qid}' OR initial_query_id='{qid}'", 30)
    if active:
        raise RuntimeError('Recorded operation still active: ' + qid)
    logs = read(client, state, 'reconcile-query-log', f"SELECT type,exception_code,query_duration_ms,memory_usage FROM clusterAllReplicas('default',system.query_log) WHERE query_id='{qid}' AND type IN ('QueryFinish','ExceptionBeforeStart','ExceptionWhileProcessing')", 30)
    if not logs:
        raise RuntimeError('No terminal server evidence yet; retry reconciliation later: ' + qid)
    operation['reconciliation'] = logs
    persist(state)
    return all(row[0] == 'QueryFinish' for row in logs)


def operation(client, state, owner, key, sql, timeout=900):
    if key in owner:
        op = owner[key]
        if op['sql'] != sql:
            raise RuntimeError('Recorded SQL changed: ' + key)
        if op['status'] == 'complete':
            return
        if query_terminal(client, state, op):
            op['status'] = 'complete'
            op['recovered'] = True
            persist(state)
            return
        raise RuntimeError('Terminal failed operation; use a fresh attempt, never replay: ' + op['query_id'])
    op = dict(sql=sql, status='submitted', query_id='full-loader-write-' + str(uuid.uuid4()), utc=datetime.now(timezone.utc).isoformat())
    owner[key] = op
    persist(state)
    print(key, op['query_id'], flush=True)
    observation, _ = client.query(sql, timeout=timeout, mutation=True, query_id=op['query_id'])
    op.update(observation)
    persist(state)
    if op['status'] != 'complete':
        raise RuntimeError('Mutation failed or unknown; recorded and never automatically replayed: ' + op['query_id'])


def inventory(client, state, table):
    return read(client, state, 'parts-' + table, parts_sql(DB, table), 30)


def verify_snapshot(client, state):
    manifest = json.loads((HERE / 'snapshot-manifest.json').read_text())
    assert_snapshot(manifest['parts'], inventory(client, state, 'raw_snapshot'))


def initialize():
    (HERE / 'evidence').mkdir(exist_ok=True)
    plan = json.loads((HERE / 'chunk-plan.json').read_text())
    manifest = json.loads((HERE / 'snapshot-manifest.json').read_text())
    identity = dict(plan_sha256=digest(plan), manifest_sha256=digest(manifest), projection_sha256=digest(raw_projection(SNAPSHOT)), ddl_sha256=digest(typed_ddl(DB + '.typed')))
    path = HERE / 'loader-state.json'
    if path.exists():
        state = json.loads(path.read_text())
        if state['identity'] != identity:
            raise RuntimeError('Frozen plan/schema/manifest changed; refusing resume')
    else:
        state = dict(version=1, identity=identity, chunks={}, assemblies=[], created_utc=datetime.now(timezone.utc).isoformat())
        persist(state)
    return state, plan


def stage_chunk(client, state, plan, index):
    chunk = plan[index]
    verify_snapshot(client, state)
    attempts = state['chunks'].setdefault(str(index), [])
    if attempts and stage_complete(attempts[-1]):
        attempt = attempts[-1]
        if payloads(inventory(client, state, attempt['table'])) != payloads(attempt['parts']):
            raise RuntimeError('Verified stage inventory changed')
        print('chunk', index, 'already complete', flush=True)
        return
    if not attempts or attempts[-1].get('status') == 'abandoned':
        attempts.append(dict(table=f'chunk_{index:04d}_{uuid.uuid4().hex[:12]}', status='building', expected_rows=chunk['expected_rows']))
        persist(state)
    attempt = attempts[-1]
    table = DB + '.' + attempt['table']
    operation(client, state, attempt, 'create', typed_ddl(table), 60)
    projection = raw_projection(SNAPSHOT) + ' WHERE ' + predicate(chunk)
    if 'partition_preflight' not in attempt:
        limits = read(client, state, 'partition-limit', "SELECT value FROM system.settings WHERE name='max_partitions_per_insert_block'", 30)
        span = read(client, state, 'chunk-timestamp-range-' + str(index),
                    'SELECT min(timestamp),max(timestamp),uniqExact(toYYYYMM(timestamp)) FROM ' + SNAPSHOT + ' WHERE ' + predicate(chunk))
        attempt['partition_preflight'] = dict(limit=int(limits[0][0]), span=span)
        persist(state)
    preflight = attempt['partition_preflight']
    if preflight['limit'] and preflight['span'][0][2] > preflight['limit']:
        raise RuntimeError('Chunk exceeds enforced partition limit; stop to design disjoint monthly subchunks')
    # The server rejected a partition-limit override with code452. Use
    # tested inherited defaults; never discard historical partitions.
    insert = f'INSERT INTO {table} ' + projection
    operation(client, state, attempt, 'insert', insert, 1800)
    # Compact one monthly partition at a time. A whole-table OPTIMIZE
    # can flood the shared background pool even for a bounded 10M-row chunk.
    # This is logically idempotent maintenance; it never replays INSERT.
    if 'compact' in attempt and attempt['compact']['status'] != 'complete':
        query_terminal(client, state, attempt['compact'])
    compact_partitions(client, state, attempt, table)
    operation(client, state, attempt, 'freeze', f'ALTER TABLE {table} MODIFY SETTING {FROZEN}', 60)
    if 'validation' not in attempt:
        expected = read(client, state, 'chunk-source-fingerprint-' + str(index), fingerprint_sql(projection), 1800, fingerprint_threads=4)
        actual = read(client, state, 'chunk-typed-fingerprint-' + str(index), fingerprint_sql('SELECT ' + ','.join(COLUMNS) + ' FROM ' + table), 1800, fingerprint_threads=4)
        matches = expected == actual and len(actual) == 1 and actual[0][0] == chunk['expected_rows']
        attempt['validation'] = dict(expected=expected, actual=actual, matches=matches,
                                     note='Count/null counts exact; 128-bit sum and xor multiset fingerprints are probabilistic equality evidence, not a proof.')
        persist(state)
    if not attempt['validation']['matches']:
        raise RuntimeError('Chunk validation mismatch; preserve stage for investigation')
    attempt['parts'] = inventory(client, state, attempt['table'])
    if sum(p[2] for p in attempt['parts']) != chunk['expected_rows']:
        raise RuntimeError('Stage part count mismatch')
    if len(attempt['parts']) != attempt['validation']['actual'][0][3]:
        raise RuntimeError('Compaction did not leave exactly one part per monthly partition')
    verify_snapshot(client, state)
    attempt['status'] = 'complete'
    attempt['completed_utc'] = datetime.now(timezone.utc).isoformat()
    persist(state)
    print('COMPLETE chunk', index, chunk['expected_rows'], 'rows', len(attempt['parts']), 'parts', sum(p[3] for p in attempt['parts']), 'bytes', flush=True)


def compact_partitions(client, state, attempt, table):
    if 'compaction_plan' not in attempt:
        parts = inventory(client, state, attempt['table'])
        counts = Counter(p[1] for p in parts)
        attempt['compaction_plan'] = sorted(partition for partition, count in counts.items() if count > 1)
        persist(state)
    for partition in attempt['compaction_plan']:
        if not re.fullmatch(r'[0-9]+', partition):
            raise RuntimeError('Unexpected monthly partition identifier')
        key = 'compact_partition_' + partition
        count_sql = f"SELECT count() FROM system.parts WHERE database='{DB}' AND table='{attempt['table']}' AND active AND partition_id='{partition}'"
        # Automatic stage merges may finish while preceding months compact.
        # Check before scheduling another FINAL; keep uncertain operations on
        # the existing journal reconciliation path even if parts now look done.
        if key not in attempt:
            current = read(client, state, 'compaction-before', count_sql, 30)
            if current[0][0] == 1:
                attempt.setdefault('compaction_already_finished', []).append(partition)
                persist(state)
                continue
            if current[0][0] < 1:
                raise RuntimeError('Compaction partition disappeared')
        operation(client, state, attempt, key, f"OPTIMIZE TABLE {table} PARTITION ID '{partition}' FINAL", 900)
        # alter_sync may be zero, so a successful HTTP response can mean
        # scheduled, not completed. Wait on physical completion before moving
        # to the next partition; retain finite progress and deadline.
        deadline = time.monotonic() + 900
        while True:
            rows = read(client, state, 'compaction-progress',
                        f"SELECT count() FROM system.parts WHERE database='{DB}' AND table='{attempt['table']}' AND active AND partition_id='{partition}'", 30)
            if rows[0][0] == 1:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Compaction not complete before deadline; resume safely later')
            time.sleep(0.2)


def abandon(client, state, index):
    attempt = state['chunks'][str(index)][-1]
    if stage_complete(attempt):
        raise RuntimeError('Cannot abandon completed stage')
    for key in ('create','insert','compact','freeze'):
        if key in attempt and attempt[key]['status'] != 'complete':
            query_terminal(client, state, attempt[key])
    # Preserve failed table as evidence. No DELETE/DROP and no replay.
    attempt['status'] = 'abandoned'
    persist(state)


def table_uuid(client, state, table):
    rows = read(client, state, 'table-uuid', f"SELECT toString(uuid) FROM system.tables WHERE database='{DB}' AND name='{table}'", 30)
    return rows[0][0] if rows else None


def assemble(client, state, plan, fixture=False):
    verify_snapshot(client, state)
    selected = [(index, entries[-1]) for index, entries in state['chunks'].items() if stage_complete(entries[-1])]
    selected.sort(key=lambda pair: int(pair[0]))
    if not selected:
        raise RuntimeError('No complete stages')
    if not fixture and len(selected) != len(plan):
        raise RuntimeError('All chunks must complete before full assembly')
    key = digest([(index, attempt['table']) for index, attempt in selected])
    assemblies = state['assemblies']
    if not assemblies or assemblies[-1].get('abandoned') or assemblies[-1]['key'] != key:
        assemblies.append(dict(table=('fixture_' if fixture else 'typed_build_') + uuid.uuid4().hex[:12], key=key, attached=[], fixture=fixture))
        persist(state)
    assembly = assemblies[-1]
    table = DB + '.' + assembly['table']
    operation(client, state, assembly, 'create', typed_ddl(table) + ' SETTINGS ' + FROZEN, 60)
    if 'uuid' not in assembly:
        assembly['uuid'] = table_uuid(client, state, assembly['table'])
        persist(state)
    expected = []
    for index, attempt in selected:
        stage_parts = inventory(client, state, attempt['table'])
        if payloads(stage_parts) != payloads(attempt['parts']):
            raise RuntimeError('Stage inventory drift before attach')
        if index in assembly['attached']:
            expected += stage_parts
            continue
        current = inventory(client, state, assembly['table'])
        outcome = attach_state(current, expected, stage_parts)
        op_key = 'attach_' + index
        if op_key in assembly:
            op = assembly[op_key]
            if op['status'] != 'complete':
                query_terminal(client, state, op)
            if outcome != 'complete':
                # Never blindly attach again, even if no data is visible.
                assembly['abandoned'] = True
                assembly['abandon_reason'] = 'Uncertain/partial attach; rebuild from retained stages on next invocation'
                persist(state)
                raise RuntimeError(assembly['abandon_reason'])
        else:
            if payloads(current) != payloads(expected):
                raise RuntimeError('Unexpected assembly inventory before attach')
            operation(client, state, assembly, op_key, f'ALTER TABLE {table} ATTACH PARTITION ALL FROM {DB}.{attempt["table"]}', 900)
            current = inventory(client, state, assembly['table'])
            if attach_state(current, expected, stage_parts) != 'complete':
                raise RuntimeError('Attach payload identity mismatch; stop for reconciliation')
        assembly['attached'].append(index)
        expected += stage_parts
        persist(state)
    actual = inventory(client, state, assembly['table'])
    if payloads(actual) != payloads(expected):
        raise RuntimeError('Final assembly inventory mismatch')
    assembly['validation'] = dict(rows=sum(p[2] for p in actual), parts=len(actual), referenced_bytes=sum(p[3] for p in actual), matches=True)
    assembly['status'] = 'complete'
    verify_snapshot(client, state)
    persist(state)
    print('COMPLETE assembly', assembly['table'], assembly['validation'], flush=True)
    return assembly


def verify_assembly_payloads(client, state, plan, assembly):
    expected = []
    for index in range(len(plan)):
        attempts = state['chunks'].get(str(index), [])
        if not attempts or not stage_complete(attempts[-1]):
            raise RuntimeError('Incomplete stage set before publication')
        expected += attempts[-1]['parts']
    if sum(p[2] for p in expected) != sum(chunk['expected_rows'] for chunk in plan):
        raise RuntimeError('Full assembly expected row count mismatch')
    actual = inventory(client, state, assembly['table'])
    if payloads(actual) != payloads(expected):
        raise RuntimeError('Full assembly payload drift before publication')


def publish(client, state, plan):
    assembly = state['assemblies'][-1]
    if assembly.get('fixture') or assembly.get('status') != 'complete' or assembly.get('abandoned'):
        raise RuntimeError('Only a completed full assembly can be published')
    if assembly['validation']['rows'] != sum(chunk['expected_rows'] for chunk in plan):
        raise RuntimeError('Incomplete full assembly')
    verify_snapshot(client, state)
    published_uuid = table_uuid(client, state, 'typed')
    building_uuid = table_uuid(client, state, assembly['table'])
    outcome = publication_state(published_uuid, building_uuid, assembly['uuid'])
    if outcome == 'ambiguous':
        raise RuntimeError('Publication UUID mismatch; refusing overwrite')
    if outcome == 'not_applied':
        verify_assembly_payloads(client, state, plan, assembly)
        # Publication is a single atomic rename in this database. Keep merges
        # disabled until rename reconciliation has finished.
        operation(client, state, assembly, 'publish', f'RENAME TABLE {DB}.{assembly["table"]} TO {DB}.typed', 60)
        if publication_state(table_uuid(client,state,'typed'), table_uuid(client,state,assembly['table']), assembly['uuid']) != 'complete':
            raise RuntimeError('Publication UUID verification failed')
    elif 'publish' not in assembly:
        raise RuntimeError('Destination appeared without recorded publication')
    elif assembly['publish']['status'] != 'complete':
        if not query_terminal(client, state, assembly['publish']):
            raise RuntimeError('Publication terminal evidence conflicts with UUIDs')
        assembly['publish']['status'] = 'complete'
        assembly['publish']['recovered'] = True
        persist(state)
    operation(client, state, assembly, 'enable_merges', f'ALTER TABLE {DB}.typed RESET SETTING max_bytes_to_merge_at_max_space_in_pool,max_bytes_to_merge_at_min_space_in_pool,min_age_to_force_merge_seconds', 60)
    assembly['published'] = True
    persist(state)
    print('PUBLISHED', DB + '.typed', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['load','abandon','assemble','fixture','publish','status'])
    parser.add_argument('--chunk', type=int, action='append')
    parser.add_argument('--max-chunks', type=int, default=1)
    args = parser.parse_args()
    with exclusive(HERE):
        state, plan = initialize()
        if args.action == 'status':
            print(json.dumps(dict(completed=[k for k,v in state['chunks'].items() if stage_complete(v[-1])], total_chunks=len(plan), assemblies=state['assemblies']), indent=2))
            return
        client = Client()
        try:
            if args.action == 'load':
                indexes = args.chunk if args.chunk else [i for i in range(len(plan)) if not state['chunks'].get(str(i)) or not stage_complete(state['chunks'][str(i)][-1])][:args.max_chunks]
                for index in indexes:
                    if index < 0 or index >= len(plan):
                        raise ValueError('Invalid chunk index')
                    stage_chunk(client, state, plan, index)
            elif args.action == 'abandon':
                if not args.chunk:
                    raise ValueError('Explicit --chunk required')
                for index in args.chunk:
                    abandon(client, state, index)
            elif args.action in ('assemble','fixture'):
                assemble(client, state, plan, fixture=args.action == 'fixture')
            else:
                publish(client, state, plan)
        finally:
            if client.connection:
                client.connection.close()

if __name__ == '__main__':
    main()
