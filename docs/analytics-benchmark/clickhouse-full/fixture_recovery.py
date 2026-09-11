"""Exercise real ATTACH recovery while injecting a lost successful response.

Only uses the verified stages and a disposable fixture assembly. The database
operation is real; the transport failure is explicitly simulated and recorded.
"""
from functools import partial
import time
from unittest.mock import patch
import loader


def injected_query(sql, timeout=180, mutation=False, query_id=None, *, original, tracker):
    observation, rows = original(sql, timeout=timeout, mutation=mutation, query_id=query_id)
    if mutation and ' ATTACH PARTITION ALL FROM ' in sql:
        tracker['attach_calls'] += 1
        if not tracker['injected'] and observation['status'] == 'complete':
            tracker['injected'] = True
            tracker['query_id'] = query_id
            return dict(status='error', query_id=query_id, elapsed_ms=observation['elapsed_ms'], detail='SIMULATED lost response after successful server ATTACH', simulated=True), None
    return observation, rows


def main():
    with loader.exclusive(loader.HERE):
        state, plan = loader.initialize()
        client = loader.Client()
        tracker = dict(injected=False, attach_calls=0)
        if state['assemblies'] and state['assemblies'][-1].get('fixture'):
            pending = [op for op in state['assemblies'][-1].values()
                       if isinstance(op, dict) and op.get('simulated')]
            if pending:
                tracker.update(injected=True, attach_calls=1, query_id=pending[0]['query_id'], resumed=True)
        original = client.query
        try:
            with patch.object(client, 'query', partial(injected_query, original=original, tracker=tracker)):
                if not tracker['injected']:
                    try:
                        loader.assemble(client, state, plan, fixture=True)
                    except RuntimeError as error:
                        if not tracker['injected']:
                            raise
                        tracker['observed_failure'] = str(error)
                    loader.save(loader.HERE / 'fixture-recovery.json', tracker)
                if not tracker['injected']:
                    raise RuntimeError('Fixture already complete; use fresh isolated test state')
                # Give the asynchronous query log time to flush before requiring
                # terminal server evidence. No database mutation is replayed.
                if client.connection:
                    client.connection.close()
                    client.connection = None
                time.sleep(10)
                assembly = loader.assemble(client, state, plan, fixture=True)
                tracker['assembly'] = assembly['table']
                tracker['validation'] = assembly['validation']
                tracker['passed'] = tracker['attach_calls'] == len(assembly['attached'])
                loader.save(loader.HERE / 'fixture-recovery.json', tracker)
                if not tracker['passed']:
                    raise RuntimeError('An ATTACH was replayed')
                print('PASS real attachment recovery; each stage attached exactly once', flush=True)
        finally:
            if client.connection:
                client.connection.close()

if __name__ == '__main__':
    main()
