import hashlib
import json
import random
import re
import sys
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_calculus_synthetic import (  # noqa: E402
    CORE_COUNT,
    SUPPLEMENT_COUNT,
    SUPPLEMENT_DATASET_NAME,
    build_dataset,
    gen_plot_odd_fact,
)


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


class CalculusV4SupplementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows, cls.report = build_dataset(total=400, seed=20260221)
        cls.supplement = cls.rows[CORE_COUNT:]

    def test_preserves_the_v3_core_exactly(self):
        serialized_core = []
        for original in self.rows[:CORE_COUNT]:
            row = dict(original)
            diagram_name = row.pop("_diagramSvgName", None)
            row.pop("_diagramSvgContent", None)
            if diagram_name:
                row["diagramSvg"] = f"assets/diagrams/{diagram_name}"
            serialized_core.append(row)
        payload = (json.dumps(serialized_core, indent=2) + "\n").encode()
        self.assertEqual(
            hashlib.sha256(payload).hexdigest(),
            "5d3e2cf7a5f8d60a5690d5dac30228f653bcde239b24c188b2554e72cc16bd61",
        )

    def test_exact_size_family_caps_and_difficulty_mix(self):
        self.assertEqual(len(self.rows), 400)
        self.assertEqual(len(self.supplement), SUPPLEMENT_COUNT)
        family_counts = Counter(row["source"]["template"] for row in self.supplement)
        self.assertEqual(len(family_counts), 16)
        self.assertEqual(set(family_counts.values()), {5})
        self.assertEqual(
            Counter(row["source"]["difficulty"] for row in self.supplement),
            {"foundational": 20, "standard": 40, "challenging": 20},
        )
        self.assertEqual(self.report["supplement_family_usage"], dict(family_counts))

    def test_ids_and_provenance_are_stable_and_complete(self):
        expected_ids = {
            f"calcv4-{family}-{variant:02d}"
            for family in self.report["supplement_family_usage"]
            for variant in range(1, 6)
        }
        self.assertEqual({row["id"] for row in self.supplement}, expected_ids)
        for row in self.supplement:
            self.assertNotIn("difficulty", row)
            self.assertNotIn("diagramSvg", row)
            source = row["source"]
            self.assertEqual(source["dataset"], SUPPLEMENT_DATASET_NAME)
            for field in ("template", "concept", "difficulty", "verifier"):
                self.assertTrue(source[field])

    def test_answer_keys_and_choices_are_consistent(self):
        for row in self.rows:
            index = row["answerIndex"]
            self.assertEqual(len(row["choices"]), 5)
            self.assertEqual(len(set(row["choices"])), 5)
            self.assertEqual(row["answer"], row["choices"][index])
            self.assertEqual(row["answerKey"], "ABCDE"[index])

    def test_one_independently_computed_answer_per_family(self):
        # These values follow directly from the displayed first variant and do
        # not invoke the generator's answer formulas.
        expected = {
            "implicit-differentiation": "$\\frac{-3}{4}$",  # -x/y at (3,4)
            "mean-value-theorem": "3",  # midpoint of [1,5]
            "improper-p-integral": "$\\frac{1}{2}$",  # int_1^inf x^-3
            "taylor-coefficient": "$\\frac{4}{3}$",  # 2^3/3!
            "related-rates-sphere": "48",  # 4(2^2)(3)
            "ftc-chain-rule": "6",  # 2(1)(1^2+2)
            "u-substitution": "$\\frac{7}{3}$",  # [(x^2+1)^3/3]_0^1
            "integration-by-parts": "$\\frac{1}{6}$",  # int_0^1 x(1-x)
            "power-series-radius": "$\\frac{5}{2}$",  # |2(x+1)/5|<1
            "polar-area": "9",  # circle r=6 cos(theta) has radius 3
            "directional-derivative": "$\\frac{22}{5}$",  # (2,4).(3/5,4/5)
            "jacobian": "2",  # |1*4-2*1|
            "limit-comparison": "$\\frac{2}{3}$",  # leading coefficients
            "lagrange-multipliers": "2",  # max xy on x^2+y^2=4
            "conservative-line-integral": "10",  # phi(1,2)-phi(1,0)
            "curl-component": "6",  # (1,2,3).(1,1,1)
        }
        first_by_family = {
            row["source"]["template"]: row
            for row in self.supplement
            if row["id"].endswith("-01")
        }
        self.assertEqual(set(first_by_family), set(expected))
        for family, answer in expected.items():
            self.assertEqual(first_by_family[family]["answer"], answer, family)

    def test_supplement_math_style_is_render_safe(self):
        for row in self.supplement:
            strings = [row["prompt"], *row["choices"], row["answer"]]
            for text in strings:
                self.assertNotRegex(text, r"(?:^|[^0-9])1[xyz]")
                self.assertNotIn("--", text)

    def test_generation_is_deterministic(self):
        again, again_report = build_dataset(total=400, seed=20260221)
        self.assertEqual(self.rows, again)
        self.assertEqual(self.report, again_report)


if __name__ == "__main__":
    unittest.main()
