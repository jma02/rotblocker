import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from import_gre_upper_level_mcq import (  # noqa: E402
    BOOT_A,
    BOOT_Q,
    BOOTCAMP_VERIFIED_ANSWER_OVERRIDES,
    BOOTCAMP_VERIFIED_ITEM_OVERRIDES,
    OUT,
    PRACTICE_VERIFIED_ITEM_OVERRIDES,
    PRACTICE_A,
    REPORT,
    apply_bootcamp_item_override,
    apply_practice_item_override,
    bootcamp_legacy_problem_set,
    parse_answer_key_simple,
    parse_mcq_blocks,
    read_pdf_text,
    split_bootcamp_sections,
)


class GreUpperLevelImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.question_sections = split_bootcamp_sections(read_pdf_text(BOOT_Q))
        cls.answer_sections = split_bootcamp_sections(read_pdf_text(BOOT_A))
        cls.section_keys = {
            section: parse_answer_key_simple(text)
            for section, text in cls.answer_sections.items()
        }
        cls.rows = json.loads(
            (ROOT / "data" / "upper_level_mcq.json").read_text(encoding="utf-8")
        )

    def test_bootcamp_pdfs_split_into_matching_stable_sections(self):
        expected_question_sections = [
            *(f"problem_set_{number}" for number in range(1, 11)),
            "linear_algebra_1",
            "linear_algebra_2",
            "abstract_algebra",
            "number_theory",
            "real_analysis",
            "topology",
            "combinatorics",
            "probability",
            "complex_analysis",
            "multivariable_calculus",
            "differential_equations",
        ]
        self.assertEqual(
            list(self.question_sections),
            expected_question_sections,
        )
        self.assertEqual(
            list(self.answer_sections),
            expected_question_sections[:-2],
        )
        self.assertEqual(bootcamp_legacy_problem_set("problem_set_2"), 2)
        self.assertEqual(bootcamp_legacy_problem_set("linear_algebra_1"), 10)
        self.assertEqual(
            bootcamp_legacy_problem_set("differential_equations"),
            10,
        )

    def test_raw_import_cannot_overwrite_the_curated_bank(self):
        self.assertEqual(OUT.name, "upper_level_mcq_unverified.json")
        self.assertEqual(REPORT.name, "upper_level_mcq_unverified_report.json")
        self.assertNotEqual(OUT, ROOT / "data" / "upper_level_mcq.json")

    def test_topical_sections_do_not_claim_to_be_problem_set_10(self):
        topical = next(
            question
            for question in parse_mcq_blocks(
                self.question_sections["linear_algebra_1"]
            )
            if question.qnum == 2
        )
        item = apply_bootcamp_item_override(
            {
                "id": "fixture",
                "type": "mcq",
                "prompt": topical.prompt,
                "choices": topical.choices,
                "answerIndex": 1,
                "answerKey": "B",
                "answer": topical.choices[1],
                "source": {
                    "dataset": "GREBootcamp",
                    "legacyProblemSet": 10,
                    "question": 2,
                    "section": "linear_algebra_1",
                },
            },
            "linear_algebra_1",
            2,
        )
        self.assertNotIn("problemSet", item["source"])
        self.assertEqual(item["source"]["legacyProblemSet"], 10)

    def test_repeated_question_numbers_never_share_an_answer_key(self):
        self.assertEqual(self.section_keys["problem_set_10"][2], "D")
        self.assertEqual(self.section_keys["linear_algebra_1"][2], "B")
        self.assertEqual(self.section_keys["number_theory"][4], "D")
        self.assertEqual(self.section_keys["linear_algebra_2"][4], "E")
        self.assertEqual(
            BOOTCAMP_VERIFIED_ANSWER_OVERRIDES[
                ("differential_equations", 4)
            ],
            "A",
        )

        problem_set_question = next(
            question
            for question in parse_mcq_blocks(
                self.question_sections["problem_set_10"]
            )
            if question.qnum == 2
        )
        linear_algebra_question = next(
            question
            for question in parse_mcq_blocks(
                self.question_sections["linear_algebra_1"]
            )
            if question.qnum == 2
        )
        self.assertIn("real 2", problem_set_question.prompt)
        self.assertIn("rank of A", linear_algebra_question.prompt)

    def test_source_layout_overrides_run_before_quality_filtering(self):
        item = {
            "prompt": "OCR prompt",
            "choices": ["A", "B", "C", "D", "footer noise"],
            "answerIndex": 2,
            "answerKey": "C",
            "answer": "C",
        }
        out = apply_bootcamp_item_override(
            item,
            "differential_equations",
            5,
        )
        self.assertIn(r"$y''-2y'+y=te^t$", out["prompt"])
        self.assertEqual(
            out["choices"][2],
            r"$C_1e^t+C_2te^t+\frac{1}{6}t^3e^t$",
        )
        self.assertNotIn("footer", " ".join(out["choices"]))
        self.assertEqual(out["answer"], out["choices"][2])
        self.assertIn(
            ("problem_set_7", 2),
            BOOTCAMP_VERIFIED_ITEM_OVERRIDES,
        )

    def test_all_44_retained_rows_match_their_true_source_key(self):
        self.assertEqual(len(self.rows), 44)
        practice_rows = [
            row
            for row in self.rows
            if row["source"]["dataset"] == "GREpractice"
        ]
        bootcamp_rows = [
            row
            for row in self.rows
            if row["source"]["dataset"] == "GREBootcamp"
        ]
        self.assertEqual(len(practice_rows), 11)
        self.assertEqual(len(bootcamp_rows), 33)

        practice_key = parse_answer_key_simple(read_pdf_text(PRACTICE_A))
        for row in practice_rows:
            with self.subTest(row_id=row["id"]):
                question = row["source"]["question"]
                self.assertEqual(row["answerKey"], practice_key[question])

        verified_ids = set()
        for row in bootcamp_rows:
            with self.subTest(row_id=row["id"]):
                source = row["source"]
                section = source["section"]
                question = source["question"]
                expected = BOOTCAMP_VERIFIED_ANSWER_OVERRIDES.get(
                    (section, question)
                )
                if expected is None:
                    expected = self.section_keys[section][question]
                self.assertEqual(row["answerKey"], expected)
                self.assertEqual(
                    row["answer"],
                    row["choices"][row["answerIndex"]],
                )
                verified_ids.add(row["id"])
        self.assertEqual(len(verified_ids), 33)

    def test_source_image_transcriptions_are_preserved_in_curated_rows(self):
        rows = {row["id"]: row for row in self.rows}
        self.assertEqual(
            rows["upper-gre-grebootcamp-s2-q3-7236172b"]["choices"][1],
            r"$3\cdot 2^{|S|}-3$",
        )
        self.assertEqual(
            rows["upper-gre-grebootcamp-s4-q2-067e0b63"]["choices"][4],
            r"$\frac{-\sin t-\cos t}{e^{2t}}$",
        )
        self.assertEqual(
            rows["upper-gre-grebootcamp-s5-q6-298ef97e"]["choices"][3],
            r"$\binom{49}{19}(0.8)^{20}(0.2)^{30}$",
        )
        self.assertEqual(
            rows["upper-gre-grebootcamp-s7-q2-8b400f7b"]["choices"],
            [
                r"$4^{10}$",
                "40",
                r"$\binom{9}{4}^{10}$",
                r"$\binom{13}{3}$",
                r"$\binom{13}{9}$",
            ],
        )
        self.assertEqual(
            rows["upper-gre-grebootcamp-s10-q6-5a2656bb"]["choices"][0],
            r"$2\pi R^{1/2}(R-h)^{3/2}$",
        )
        self.assertEqual(
            rows["upper-gre-grebootcamp-s10-q4-c6c5b4c5"]["prompt"],
            (
                r"Find the general solution of the differential equation "
                r"$\frac{dy}{dx}=\frac{x+y}{x}$."
            ),
        )
        self.assertEqual(
            rows["upper-gre-grepractice-s-q48-8157c15f"]["prompt"],
            PRACTICE_VERIFIED_ITEM_OVERRIDES[48]["prompt"],
        )

    def test_practice_exponent_tower_override_prevents_pdf_flattening(self):
        item = {
            "prompt": (
                "Suppose today is Wednesday. What day of the week will it "
                r"be $10^{1010}$ days from now?"
            ),
            "choices": [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
            ],
            "answerIndex": 0,
            "answerKey": "A",
            "answer": "Sunday",
        }
        out = apply_practice_item_override(item, 48)
        self.assertEqual(
            out["prompt"],
            (
                "Suppose today is Wednesday. What day of the week will it be "
                r"$10^{10^{10}}$ days from now?"
            ),
        )
        self.assertEqual(out["answer"], "Sunday")


if __name__ == "__main__":
    unittest.main()
