import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DataWriterSafetyTests(unittest.TestCase):
    def read_script(self, name: str) -> str:
        return (ROOT / "scripts" / name).read_text(encoding="utf-8")

    def test_amio_import_targets_an_unverified_directory(self):
        source = self.read_script("import_amio_contests.py")
        self.assertIn("OUT = Path('data/amio_unverified')", source)
        self.assertIn(
            "DIAGRAMS_DIR = Path('data/amio_unverified_assets')",
            source,
        )
        self.assertNotRegex(
            source,
            re.compile(r"^OUT\s*=\s*Path\(['\"]data['\"]\)", re.MULTILINE),
        )
        self.assertNotIn("DIAGRAMS_DIR = Path('assets/diagrams')", source)

    def test_kaggle_import_cannot_replace_curated_aime(self):
        source = self.read_script("import_kaggle_aime.py")
        self.assertIn(
            "DST = Path('data/aime_kaggle_unverified.json')",
            source,
        )
        self.assertNotIn("DST = Path('data/aime.json')", source)

    def test_synthetic_generator_is_seeded_and_writes_preview_files(self):
        source = self.read_script("generate_problem_banks.js")
        self.assertIn("ROTBLOCKER_BANK_SEED", source)
        self.assertNotIn("Math.random()", source)
        self.assertIn("`${name}_synthetic_preview.json`", source)
        self.assertNotIn("`${name}.json`", source)

    def test_artifact_generator_requires_an_explicit_version(self):
        source = self.read_script("generate_artifacts.py")
        self.assertRegex(
            source,
            re.compile(
                r'parser\.add_argument\(\s*"--version",\s*required=True,',
                re.MULTILINE,
            ),
        )
        self.assertIn("--allow-historical-overwrite", source)


if __name__ == "__main__":
    unittest.main()
