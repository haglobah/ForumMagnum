import json
from pathlib import Path
import tempfile
import unittest
import loader


class RecoveryTests(unittest.TestCase):
    def test_unknown_insert_never_replays(self):
        for status in ('submitted', 'error', 'complete'):
            self.assertFalse(loader.may_submit({'insert': {'status': status}}))
        self.assertTrue(loader.may_submit({}))

    def test_partial_failed_stage_is_never_reused(self):
        for entry in ({'insert': {'status': 'error'}, 'actual_rows': 5},
                      {'insert': {'status': 'submitted'}, 'actual_rows': 10}):
            self.assertFalse(loader.stage_complete(entry))
        self.assertTrue(loader.stage_complete({'status': 'complete', 'validation': {'matches': True}}))

    def test_inventory_checks_identity_and_multiplicity(self):
        parts = [['p1', '202001', 10, 100, 'aaa'], ['p2', '202001', 10, 100, 'aaa']]
        self.assertEqual(loader.payloads(parts), loader.payloads([['other', *p[1:]] for p in parts]))
        self.assertNotEqual(loader.payloads(parts), loader.payloads(parts[:1]))

    def test_attach_reconciliation_never_accepts_partial_or_extra(self):
        before = [['a','202001',10,100,'aaa']]
        chunk = [['b','202002',20,200,'bbb']]
        self.assertEqual(loader.attach_state(before, before, chunk), 'not_applied')
        self.assertEqual(loader.attach_state(before + chunk, before, chunk), 'complete')
        self.assertEqual(loader.attach_state(before + chunk + chunk, before, chunk), 'ambiguous')
        self.assertEqual(loader.attach_state([], before, chunk), 'ambiguous')

    def test_manifest_drift_aborts(self):
        expected = [['p','all',10,100,'old']]
        loader.assert_snapshot(expected, expected)
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            loader.assert_snapshot(expected, [['p','all',10,100,'new']])
        with self.assertRaisesRegex(RuntimeError, 'drift'):
            loader.assert_snapshot(expected, [['renamed','all',10,100,'old']])

    def test_publish_recovery_requires_recorded_uuid(self):
        self.assertEqual(loader.publication_state('expected', None, 'expected'), 'complete')
        self.assertEqual(loader.publication_state(None, 'expected', 'expected'), 'not_applied')
        for published, building in [('foreign', None), ('expected','expected'), (None,None)]:
            self.assertEqual(loader.publication_state(published,building,'expected'), 'ambiguous')

    def test_publication_requires_current_payloads_and_exact_row_count(self):
        from unittest.mock import Mock, patch
        parts = [['a', '202001', 10, 100, 'aaa']]
        state = {'chunks': {'0': [{'status': 'complete', 'table': 'chunk_a',
                  'parts': parts, 'validation': {'matches': True}}]}}
        assembly = {'table': 'building', 'validation': {'rows': 10, 'matches': True}}
        with patch.object(loader, 'inventory', return_value=parts):
            loader.verify_assembly_payloads(Mock(), state, [{'expected_rows': 10}], assembly)
        with patch.object(loader, 'inventory', return_value=[['b', '202001', 10, 100, 'other']]):
            with self.assertRaisesRegex(RuntimeError, 'payload'):
                loader.verify_assembly_payloads(Mock(), state, [{'expected_rows': 10}], assembly)
        with patch.object(loader, 'inventory', return_value=parts):
            with self.assertRaisesRegex(RuntimeError, 'row count'):
                loader.verify_assembly_payloads(Mock(), state, [{'expected_rows': 11}], assembly)

    def test_filesystem_lock_excludes_second_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            with loader.exclusive(Path(directory)):
                with self.assertRaisesRegex(RuntimeError, 'locked'):
                    with loader.exclusive(Path(directory)):
                        pass

    def test_fingerprint_covers_every_column_with_null_presence(self):
        sql = loader.fingerprint_sql('SELECT * FROM t')
        for column in loader.COLUMNS:
            self.assertIn(f'tuple(isNull({column}),', sql)
        self.assertIn('sumWithOverflow', sql)
        self.assertIn('groupBitXor', sql)
        self.assertIn('sipHash128', sql)


class ExecutionTests(unittest.TestCase):
    def test_compaction_skips_partition_already_merged_and_checks_pending_work(self):
        from unittest.mock import Mock, patch
        attempt = {'table': 'chunk', 'compaction_plan': ['202001', '202002']}
        with patch.object(loader, 'persist'), \
             patch.object(loader, 'read', side_effect=[[[1]], [[2]], [[2]], [[1]]]), \
             patch.object(loader, 'operation') as operation, \
             patch.object(loader.time, 'sleep') as sleep:
            loader.compact_partitions(Mock(), {}, attempt, 'isolated.chunk')
        self.assertEqual(operation.call_count, 1)
        self.assertEqual(operation.call_args.args[3], 'compact_partition_202002')
        sleep.assert_called_once_with(0.2)

    def test_only_fingerprint_select_uses_query_local_threads(self):
        from unittest.mock import Mock, patch
        client = Mock()
        client.query.return_value = ({'status': 'complete', 'elapsed_ms': 1}, [[10]])
        sql = loader.fingerprint_sql('SELECT * FROM isolated.chunk')
        with patch.object(loader, 'save'):
            loader.read(client, {}, 'fingerprint', sql, fingerprint_threads=4)
        self.assertEqual(client.query.call_args.args[0], sql + ' SETTINGS max_threads=4 FORMAT JSON')
        self.assertTrue(client.query.call_args.kwargs['mutation'])
        with self.assertRaisesRegex(ValueError, 'fingerprint SELECT'):
            loader.read(client, {}, 'invalid', 'DELETE FROM isolated.chunk', fingerprint_threads=4)
        self.assertEqual(client.query.call_count, 1)
        with patch.object(loader, 'save'):
            loader.read(client, {}, 'metadata', 'SELECT count() FROM isolated.chunk')
        self.assertNotIn('mutation', client.query.call_args.kwargs)

    def test_unknown_insert_outcome_requires_server_reconciliation(self):
        from unittest.mock import Mock, patch
        client = Mock()
        client.query.return_value = ({'status':'error','elapsed_ms':1,'detail':'lost connection'}, None)
        owner = {}
        with patch.object(loader, 'persist'), patch.object(loader, 'query_terminal', return_value=True):
            with self.assertRaisesRegex(RuntimeError, 'never automatically replayed'):
                loader.operation(client, {}, owner, 'insert', 'INSERT INTO isolated SELECT 1')
            loader.operation(client, {}, owner, 'insert', 'INSERT INTO isolated SELECT 1')
        self.assertEqual(client.query.call_count, 1)
        self.assertEqual(owner['insert']['status'], 'complete')
        self.assertTrue(owner['insert']['recovered'])

    def test_terminal_failed_insert_is_never_replayed(self):
        from unittest.mock import Mock, patch
        client = Mock()
        owner = {'insert': {'status':'error','sql':'INSERT INTO isolated SELECT 1','query_id':'q'}}
        with patch.object(loader, 'persist'), patch.object(loader, 'query_terminal', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'fresh attempt'):
                loader.operation(client, {}, owner, 'insert', 'INSERT INTO isolated SELECT 1')
        client.query.assert_not_called()

    def test_abandon_waits_for_terminal_evidence(self):
        from unittest.mock import Mock, patch
        state = {'chunks': {'0':[{'status':'building','insert':{'status':'submitted','query_id':'q'}}]}}
        with patch.object(loader, 'persist'), patch.object(loader, 'query_terminal', side_effect=RuntimeError('still active')):
            with self.assertRaisesRegex(RuntimeError, 'still active'):
                loader.abandon(Mock(), state, 0)
        self.assertEqual(state['chunks']['0'][0]['status'], 'building')

    def test_partial_attach_abandons_assembly_without_replay(self):
        from unittest.mock import Mock, patch
        parts = [['a','202001',10,100,'aaa'], ['b','202002',20,200,'bbb']]
        attempt = {'table':'chunk_test','status':'complete','validation':{'matches':True},'parts':parts}
        key = loader.digest([('0','chunk_test')])
        assembly = {'table':'fixture_test','key':key,'attached':[],'fixture':True,'uuid':'u',
                    'attach_0':{'status':'error','query_id':'q'}}
        state = {'chunks':{'0':[attempt]},'assemblies':[assembly]}
        with patch.object(loader,'persist'), patch.object(loader,'verify_snapshot'), \
             patch.object(loader,'inventory',side_effect=[parts,parts[:1]]), \
             patch.object(loader,'query_terminal',return_value=False), \
             patch.object(loader,'operation') as operation:
            with self.assertRaisesRegex(RuntimeError,'partial attach'):
                loader.assemble(Mock(),state,[{}],fixture=True)
        self.assertTrue(assembly['abandoned'])
        self.assertEqual(operation.call_count,1)
        self.assertEqual(operation.call_args.args[3],'create')

if __name__ == '__main__':
    unittest.main()
