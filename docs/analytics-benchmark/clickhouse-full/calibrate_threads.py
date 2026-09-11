"""Read-only two/four-thread calibration on an already verified bounded chunk."""
import json
from datetime import datetime, timezone
import time
import uuid
from build import Client, HERE, SNAPSHOT, COLUMNS, save, raw_projection
from loader import exclusive, initialize, verify_snapshot, read, predicate, fingerprint_sql

with exclusive(HERE):
    state, plan = initialize()
    client = Client()
    try:
        verify_snapshot(client, state)
        active = read(client, state, 'pre-calibration-active', "SELECT query_id,elapsed FROM clusterAllReplicas('default',system.processes) WHERE query_id LIKE 'full-loader-write-%' OR query_id LIKE 'full-loader-read-%'", 30)
        if active:
            # The monitoring read can include itself. Only completed writes and
            # no other potentially expensive full-loader requests may remain.
            active = [row for row in active if float(row[1]) > 0.2]
            if active:
                raise RuntimeError('Previous loader query remains active; wait before calibration')
        projection = raw_projection(SNAPSHOT) + ' WHERE ' + predicate(plan[1])
        report = {'utc':datetime.now(timezone.utc).isoformat(), 'chunk':1, 'samples':[]}
        for threads in (2,4):
            start = time.monotonic()
            query_id = 'full-thread-calibration-' + str(uuid.uuid4())
            sql = fingerprint_sql(projection) + f' SETTINGS max_threads={threads} FORMAT JSON'
            observation, rows = client.query(sql, timeout=1800, mutation=True, query_id=query_id)
            save(HERE / 'evidence' / (query_id + '.json'), dict(sql=sql, observation=observation, rows=rows))
            if observation['status'] != 'complete':
                raise RuntimeError('Calibration request failed; see ' + query_id)
            result = json.loads(json.dumps(rows, default=str))
            matches = result == state['chunks']['1'][-1]['validation']['expected']
            report['samples'].append({'threads':threads,'seconds':time.monotonic()-start,'matches':matches,'query_id':query_id})
            save(HERE / 'thread-calibration-readonly0.json', report)
            if not matches:
                raise RuntimeError('Calibration fingerprint differs from verified reference')
        print(json.dumps(report), flush=True)
    finally:
        if client.connection:
            client.connection.close()
