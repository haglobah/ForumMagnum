import unittest
from datetime import timedelta
from advanced import candidate_sql
from queries import windows

class AdvancedTests(unittest.TestCase):
    def test_rollup_rejects_partial_hour(self):
        label,start,end=windows('hour')[0]
        with self.assertRaisesRegex(ValueError,'hour-aligned'):
            candidate_sql('rollup','traffic_day','hour',{},custom_windows=[(label,start+timedelta(seconds=1),end)])
    def test_rollup_rejects_unsupported_case(self):
        with self.assertRaises(ValueError): candidate_sql('rollup','user','hour',{})
    def test_metadata_retains_ranking_and_time_bounds(self):
        query=candidate_sql('metadata','metadata_join','hour',{})
        self.assertIn('ORDER BY m.occurred_at DESC,m.event_id DESC',query)
        self.assertIn('JOIN benchmark_20260910.metadata_compact m',query)
        self.assertIn('addSeconds(p.occurred_at, 5)',query)
    def test_funnel_one_base_scan(self):
        query=candidate_sql('funnel','feature_funnel','hour',{})
        self.assertEqual(query.count('FROM base'),1)
        self.assertIn('minOrNullIf',query)
if __name__=='__main__': unittest.main()
