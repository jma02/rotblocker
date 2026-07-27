import sys
import tempfile
import unittest
import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from normalize_problem_data import (  # noqa: E402
    BASELINE_REF,
    DATA_FILES,
    canonicalize_currency_choice,
    canonicalize_mathjax_commands,
    GRE_BOOTCAMP_ROW_OVERRIDES,
    GRE_BOOTCAMP_ROUTES_ID,
    GRE_BOOTCAMP_SECTION_BY_ID,
    GRE_PRACTICE_EXPONENT_TOWER_ID,
    OFFICIAL_AMC12B_2012_Q12_ID,
    OFFICIAL_AMC12B_2023_Q7_ID,
    OFFICIAL_AMC12A_2016_Q16_ID,
    OFFICIAL_AMC8_2023_Q24_ID,
    SPECULATIVE_CALENDAR_CROP_ID,
    STAMP_COLLECTION_CONTEXT,
    VERIFIED_AMC8_CHOICE_OVERRIDES,
    VERIFIED_EXACT_PROMPT_OVERRIDES,
    VERIFIED_PROMPT_TEXT_REPLACEMENTS,
    VERIFIED_SHARED_DIAGRAMS,
    apply_known_row_patches,
    audit_rows,
    canonicalize_display_math,
    canonicalize_fraction_commands,
    attach_existing_diagram_assets,
    merge_cleanup_provenance,
    normalize_choice,
    normalize_problem_row,
    normalize_prompt,
    repair_missing_choice_commands,
    refresh_quality_report_metadata,
    strip_embedded_media_noise,
)


class ProblemDataNormalizerTests(unittest.TestCase):
    def test_fraction_commands_restore_slash_and_explicit_arguments(self):
        cases = {
            "frac 12": r"\frac{1}{2}",
            "frac12": r"\frac{1}{2}",
            "frac 7{16}": r"\frac{7}{16}",
            r"-\frac 12": r"-\frac{1}{2}",
            r"dfrac1{12}": r"\dfrac{1}{12}",
            r"\frac{20\sqrt3}3": r"\frac{20\sqrt3}{3}",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(canonicalize_fraction_commands(raw), expected)

    def test_fraction_word_in_prose_is_not_a_tex_command(self):
        text = "What fraction of the pizza is covered?"
        self.assertEqual(normalize_prompt(text), text)

    def test_choice_cleanup_restores_math_and_removes_layout_noise(self):
        self.assertEqual(normalize_choice("~frac 58\\qquad"), r"$\frac{5}{8}$")
        self.assertEqual(normalize_choice("sqrt{13}"), r"$\sqrt{13}$")
        self.assertEqual(normalize_choice("pi+2"), r"$\pi+2$")
        self.assertEqual(normalize_choice("overline{CD}"), r"$\overline{CD}$")
        self.assertEqual(normalize_choice(r"\text{all real numbers} \\"), r"$\text{all real numbers}$")
        self.assertEqual(
            normalize_choice(
                r"5\$ (NOTE: THE FOLLOWING DIAGRAM WAS NOT SHOWN DURING THE "
                r"ACTUAL EXAM, BUT IS NOW HERE TO GUIDE STUDENTS IN PICTURING THE PROBLEM)"
            ),
            "5",
        )
        self.assertEqual(
            normalize_choice(r"32\$ ~Diagram by Andrei.martynau"),
            "32",
        )
        self.assertEqual(normalize_choice(r"-\$ 1.06"), r"-\$1.06")
        self.assertEqual(normalize_choice(r"$-\$ 0.53$"), r"-\$0.53")
        self.assertEqual(normalize_choice("mbox{ }32"), "32")
        self.assertEqual(
            normalize_choice("texttt{000101}"),
            r"$\texttt{000101}$",
        )
        self.assertEqual(
            normalize_choice(r"textrm{This\, value\, is\, not\, defined.}"),
            "This value is not defined.",
        )
        self.assertEqual(
            repair_missing_choice_commands("mbox{ }128"),
            "128",
        )

    def test_unsupported_mathjax_commands_are_canonicalized(self):
        raw = (
            r"$1\thickspace 2\hdots 9$ and "
            r"$2^{200}\?$"
        )
        expected = r"$1\; 2\cdots 9$ and $2^{200}$?"
        self.assertEqual(canonicalize_mathjax_commands(raw), expected)
        self.assertEqual(canonicalize_mathjax_commands(expected), expected)
        self.assertEqual(
            canonicalize_currency_choice(r"$-\$ 1.06$"),
            r"-\$1.06",
        )

    def test_display_math_is_canonical_and_idempotent(self):
        raw = r"Before $$x^2+1$$ after \begin{align*}x&=1\\y&=2\end{align*}."
        expected = (
            r"Before \[x^2+1\] after "
            r"\[\begin{aligned} x&=1\\y&=2 \end{aligned}\]."
        )
        normalized = canonicalize_display_math(raw)
        self.assertEqual(normalized, expected)
        self.assertEqual(canonicalize_display_math(normalized), expected)

    def test_align_inside_existing_display_is_not_double_wrapped(self):
        for raw in (
            r"Before $$\begin{align*}x&=1\\y&=2\end{align*}$$ after",
            r"Before \[\begin{align*}x&=1\\y&=2\end{align*}\] after",
        ):
            with self.subTest(raw=raw):
                normalized = canonicalize_display_math(raw)
                self.assertEqual(
                    normalized,
                    r"Before \[\begin{aligned} x&=1\\y&=2 \end{aligned}\] after",
                )
                self.assertNotIn(r"\[\[", normalized)
                self.assertEqual(canonicalize_display_math(normalized), normalized)

    def test_triple_braced_choices_have_one_canonical_form(self):
        self.assertEqual(normalize_choice("{{{14}}}"), "14")
        self.assertEqual(normalize_choice("${{{14}}}$"), "14")
        self.assertEqual(
            normalize_choice(r"${{{\frac{1}{2}}}}$"),
            r"$\frac{1}{2}$",
        )

    def test_only_trailing_empty_phantom_is_removed(self):
        self.assertEqual(normalize_prompt(r"Question? $\phantom{}$"), "Question?")
        internal = r"The blank $\phantom{}$ is intentional here."
        self.assertEqual(normalize_prompt(internal), internal)

    def test_media_filename_cleanup_is_conservative(self):
        self.assertEqual(
            strip_embedded_media_noise("See the figure. IMG 1031.jpeg What is x?"),
            "See the figure. What is x?",
        )
        self.assertEqual(
            strip_embedded_media_noise("Find the area. 2006amc10b04.gif"),
            "Find the area.",
        )
        self.assertEqual(
            strip_embedded_media_noise("Read example.svg carefully"),
            "Read example.svg carefully",
        )
        self.assertEqual(
            strip_embedded_media_noise(
                "Part of the graph is shown. What is b? 2003 12B AMC-20.png"
            ),
            "Part of the graph is shown. What is b?",
        )
        self.assertEqual(
            strip_embedded_media_noise(
                "Part of the graph is shown. What is b? 2003 12B"
            ),
            "Part of the graph is shown. What is b?",
        )

    def test_official_amc12b_2023_question_7_override(self):
        row = {
            "id": OFFICIAL_AMC12B_2023_Q7_ID,
            "type": "mcq",
            "prompt": "Prompt",
            "choices": ["900", "2", "902", "2", "901"],
            "answerIndex": 4,
            "answerKey": "E",
            "answer": "901",
        }
        out = normalize_problem_row(row)
        self.assertEqual(out["choices"], ["2", "3", "900", "901", "902"])
        self.assertEqual(out["answerIndex"], 3)
        self.assertEqual(out["answerKey"], "D")
        self.assertEqual(out["answer"], "901")

    def test_official_amc12b_2012_question_12_answer_override(self):
        row = {
            "id": OFFICIAL_AMC12B_2012_Q12_ID,
            "type": "mcq",
            "prompt": "How many sequences?",
            "choices": ["190", "192", "211", "380", "382"],
            "answerIndex": 3,
            "answerKey": "D",
            "answer": "380",
        }
        out = normalize_problem_row(row)
        self.assertEqual(out["answerIndex"], 4)
        self.assertEqual(out["answerKey"], "E")
        self.assertEqual(out["answer"], "382")

    def test_official_amc12a_2016_question_16_log_bases_are_explicit(self):
        out = normalize_problem_row(
            {
                "id": OFFICIAL_AMC12A_2016_Q16_ID,
                "type": "mcq",
                "prompt": (
                    r"The graphs of $y=\log_3 x, y=\log_x 3, "
                    r"y=\log_\frac{1}{3} x,$ and "
                    r"$y=\log_x \dfrac{1}{3}$ are plotted."
                ),
                "choices": ["2", "3", "4", "5", "6"],
                "answerIndex": 3,
                "answerKey": "D",
                "answer": "5",
            }
        )
        self.assertIn(r"$y=\log_{3} x, y=\log_{x} 3", out["prompt"])
        self.assertIn(r"\log_{\frac{1}{3}} x", out["prompt"])
        self.assertNotIn(r"\log_x^3", out["prompt"])

    def test_verified_amc8_choice_leaks_are_removed_without_rekeying(self):
        fixtures = {
            "amio-b9979cb9613ec70e0886881b00e6a7ab": {
                "choices": [
                    "4",
                    "4.2",
                    "4.5",
                    "4.8",
                    (
                        "5\\$ (NOTE: THE FOLLOWING DIAGRAM WAS NOT SHOWN "
                        "DURING THE ACTUAL EXAM)"
                    ),
                ],
                "answerIndex": 1,
                "answerKey": "B",
                "answer": "4.2",
                "verified": "5",
            },
            "amio-fe18aad6e52038198dd0f9c9c01eecef": {
                "choices": [
                    "20",
                    "24",
                    "27",
                    "28",
                    "32\\$ ~Diagram by Andrei.martynau",
                ],
                "answerIndex": 4,
                "answerKey": "E",
                "answer": "32\\$ ~Diagram by Andrei.martynau",
                "verified": "32",
            },
        }
        self.assertEqual(set(fixtures), set(VERIFIED_AMC8_CHOICE_OVERRIDES))
        for row_id, fixture in fixtures.items():
            with self.subTest(row_id=row_id):
                original_index = fixture["answerIndex"]
                original_key = fixture["answerKey"]
                out = normalize_problem_row(
                    {
                        "id": row_id,
                        "type": "mcq",
                        "prompt": "Source-backed fixture.",
                        "choices": fixture["choices"],
                        "answerIndex": original_index,
                        "answerKey": original_key,
                        "answer": fixture["answer"],
                    }
                )
                self.assertEqual(out["choices"][4], fixture["verified"])
                self.assertEqual(out["answerIndex"], original_index)
                self.assertEqual(out["answerKey"], original_key)
                self.assertEqual(
                    out["answer"],
                    out["choices"][original_index],
                )

    def test_all_retained_bootcamp_ids_have_stable_source_sections(self):
        self.assertEqual(len(GRE_BOOTCAMP_SECTION_BY_ID), 33)
        for row_id, section in GRE_BOOTCAMP_SECTION_BY_ID.items():
            with self.subTest(row_id=row_id):
                out = apply_known_row_patches(
                    {
                        "id": row_id,
                        "source": {
                            "dataset": "GREBootcamp",
                            "problemSet": 10,
                            "question": 1,
                        },
                    }
                )
                self.assertEqual(out["source"]["section"], section)
                if section.startswith("problem_set_"):
                    self.assertEqual(out["source"]["problemSet"], 10)
                    self.assertNotIn("legacyProblemSet", out["source"])
                else:
                    self.assertNotIn("problemSet", out["source"])
                    self.assertEqual(out["source"]["legacyProblemSet"], 10)

    def test_official_amc8_2023_question_24_prompt_override(self):
        out = normalize_problem_row(
            {
                "id": OFFICIAL_AMC8_2023_Q24_ID,
                "type": "mcq",
                "prompt": (
                    r"Isosceles $\triangle ABC$ has equal side lengths $AB$ "
                    r"and $BC$. What is the height of $h$ of $\triangle ABC$"
                ),
                "choices": ["14.6", "14.8", "15", "15.2", "15.4"],
                "answerIndex": 0,
                "answerKey": "A",
                "answer": "14.6",
            }
        )
        self.assertTrue(
            out["prompt"].endswith(
                r"What is the height $h$ of $\triangle ABC$?"
            )
        )
        self.assertNotIn("height of $h$", out["prompt"])

    def test_source_backed_gre_answer_corrections(self):
        expected_indexes = {
            "upper-gre-grebootcamp-s10-q1-56947df0": 2,
            "upper-gre-grebootcamp-s10-q1-f4824339": 3,
            "upper-gre-grebootcamp-s10-q2-0a75d49b": 1,
            "upper-gre-grebootcamp-s10-q2-266e319c": 3,
            "upper-gre-grebootcamp-s10-q4-5f32abbf": 3,
            "upper-gre-grebootcamp-s10-q6-ca16f83b": 2,
            "upper-gre-grebootcamp-s10-q7-a7170d3a": 2,
            "upper-gre-grebootcamp-s10-q7-c3572295": 3,
            "upper-gre-grebootcamp-s9-q1-db6efd4d": 3,
        }
        for row_id, expected_index in expected_indexes.items():
            with self.subTest(row_id=row_id):
                out = normalize_problem_row(
                    {
                        "id": row_id,
                        "type": "mcq",
                        "prompt": "A sufficiently long source-backed prompt.",
                        "choices": ["A", "B", "C", "D", "E"],
                        "answerIndex": 0,
                        "answerKey": "A",
                        "answer": "A",
                        "source": {"dataset": "GREBootcamp"},
                    }
                )
                self.assertEqual(out["answerIndex"], expected_index)
                self.assertEqual(out["answerKey"], "ABCDE"[expected_index])
                self.assertEqual(out["answer"], out["choices"][expected_index])

    def test_source_backed_gre_markup_repairs(self):
        expected = {
            "upper-gre-grebootcamp-s2-q3-7236172b": (
                "choices",
                r"$3\cdot 2^{|S|}-3$",
                1,
            ),
            "upper-gre-grebootcamp-s4-q2-067e0b63": (
                "choices",
                r"$\frac{-\sin t-\cos t}{e^{2t}}$",
                4,
            ),
            "upper-gre-grebootcamp-s5-q6-298ef97e": (
                "choices",
                r"$\binom{49}{19}(0.8)^{20}(0.2)^{30}$",
                3,
            ),
            "upper-gre-grebootcamp-s7-q2-8b400f7b": (
                "choices",
                r"$4^{10}$",
                0,
            ),
            "upper-gre-grebootcamp-s10-q6-5a2656bb": (
                "choices",
                r"$2\pi R^{1/2}(R-h)^{3/2}$",
                0,
            ),
        }
        for row_id, (field, value, index) in expected.items():
            with self.subTest(row_id=row_id):
                self.assertEqual(
                    GRE_BOOTCAMP_ROW_OVERRIDES[row_id][field][index],
                    value,
                )

    def test_source_backed_gre_factorial_choices_and_answer(self):
        row = {
            "id": GRE_BOOTCAMP_ROUTES_ID,
            "type": "mcq",
            "prompt": "How many routes?",
            "choices": ["5· 7", "7! 5!", "12! 7!5!", "212", "7!5!"],
            "answerIndex": 4,
            "answerKey": "E",
            "answer": "7!5!",
        }
        out = normalize_problem_row(row)
        self.assertEqual(out["choices"][2], r"$\frac{12!}{7!5!}$")
        self.assertEqual(out["answerIndex"], 2)
        self.assertEqual(out["answerKey"], "C")
        self.assertEqual(out["answer"], out["choices"][2])

    def test_source_backed_prompt_text_repairs_are_stable(self):
        fixtures = {
            "amio-c9ec465de29de52b45f7994d4a2aafea": (
                (
                    r"The function $f$ has the property that, for each real "
                    r"number $x,\,$ If $f(19)=94,\,$ what is the remainder "
                    r"when $f(94)\,$ is divided by $1000$"
                ),
                r"\[f(x)+f(x-1)=x^2.\]",
            ),
            "amio-309ab70ab52a2b4424874abcc6cabbae": (
                (
                    r"Given that $(1+\sin t)(1+\cos t)=5/4$ and where $k, "
                    r"m,$ and $n$ are positive integers with $m$ and $n$ "
                    r"relatively prime, find $k+m+n.$"
                ),
                r"$(1-\sin t)(1-\cos t)=\frac{m}{n}-\sqrt{k}$",
            ),
            "amio-067f0b089095b4b384e3d0f791979204": (
                (
                    r"Given a positive integer $n\,$, let $p(n)\,$ be the "
                    r"product of the non-zero digits of $n\,$. (If $n\,$ "
                    r"has only one digits, then $p(n)\,$ is equal to that "
                    r"digit.) Let What is the largest prime factor of $S\,$"
                ),
                r"\[S=p(1)+p(2)+p(3)+\cdots+p(999).\]",
            ),
            "amio-e04415018886b333e8fcfca30ac133d1": (
                (
                    r"For certain ordered pairs $(a,b)\,$ of real numbers, "
                    r"the system of equations has at least one solution, "
                    r"and each solution is an ordered pair $(x,y)\,$ of "
                    r"integers. How many such ordered pairs $(a,b)\,$ are "
                    r"there?"
                ),
                r"\begin{aligned} ax+by&=1,\\x^2+y^2&=50.",
            ),
            "amio-53e112d374764867391a4f889396fd50": (
                (
                    r"The table below displays some of the results of last "
                    r"summer's Frostbite Falls Fishing Festival, showing "
                    r"how many contestants caught $n\,$ fish for various "
                    r"values of $n\,$ In the newspaper story covering the "
                    r"event, it was reported that What was the total number "
                    r"of fish caught during the festival?"
                ),
                "the winner caught 15 fish",
            ),
            "amio-9a5a6f1fd4069ff884ee2830fa74b6f3": (
                (
                    r"The graphs of the equations are drawn in the "
                    r"coordinate plane for $k=-10,-9,-8,\ldots,9,10.\,$ "
                    r"These 63 lines cut part of the plane into equilateral "
                    r"triangles of side length $\tfrac{2}{\sqrt{3}}.\,$ How "
                    r"many such triangles are formed?"
                ),
                r"\[y=k,\qquad y=\sqrt{3}x+2k",
            ),
            "amio-94a53012c117cd9385ccb0c2aa4462cf": (
                (
                    r"Suppose $r$ is a real number for which Find "
                    r"$\lfloor 100r \rfloor$. (For real $x$ "
                    r"$\lfloor x \rfloor$ is the greatest integer less than "
                    r"or equal to $x$.)"
                ),
                r"\left\lfloor r+\frac{19}{100}\right\rfloor",
            ),
            "amio-f16156f4fc4a548c40cca2f804e2694d": (
                (
                    r"Let $a$ $b$ $c$ be the three sides of a triangle, and "
                    r"let $\alpha$ $\beta$ $\gamma$, be the angles opposite "
                    r"them. If $a^2+b^2=1989c^2$, find"
                ),
                r"$\frac{\cot\gamma}{\cot\alpha+\cot\beta}$",
            ),
            "amio-9cfe3f60cd374c069df86eeb8babeea7": (
                (
                    r"Let $P$ be the parabola with equation $y=x^2$ and let "
                    r"$Q = (20, 14)$. There are real numbers $r$ and $s$ "
                    r"such that the line through $Q$ with slope $m$ does not "
                    r"intersect $P$ if and only if $r$ $m$ $s$. What is "
                    r"$r + s$"
                ),
                r"$r<m<s$",
            ),
            "amio-07d8f9f7da5174c54967b0b422387f38": (
                "For how many positive integers $n$ does $1+2+...+n$ "
                "evenly divide from $6n$",
                r"$1+2+\cdots+n$ evenly divide $6n$?",
            ),
            "amio-43b0bf5b758b18c9b631f7261691be8b": (
                (
                    "radiostation "
                    r"$\begin{array}{|c|c|c|c|}\hline "
                    r"& Listen & Don't Listen & Total\\ "
                    r"\hline Males & 1 & 2 & 3\\ "
                    r"\hline Females & 4 & 5 & 6\\ "
                    r"\hline Total & 5 & 7 & 9\\ \hline\end{array}$"
                ),
                r"\text{Don't Listen}",
            ),
            "amio-7c7d03eba309acae3722263567dc3012": (
                (
                    r"$\begin{array}{c} Tree 1 & 11 meters\\ "
                    r"Average height & \underline{\phantom{00}}"
                    r"\text{.}2 meters \end{array}$"
                ),
                r"\text{Average height}",
            ),
            "amio-ae139542a200cb4687c817e01bcfe7bf": (
                (
                    r"$\begin{array}{c|c} Player & Result\\ "
                    r"Lola & \texttt{111011}\\ Tiyo & "
                    r"\texttt{??????}\end{array}$"
                ),
                r"\text{Player}",
            ),
        }
        self.assertTrue(set(fixtures).issubset(VERIFIED_PROMPT_TEXT_REPLACEMENTS))
        for row_id, (prompt, expected) in fixtures.items():
            with self.subTest(row_id=row_id):
                out = normalize_problem_row({"id": row_id, "prompt": prompt})
                self.assertIn(expected, out["prompt"])
                self.assertEqual(
                    normalize_problem_row(out)["prompt"],
                    out["prompt"],
                )

    def test_shared_stamp_context_is_restored_to_all_three_questions(self):
        questions = {
            "amio-16dffb75f3e15c4823f6db7d163398ed": "How many?",
            "amio-ac1a24b9bcb728d734f04b1193e5266d": "In dollars?",
            "amio-f7aac714a9a971d023b425e78fb13b4e": "The average?",
        }
        for row_id, question in questions.items():
            with self.subTest(row_id=row_id):
                out = normalize_problem_row(
                    {
                        "id": row_id,
                        "prompt": (
                            "Problems 8,9 and 10 use the data found in the "
                            f"accompanying paragraph and table: {question}"
                        ),
                    }
                )
                self.assertIn(STAMP_COLLECTION_CONTEXT, out["prompt"])
                self.assertEqual(
                    normalize_problem_row(out)["prompt"],
                    out["prompt"],
                )

    def test_curated_prompts_persist_all_required_source_content(self):
        required = {
            "amio-4c6b64f3497b40b5afa6131eadff127c": r"(a_3a_2a_1a_0)_{-3+i}",
            "amio-8c8e542a115aa4a20e4f922070bf2ade": r"\Big|\big||x|-2\big|-1\Big|",
            "amio-c9ec465de29de52b45f7994d4a2aafea": r"f(x)+f(x-1)=x^2",
            "amio-309ab70ab52a2b4424874abcc6cabbae": r"\frac{m}{n}-\sqrt{k}",
            "amio-067f0b089095b4b384e3d0f791979204": r"S=p(1)+p(2)+p(3)",
            "amio-e04415018886b333e8fcfca30ac133d1": r"ax+by&=1",
            "amio-53e112d374764867391a4f889396fd50": "winner caught 15 fish",
            "amio-9a5a6f1fd4069ff884ee2830fa74b6f3": r"y=-\sqrt{3}x+2k",
            "amio-94a53012c117cd9385ccb0c2aa4462cf": r"r+\frac{91}{100}",
            "amio-f16156f4fc4a548c40cca2f804e2694d": r"\cot\alpha+\cot\beta",
            "amio-9cfe3f60cd374c069df86eeb8babeea7": r"r<m<s",
            "amio-1e3194e2a14646b1527d7ad5c16b0c36": r"p(2009+9002\pi i)",
            "amio-8c77a574f062843a158f36f3a1da1bc1": r"P(1)=P(3)=P(5)=P(7)=a",
            "amio-c72e2b9d9977d5a7f4a539abec54ce32": r"P(2)=P(4)=P(6)=P(8)=-a",
            "amio-d9ba9b1ca08bee47e026577ce5441eee": r"y=|x-a|+|x-b|+|x-c|",
            "amio-9594b8df76721b6e2c4911f9677f956a": "The median isn't first or last",
            "amio-c721f665706b36c0258ef42fc731085e": r"\prod_{n=2}^{5300}",
            "amio-2ee242ba369a1d8d1bd942a67d943d40": r"2013=\frac{a_1!a_2!",
            "amio-f947d416ed5e04489c729d7003bd1fe9": r"2013=\frac{a_1!a_2!",
            "amio-b11d9737add2b2a76fccb1d2a11e1b83": "Art makes exactly $12$ cookies",
            "amio-39fb0975b13cbe4ced5436758447f72b": "reversing the digits of $N$",
            "amio-61fda9fb244c94efa274c5e045298e33": "There are 3 more guppies",
            "amio-e5e922acf502a1832f6b4f6693da6149": r"\Bigg\vert",
            "amio-ee1bdfcb98da5de80d3a873baafff3e2": r"a_{n+2}=\frac{a_n+a_{n+1}}",
            "amio-97ed9915cbef9ad8c9136dfb53ee58c0": r"A $3 \times 7$ rectangle",
            "amio-18167852ccabbc147d57d50df08cd523": "creating a closed curve",
            "amio-f9dc3f3febf32227dd066d9b170c1a61": "below (not drawn to scale). The",
            "amio-faaccf9259bff468d99045641db8964e": ", what digit",
            "amio-bbc8b2bcbd811466824eda4c94d2dc46": "Ms. Osborne",
            "amio-3d6ba4a9134cc345e3a668e2330c196f": "two, or three",
            "amio-1f2ac522535b2962aa2bd710cbc6deca": r"$n = 5$. What",
            "amio-a5a8575f3dcbbd1f65efff33b50a99a0": "nickels, dimes",
            "amio-aae24b862004e67889b97a440c22bf3c": "parallelepiped",
            "amio-e343bfd5714a46552e0923858c2dfa43": "nonempty subsets",
            "amio-df037de97863e546885f43ef348f2a44": "Every day at school",
            "amio-b6b6184a11a773b6050d5be3bce67e9f": "exactly three filled neighbors",
            "amio-59984d65302fc4acc4f8d116285323ad": "exactly three filled neighbors",
            "amio-9adc7bd7514a005d92b2dd14a4cfc668": r"$P(3x)$",
            "amio-16dffb75f3e15c4823f6db7d163398ed": STAMP_COLLECTION_CONTEXT,
            "amio-ac1a24b9bcb728d734f04b1193e5266d": STAMP_COLLECTION_CONTEXT,
            "amio-f7aac714a9a971d023b425e78fb13b4e": STAMP_COLLECTION_CONTEXT,
        }
        rows = {}
        for filename in DATA_FILES:
            for row in json.loads(
                (ROOT / "data" / filename).read_text(encoding="utf-8")
            ):
                rows[row["id"]] = row
        self.assertTrue(set(required).issubset(rows))
        for row_id, content in required.items():
            with self.subTest(row_id=row_id):
                self.assertIn(content, rows[row_id]["prompt"])

        exact_id = "amio-39fb0975b13cbe4ced5436758447f72b"
        self.assertEqual(
            rows[exact_id]["prompt"],
            VERIFIED_EXACT_PROMPT_OVERRIDES[exact_id],
        )
        self.assertEqual(
            rows[exact_id]["prompt"].count("reversing the digits"),
            1,
        )

    def test_source_backed_gre_exponent_tower_is_not_flattened(self):
        out = normalize_problem_row(
            {
                "id": GRE_PRACTICE_EXPONENT_TOWER_ID,
                "type": "mcq",
                "prompt": (
                    "Suppose today is Wednesday. What day of the week will "
                    r"it be $10^{1010}$ days from now?"
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
                "source": {"dataset": "GREpractice", "question": 48},
            }
        )
        self.assertIn(r"$10^{10^{10}}$", out["prompt"])
        self.assertNotIn(r"$10^{1010}$", out["prompt"])
        self.assertEqual(out["answerKey"], "A")
        self.assertEqual(out["answer"], "Sunday")

    def test_existing_stable_id_diagram_is_linked_without_guessing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            diagrams = root / "assets" / "diagrams"
            diagrams.mkdir(parents=True)
            problem_id = "0123456789abcdef0123456789abcdef"
            (diagrams / f"{problem_id}.svg").write_text("<svg/>", encoding="utf-8")

            out = attach_existing_diagram_assets(
                {"id": f"amio-{problem_id}", "prompt": "Use the figure."},
                root=root,
            )
            self.assertEqual(
                out["diagramSvg"],
                f"assets/diagrams/{problem_id}.svg",
            )

    def test_verified_shared_diagram_uses_full_id_mapping(self):
        row_id = "amio-ac1a24b9bcb728d734f04b1193e5266d"
        field, rel = VERIFIED_SHARED_DIAGRAMS[row_id]
        self.assertEqual(field, "diagramPng")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            asset = root / rel
            asset.parent.mkdir(parents=True)
            asset.write_bytes(b"source-faithful test fixture")
            changes = Counter()
            out = attach_existing_diagram_assets(
                {"id": row_id, "prompt": "Use the accompanying table."},
                changes,
                root,
            )
            self.assertEqual(out[field], rel)
            self.assertEqual(changes["verified_shared_diagram_link"], 1)

    def test_all_verified_shared_mapping_ids_are_full_stable_ids(self):
        self.assertEqual(len(VERIFIED_SHARED_DIAGRAMS), 13)
        for row_id in VERIFIED_SHARED_DIAGRAMS:
            self.assertRegex(row_id, r"^amio-[0-9a-f]{32}$")

    def test_broken_png_override_always_selects_replacement_svg(self):
        out = apply_known_row_patches(
            {
                "id": "amio-aee82ef56f7042c3ac61d14ca9f1de2d",
                "diagramPng": (
                    "assets/diagrams/aee82ef56f7042c3ac61d14ca9f1de2d.png"
                ),
            }
        )
        self.assertNotIn("diagramPng", out)
        self.assertEqual(
            out["diagramSvg"],
            "assets/diagrams/aee82ef56f7042c3ac61d14ca9f1de2d.svg",
        )

    def test_speculative_calendar_crop_is_never_retained(self):
        out = apply_known_row_patches(
            {
                "id": SPECULATIVE_CALENDAR_CROP_ID,
                "diagramPng": (
                    "assets/diagrams/43b2c056b96a9474e34431445277d923.png"
                ),
            }
        )
        self.assertNotIn("diagramPng", out)

    def test_plural_svg_diagrams_are_audited(self):
        row = {
            "id": "plural-svg",
            "type": "mcq",
            "prompt": "Choose.",
            "choices": ["0", "1", "2", "3", "4"],
            "answerIndex": 0,
            "answerKey": "A",
            "answer": "0",
            "diagramSvgs": ["assets/diagrams/one.svg"],
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            asset = root / row["diagramSvgs"][0]
            asset.parent.mkdir(parents=True)
            asset.write_text("<svg/>", encoding="utf-8")
            self.assertEqual(
                audit_rows({"fixture.json": [row]}, root)["issueCounts"],
                {},
            )
            asset.unlink()
            self.assertEqual(
                audit_rows({"fixture.json": [row]}, root)["issueCounts"],
                {"missing_diagram": 1},
            )

    def test_audit_rejects_known_truncated_prompt_signatures(self):
        rows = [
            {
                "id": "missing-definition",
                "type": "input",
                "prompt": "Suppose the value has the following properties?",
                "answer": 1,
            },
            {
                "id": "missing-equation",
                "type": "input",
                "prompt": "Let S be the set of points that satisfy If a model is built.",
                "answer": 2,
            },
        ]
        audit = audit_rows({"fixture.json": rows})
        self.assertEqual(audit["issueCounts"], {"truncated_prompt": 2})

    def test_cleanup_report_provenance_is_cumulative_and_deterministic(self):
        first = merge_cleanup_provenance(
            {
                "normalizationChanges": {"fraction_commands": 3},
                "changedFiles": ["data/amc10.json"],
                "metadataFilesChanged": ["data/upper_level_mcq_quality_report.json"],
                "issueCounts": {},
            },
            None,
        )
        self.assertEqual(first["baselineRef"], BASELINE_REF)
        self.assertEqual(first["normalizationChanges"], {"fraction_commands": 3})
        second = merge_cleanup_provenance(
            {
                "normalizationChanges": {"diagram_link": 2},
                "changedFiles": ["data/amc12.json"],
                "metadataFilesChanged": [],
                "issueCounts": {},
            },
            first,
        )
        self.assertEqual(
            second["normalizationChanges"],
            {"diagram_link": 2, "fraction_commands": 3},
        )
        self.assertEqual(
            second["changedFiles"],
            ["data/amc10.json", "data/amc12.json"],
        )
        no_op = merge_cleanup_provenance(
            {
                "normalizationChanges": {},
                "changedFiles": [],
                "metadataFilesChanged": [],
                "issueCounts": {},
            },
            second,
        )
        self.assertEqual(no_op["normalizationChanges"], second["normalizationChanges"])
        self.assertEqual(no_op["changedFiles"], second["changedFiles"])
        self.assertEqual(no_op["latestNormalizationChanges"], {})
        self.assertEqual(no_op["latestChangedFiles"], [])
        self.assertEqual(
            merge_cleanup_provenance(
                {
                    "normalizationChanges": {},
                    "changedFiles": [],
                    "metadataFilesChanged": [],
                    "issueCounts": {},
                },
                no_op,
            ),
            no_op,
        )

    def test_upper_quality_report_is_labeled_pre_rewrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data"
            data.mkdir()
            report = data / "upper_level_mcq_quality_report.json"
            report.write_text(
                json.dumps({"source": "/private/source.json", "input_count": 222}),
                encoding="utf-8",
            )
            changed = refresh_quality_report_metadata(root)
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["pipeline_stage"],
                "pre_rewrite_quality_filter",
            )
            self.assertEqual(payload["source"], "data/upper_level_mcq.json")
            self.assertEqual(changed, ["data/upper_level_mcq_quality_report.json"])

    def test_row_normalization_is_idempotent_and_keeps_answer_in_sync(self):
        row = {
            "id": "example",
            "type": "mcq",
            "prompt": "Choose a value.",
            "choices": ["frac12", "0", "1", "2", "3"],
            "answerIndex": 0,
            "answerKey": "A",
            "answer": "frac12",
        }
        changes = Counter()
        once = normalize_problem_row(row, changes)
        twice = normalize_problem_row(once, Counter())
        self.assertEqual(once, twice)
        self.assertEqual(once["choices"][0], r"$\frac{1}{2}$")
        self.assertEqual(once["answer"], once["choices"][0])
        self.assertGreater(changes["fraction_commands"], 0)


if __name__ == "__main__":
    unittest.main()
