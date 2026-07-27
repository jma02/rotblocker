import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORTER = ROOT / "scripts" / "import_amio_contests.py"


class AmioImporterRegressionTests(unittest.TestCase):
    def test_leading_tex_commands_survive_end_to_end_import(self):
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            source_dir = work / "third_party" / "amio_aops"
            source_dir.mkdir(parents=True)
            source = source_dir / "parsed_ArtOfProblemSolving.csv"
            with source.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=[
                        "problem_id",
                        "link",
                        "problem",
                        "answer",
                        "letter",
                        "solution",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "problem_id": "0123456789abcdef0123456789abcdef",
                        "link": (
                            "https://example.test/wiki/"
                            "2020_AMC_8_Problems/Problem_1"
                        ),
                        "problem": (
                            "Choose the first expression. "
                            "(A) \\frac{1}{2} "
                            "(B) \\sqrt{2} "
                            "(C) \\pi "
                            "(D) \\{1,2\\} "
                            "(E) 5"
                        ),
                        "answer": "",
                        "letter": "A",
                        "solution": "",
                    }
                )

            result = subprocess.run(
                [sys.executable, str(IMPORTER)],
                cwd=work,
                check=False,
                capture_output=True,
                text=True,
                env={"PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)

            rows = json.loads(
                (
                    work
                    / "data"
                    / "amio_unverified"
                    / "amc8.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(len(rows), 1)
            self.assertEqual(
                rows[0]["choices"],
                [r"\frac{1}{2}", r"\sqrt{2}", r"\pi", r"\{1,2\}", "5"],
            )
            self.assertEqual(rows[0]["answer"], r"\frac{1}{2}")


if __name__ == "__main__":
    unittest.main()
