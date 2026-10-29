"""A successful synthetic round trip must preserve both provenance markers."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("jury_demo", Path(__file__).parents[1] / "jury-demo.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class JuryProvenanceTest(unittest.TestCase):
    def run_demo(self, facts):
        responses = [
            [], {"results": []}, {"answers": [{"demo": True, "simulated": True}]},
            {"results": [{"hotel": {"id": "demo-harbor"}, "best": {
                "criteria": [{"feature": "courtyard", "status": "match", "facts": facts}]}}]},
            {"facts": facts},
        ]
        with patch.object(module, "build_opener") as opener, patch.object(module.sys, "stdout", new_callable=io.StringIO) as output:
            opener.return_value.open.side_effect = [io.StringIO(json.dumps(item)) for item in responses]
            module.run("http://127.0.0.1:8081")
            return json.loads(output.getvalue())

    def test_round_trip_preserves_both_markers_on_the_same_fact(self):
        report = self.run_demo([{"demo": True, "simulated": True}])
        self.assertEqual((report["before"], report["after"]), (0, 1))
        self.assertFalse(report["repeatRun"])

    def test_missing_or_split_provenance_markers_fail_the_smoke(self):
        for facts in ([{"demo": True}], [{"simulated": True}], [{"demo": True}, {"simulated": True}]):
            with self.subTest(facts=facts), self.assertRaisesRegex(ValueError, "synthetic provenance"):
                self.run_demo(facts)


if __name__ == "__main__":
    unittest.main()
