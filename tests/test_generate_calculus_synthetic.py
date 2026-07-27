import random
import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_calculus_synthetic import build_dataset, gen_plot_odd_fact  # noqa: E402


class CalculusPlotGenerationTests(unittest.TestCase):
    def test_odd_plot_polyline_has_strictly_increasing_x_coordinates(self):
        for seed in range(500):
            with self.subTest(seed=seed):
                row = gen_plot_odd_fact(seed, random.Random(seed))
                svg = row["_diagramSvgContent"]
                match = re.search(r'<polyline points="([^"]+)"', svg)
                self.assertIsNotNone(match)
                x_coordinates = [
                    float(point.split(",", 1)[0])
                    for point in match.group(1).split()
                ]
                self.assertTrue(
                    all(
                        left < right
                        for left, right in zip(
                            x_coordinates,
                            x_coordinates[1:],
                        )
                    ),
                    x_coordinates,
                )

    def test_generated_plot_questions_are_unique_without_answer_leaks(self):
        rows, _report = build_dataset(total=320, seed=20260221)
        diagram_rows = [
            row for row in rows if row.get("_diagramSvgContent")
        ]
        signatures = [
            (
                row["prompt"],
                row["answer"],
                row["_diagramSvgContent"],
            )
            for row in diagram_rows
        ]

        self.assertEqual(len(signatures), len(set(signatures)))
        for row in diagram_rows:
            self.assertNotIn("Odd-symmetric", row["_diagramSvgContent"])

    def test_generated_prompts_do_not_use_plus_negative_constants(self):
        rows, _report = build_dataset(total=320, seed=20260221)
        self.assertFalse(
            [row["id"] for row in rows if "+-" in row["prompt"]]
        )

    def test_generated_math_omits_unit_coefficients(self):
        rows, _report = build_dataset(total=320, seed=20260221)
        strings = [
            text
            for row in rows
            for text in [
                row["prompt"],
                *row.get("choices", []),
                str(row.get("answer", "")),
            ]
        ]
        offenders = [
            text
            for text in strings
            if "1x" in text or "1y" in text
        ]
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
