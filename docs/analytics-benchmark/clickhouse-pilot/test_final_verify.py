import unittest
from final_verify import same_rows


class MetadataComparisonTests(unittest.TestCase):
    def test_live_tuples_equal_saved_json_arrays(self):
        self.assertTrue(same_rows([('DDL',123)], [['DDL',123]]))

    def test_real_metadata_difference_is_not_hidden(self):
        self.assertFalse(same_rows([('DDL',124)], [['DDL',123]]))


if __name__ == '__main__':
    unittest.main()
