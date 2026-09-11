import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pilot import result_digest, ch_rows, raw_projection, sql_for

class PilotTests(unittest.TestCase):
    def test_exact_multiset(self):
        self.assertEqual(result_digest([(1, Decimal('2.000'), None)]), result_digest([(Decimal('1'), 2, None)]))
        self.assertNotEqual(result_digest([(1,), (1,)]), result_digest([(1,)]))
        self.assertNotEqual(result_digest([(None,)]), result_digest([('',)]))
        self.assertEqual(result_digest([(datetime(2026, 9, 7, tzinfo=timezone.utc),)]), result_digest([(datetime(2026, 9, 7),)]))
    def test_json_conversion(self):
        payload = dict(meta=[dict(name='n', type='UInt64'), dict(name='v', type='Nullable(Decimal(38,6))')], data=[dict(n='9007199254740993', v='0.123456')], rows=1, statistics={})
        self.assertEqual(ch_rows(payload), [(9007199254740993, Decimal('0.123456'))])
        payload['rows'] = 2
        with self.assertRaises(ValueError): ch_rows(payload)
    def test_raw_semantics(self):
        query = raw_projection('bench.raw')
        self.assertIn("'Nullable(String)'", query)
        self.assertIn("toDecimal128", query)
        self.assertIn("'welcomeBoxABTest'", query)
    def test_lookback_preserved(self):
        query = sql_for('raw', 'metadata_join', 'day', {'environment':'lesswrong.com'})
        self.assertIn('2026-08-31', query)
        self.assertIn('604800', query)
        self.assertIn('canonical_events m', query)

if __name__ == '__main__': unittest.main()
