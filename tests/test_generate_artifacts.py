import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts" / "generate_artifacts.py"


def mcq(problem_id: str, prompt: str, source: dict | None = None) -> dict:
    row = {
        "id": problem_id,
        "type": "mcq",
        "contest": "fixture",
        "label": "Fixture",
        "weight": 1,
        "prompt": prompt,
        "choices": ["1", "2", "3", "4", "5"],
        "answerIndex": 0,
        "answerKey": "A",
        "answer": "1",
    }
    if source is not None:
        row["source"] = source
    return row


class ArtifactManifestReproducibilityTests(unittest.TestCase):
    def test_identical_generation_preserves_manifest_and_source_date_epoch(self):
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            (work / "scripts").mkdir()
            (work / "data").mkdir()
            shutil.copyfile(GENERATOR, work / "scripts" / "generate_artifacts.py")

            calculus_path = work / "data" / "calculus_mcq_synthetic.json"
            gre_path = work / "data" / "upper_level_mcq.json"
            calculus_path.write_text(
                json.dumps([mcq("calc-1", "Compute $1+1$.")], indent=2) + "\n",
                encoding="utf-8",
            )
            gre_path.write_text(
                json.dumps(
                    [
                        mcq(
                            "gre-1",
                            "Choose one.",
                            {"dataset": "GREpractice"},
                        )
                    ],
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            base_env = {
                **os.environ,
                "PYTHONDONTWRITEBYTECODE": "1",
            }
            base_env.pop("SOURCE_DATE_EPOCH", None)

            def run(env: dict[str, str]) -> bytes:
                result = subprocess.run(
                    [
                        sys.executable,
                        "-B",
                        "scripts/generate_artifacts.py",
                        "--version",
                        "vtest",
                        "--allow-historical-overwrite",
                        "--gre-source-policy",
                        "all",
                    ],
                    cwd=work,
                    env=env,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                return (work / "artifacts" / "manifest_vtest.json").read_bytes()

            first = run(base_env)
            second = run(base_env)
            self.assertEqual(second, first)

            first_payload = json.loads(first)
            calculus_path.write_text(
                json.dumps([mcq("calc-1", "Compute $2+2$.")], indent=2) + "\n",
                encoding="utf-8",
            )
            reproducible_env = {
                **base_env,
                "SOURCE_DATE_EPOCH": "946684800",
            }
            changed = run(reproducible_env)
            changed_payload = json.loads(changed)
            self.assertNotEqual(
                changed_payload["inputs"]["calculus"]["sha256"],
                first_payload["inputs"]["calculus"]["sha256"],
            )
            self.assertEqual(
                changed_payload["generated_at_utc"],
                "2000-01-01T00:00:00+00:00",
            )
            self.assertEqual(run(reproducible_env), changed)

    def test_version_is_required_to_prevent_accidental_v1_overwrite(self):
        result = subprocess.run(
            [sys.executable, "-B", str(GENERATOR)],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--version", result.stderr)

    def test_version_rejects_path_traversal_before_writing(self):
        sentinel = (ROOT / "data" / "amc8.json").read_bytes()
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(GENERATOR),
                "--version",
                "../../../data/amc8",
                "--allow-historical-overwrite",
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("version must match", result.stderr)
        self.assertEqual((ROOT / "data" / "amc8.json").read_bytes(), sentinel)


if __name__ == "__main__":
    unittest.main()
