import json
from pathlib import Path
import tempfile
import unittest
import build

class JournalTests(unittest.TestCase):
    def test_pending_and_failed_operations_block_retries(self):
        for status in ('submitted', 'error'):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'journal.json'
                path.write_text(json.dumps([{'label': 'clone', 'status': status}]))
                with self.assertRaisesRegex(RuntimeError, 'reconcile'):
                    build.check_new_operation(path, 'clone')

    def test_completed_operations_are_not_repeated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'journal.json'
            path.write_text(json.dumps([{'label': 'clone', 'status': 'complete'}]))
            with self.assertRaisesRegex(RuntimeError, 'already complete'):
                build.check_new_operation(path, 'clone')

    def test_new_operation_can_start(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(build.check_new_operation(Path(directory) / 'journal.json', 'clone'), [])

class ChunkTests(unittest.TestCase):
    def test_chunks_cover_every_row_once_including_partial_tail(self):
        parts = [('all_0_0_0', 'all', 11, 1, 'hash'), ('all_1_1_0', 'all', 4, 1, 'hash2')]
        chunks = build.chunk_plan(parts, 5)
        self.assertEqual([(c['part'], c['start'], c['end']) for c in chunks], [
            ('all_0_0_0', 0, 5), ('all_0_0_0', 5, 10), ('all_0_0_0', 10, 11), ('all_1_1_0', 0, 4)])
        self.assertEqual(sum(c['expected_rows'] for c in chunks), 15)

    def test_invalid_chunk_size_is_rejected(self):
        with self.assertRaises(ValueError):
            build.chunk_plan([], 0)

if __name__ == '__main__':
    unittest.main()
