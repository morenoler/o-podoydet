import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("noise_import", Path(__file__).parents[1] / "import-noise-report.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NoiseReportTest(unittest.TestCase):
    def fixture(self):
        return "부산광역시 3-7 25\n" + "\n".join(s + " 66 67 68" for s in module.STATIONS) + "\n표 부산광역시 야간 3-8\n" + "\n".join(s + " 55 56 57" for s in module.STATIONS) + "\n3-9"

    def test_selects_year_column(self):
        self.assertEqual([(r['dayDbA'], r['nightDbA']) for r in module.parse_tables(self.fixture())], [(66,55)]*5)

    def test_rejects_missing_row(self):
        with self.assertRaises(ValueError): module.parse_tables(self.fixture().replace(module.STATIONS[0], 'removed', 1))

    def test_rejects_duplicate_row(self):
        with self.assertRaises(ValueError): module.parse_tables(self.fixture() + '\n' + module.STATIONS[0] + ' 55 56 57')

    def test_rejects_implausible_values(self):
        with self.assertRaises(ValueError): module.parse_tables(self.fixture().replace('66 67 68', '166 67 68', 1))

    def test_rejects_changed_table(self):
        with self.assertRaises(ValueError): module.parse_tables(self.fixture().replace('3-7', '3-5'))

if __name__ == '__main__': unittest.main()
