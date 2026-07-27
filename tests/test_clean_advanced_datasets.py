import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from clean_advanced_datasets import clean_calculus, clean_upper  # noqa: E402


class RetiredCalculusImportTests(unittest.TestCase):
    def test_valid_looking_legacy_row_is_still_quarantined(self):
        row = {
            "id": "calc-schaum-example",
            "type": "mcq",
            "prompt": "What is the value of this otherwise valid-looking expression?",
            "choices": ["1", "2", "3", "4", "5"],
            "answerIndex": 2,
            "answerKey": "C",
            "answer": "3",
        }

        cleaned, report = clean_calculus([row])

        self.assertEqual(cleaned, [])
        self.assertEqual(report["kept_count"], 0)
        self.assertEqual(report["dropped_count"], 1)
        self.assertEqual(
            report["drop_reasons"],
            {"unverified_synthetic_choices": 1},
        )

    def test_retired_bank_and_quality_report_stay_explicit(self):
        rows = json.loads(
            (ROOT / "data" / "calculus_mcq.json").read_text(encoding="utf-8")
        )
        report = json.loads(
            (ROOT / "data" / "calculus_mcq_quality_report.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(rows, [])
        self.assertEqual(report["pipeline_stage"], "retired_untrusted_import")
        self.assertEqual(report["input_count"], 144)
        self.assertEqual(report["kept_count"], 0)
        self.assertEqual(report["dropped_count"], 144)
        self.assertEqual(
            report["drop_reasons"],
            {"unverified_synthetic_choices": 144},
        )

    def test_research_extractor_cannot_overwrite_active_bank(self):
        source = (ROOT / "scripts" / "import_calculus_pdf_mcq.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('OUT = Path("data/calculus_mcq_unverified.json")', source)
        self.assertIn(
            'REPORT = Path("data/calculus_mcq_unverified_report.json")',
            source,
        )
        self.assertNotIn('OUT = Path("data/calculus_mcq.json")', source)

    def test_curated_upper_bank_validation_preserves_every_row_and_id(self):
        rows = json.loads(
            (ROOT / "data" / "upper_level_mcq.json").read_text(encoding="utf-8")
        )
        before = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        before_ids = [row["id"] for row in rows]

        cleaned, report = clean_upper(rows)

        self.assertEqual(
            json.dumps(cleaned, ensure_ascii=False, separators=(",", ":")),
            before,
        )
        self.assertEqual([row["id"] for row in cleaned], before_ids)
        self.assertEqual(report["pipeline_stage"], "curated_validation_only")
        self.assertEqual(report["kept_count"], 44)
        self.assertEqual(report["dropped_count"], 0)


if __name__ == "__main__":
    unittest.main()
