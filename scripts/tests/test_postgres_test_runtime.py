"""Local test-server environment must not inherit the user's account-demo seed."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "postgres_test_runtime", Path(__file__).parents[1] / "postgres_test_runtime.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PostgresRuntimeIsolationTest(unittest.TestCase):
    def test_smoke_environment_clears_demo_import_without_mutating_parent(self):
        inherited = {
            "TEST_DATABASE_URL": "jdbc:postgresql://127.0.0.1:5432/test?currentSchema=public",
            "DEMO_SEED_PATH": "data/demo/unrelated-private-run.json",
            "DEMO_MODE": "true",
            "LEGACY_DB_PATH": "unrelated.sqlite3",
        }
        with patch.dict(module.os.environ, inherited, clear=True), patch.object(module.subprocess, "run") as launch:
            child = {**module.os.environ, **module.isolated_postgres("seed_guard")}
            self.assertEqual(child["DEMO_SEED_PATH"], "")
            self.assertEqual(child["DEMO_MODE"], "false")
            self.assertEqual(child["LEGACY_DB_PATH"], "")
            self.assertTrue(child["DB_SCHEMA"].startswith("http_seed_guard_"))
            self.assertNotIn("currentSchema=public", child["DATABASE_URL"])
            self.assertEqual(module.os.environ["DEMO_SEED_PATH"], inherited["DEMO_SEED_PATH"])
            self.assertEqual(module.os.environ["DEMO_MODE"], "true")
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
