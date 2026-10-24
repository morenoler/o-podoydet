import gzip
import hashlib
import json
import unittest
from pathlib import Path
from window_view.api import Application, ROOT


class PackagingTests(unittest.TestCase):
    def test_all_packaged_bytes_match_manifest_and_load_offline(self):
        index = json.loads((ROOT / "data/scenes.json").read_text(encoding="utf-8"))
        app = Application(allow_network=False)
        for key, entry in index.items():
            with self.subTest(scene=key):
                raw = (ROOT / entry["path"]).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), entry["sha256"])
                self.assertEqual(bool(app.scene(key).get("is_demo")), entry["is_demo"])

    def test_real_snapshot_preserves_unknown_heights_and_current_normalizer(self):
        scene = Application().scene("batumi-radisson")
        self.assertEqual(scene["algorithm_version"], "osm-normalizer/1.1")
        self.assertFalse(scene["is_demo"])
        self.assertGreater(sum(b["height_basis"] == "unknown" for b in scene["buildings"]), 0)
        self.assertEqual(len(scene["terrain"]["samples"]), 600)

    def test_committed_openapi_requires_floor_and_served_examples_validate(self):
        from window_view.validation import validate_request
        schema = json.loads((ROOT / "openapi.json").read_text(encoding="utf-8"))
        self.assertIn("floor", schema["components"]["schemas"]["EstimateRequest"]["required"])
        for path in (ROOT / "examples").glob("*.json"):
            if ".result." not in path.name:
                with self.subTest(example=path.name):
                    validate_request(json.loads(path.read_text(encoding="utf-8")))
