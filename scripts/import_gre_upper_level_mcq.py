#!/usr/bin/env python3
"""
Extract an unverified upper-level GRE Mathematics staging dataset.

Outputs:
  - data/upper_level_mcq_unverified.json
  - data/upper_level_mcq_unverified_report.json

The curated production bank is maintained separately. This importer may emit
OCR-damaged or duplicate rows and cannot overwrite the active bank.

Topic labels (requested):
  - analysis
  - linalg
  - algebra
  - complex_analysis
  - topology
  - other_upper_level
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

try:
    from pypdf import PdfReader
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "pypdf is required. Install in local venv, e.g.\n"
        "  .venv_pdf/bin/python -m pip install pypdf\n"
        f"Import error: {exc}"
    )

ROOT = Path(__file__).resolve().parents[1]
THIRD = ROOT / "third_party" / "gre_math"

PRACTICE_Q = THIRD / "GREpractice.pdf"
PRACTICE_A = THIRD / "GREpracticeanswers.pdf"
BOOT_Q = THIRD / "GREBootcampProblems.pdf"
BOOT_A = THIRD / "GREBootcampSolutions.pdf"
RUTGERS = THIRD / "rutgers"
RUTGERS_PAIRS = [
    (1, RUTGERS / "math01.pdf", RUTGERS / "math01e.pdf"),
    (2, RUTGERS / "math02.pdf", RUTGERS / "math02e.pdf"),
    (3, RUTGERS / "math03.pdf", RUTGERS / "math03e.pdf"),
    (4, RUTGERS / "math04.pdf", RUTGERS / "math04e.pdf"),
    (5, RUTGERS / "math05.pdf", RUTGERS / "math05e.pdf"),
    (6, RUTGERS / "math06.pdf", RUTGERS / "math06e.pdf"),
]

OUT = ROOT / "data" / "upper_level_mcq_unverified.json"
REPORT = ROOT / "data" / "upper_level_mcq_unverified_report.json"

Q_START_RE = re.compile(r"(?m)^\s*(\d{1,3})\.\s+")
CHOICE_MARK_RE = re.compile(r"\(([A-Ea-e])\)")
SET_RE = re.compile(r"Problem Set #\s*(\d+)", re.I)
BOOTCAMP_SECTION_RE = re.compile(
    r"(?mi)^[ \t]*("
    r"Problem Set #[ \t]*\d+|"
    r"Linear Algebra #1|"
    r"Linear Algebra #2|"
    r"Abstract Algebra|"
    r"Number Theory|"
    r"Real Analysis and Advanced Calculus|"
    r"Topology|"
    r"Combinatorics|"
    r"Probability|"
    r"Complex Analysis|"
    r"Multivariable Calculus|"
    r"Differential Equations"
    r")[ \t]*$"
)
RUT_Q_START_RE = re.compile(r"(?m)^\s*(\d{1,2}|[IiLl])[.,]\s+")
RUT_CHOICE_RE = re.compile(r"[\(\[\{]\s*([A-Ea-e])\s*[\)\]\}]")
RUT_CHOICE_LINE_RE = re.compile(r"(?m)^\s*([A-Ea-e])[\)\].]\s+")
RUT_ANSWER_RE = re.compile(
    r"(?m)^\s*(\d{1,2}|[IiLl])[.,]\s*[\(\[\{]?\s*([A-Ea-e])\s*[\)\]\}]?"
)
BAD_OCR_CHAR_RE = re.compile(r"[¥£¢©§�]")
BAD_OCR_TOKEN_RE = re.compile(
    r"\b(?:frorr|thereliability|coliection|shadect|onconstamt|ineducibility|paraliel|must\s+aug|ef\s+the)\b",
    re.I,
)

TOPIC_KEYWORDS = {
    "complex_analysis": [
        "complex", "holomorphic", "analytic", "residue", "contour", "cauchy",
        "imaginary", "meromorphic", "laurent", "re(z)", "im(z)"
    ],
    "linalg": [
        "linear transformation", "linear operator", "matrix", "determinant",
        "eigen", "eigenspace", "eigenvalue", "vector space", "subspace",
        "basis", "dimension", "inner product", "orthogonal", "rank", "nullity",
        "diagonalizable", "self-adjoint", "parallelepiped"
    ],
    "algebra": [
        "group", "abelian", "ring", "field", "isomorphism", "homomorphism",
        "polynomial", "irreducible", "mod", "modulo", "prime", "gcd",
        "symmetric group", "permutation", "order n"
    ],
    "topology": [
        "topology", "topological", "compact", "connected", "open set",
        "closed set", "hausdorff", "homeomorphism", "component"
    ],
    "analysis": [
        "limit", "continuous", "continuity", "differentiable", "derivative",
        "integral", "series", "sequence", "convergent", "uniformly continuous",
        "ivt", "mean value theorem", "arc length", "tangent", "maximum", "minimum"
    ],
}

TOPIC_PRIORITY = ["complex_analysis", "linalg", "algebra", "topology", "analysis"]

# Topic sections followed Problem Set #10 in both Bootcamp PDFs.  The legacy
# importer treated all of them as part of set 10, so answer-key entries with
# repeated question numbers silently overwrote one another.  These stable keys
# keep questions and answers in the same source section.
BOOTCAMP_TOPIC_SECTION_KEYS = {
    "linear algebra #1": "linear_algebra_1",
    "linear algebra #2": "linear_algebra_2",
    "abstract algebra": "abstract_algebra",
    "number theory": "number_theory",
    "real analysis and advanced calculus": "real_analysis",
    "topology": "topology",
    "combinatorics": "combinatorics",
    "probability": "probability",
    "complex analysis": "complex_analysis",
    "multivariable calculus": "multivariable_calculus",
    "differential equations": "differential_equations",
}

# The Solutions PDF does not include Multivariable Calculus or Differential
# Equations.  It also gives C for Problem Set #9 question 1, although the
# Hessian has eigenvalues 5 and -1 and therefore the point is a saddle (D).
# Keep only the already-curated unkeyed questions and record their independently
# verified answers here.
BOOTCAMP_VERIFIED_ANSWER_OVERRIDES = {
    ("problem_set_9", 1): "D",
    ("multivariable_calculus", 1): "C",
    ("differential_equations", 4): "A",
    ("differential_equations", 5): "C",
}

# PyPDF flattens the two-dimensional exponent tower in practice question 48.
# Preserve the exact source transcription before quality filtering.
PRACTICE_VERIFIED_ITEM_OVERRIDES = {
    48: {
        "prompt": (
            "Suppose today is Wednesday. What day of the week will it be "
            r"$10^{10^{10}}$ days from now?"
        ),
    },
}

# PyPDF preserves the prose but loses two-dimensional fraction/exponent layout
# in these rows.  Apply exact transcriptions after generic sanitization so a
# future import cannot reintroduce the same malformed TeX or page-footer text.
BOOTCAMP_VERIFIED_ITEM_OVERRIDES = {
    ("multivariable_calculus", 1): {
        "prompt": (
            r"The plane $y=1$ slices the surface "
            r"$z=\arctan\left(\frac{x+y}{1-xy}\right)$ in a curve $C$. "
            r"Find the slope of the tangent line to $C$ at the point where "
            r"$x=2$."
        ),
        "choices": [
            "$-3$",
            "$-1$",
            r"$\frac{1}{5}$",
            r"$\frac{1}{3}$",
            r"$\frac{1}{2}$",
        ],
    },
    ("linear_algebra_1", 2): {
        "prompt": (
            r"If $A$ is a square matrix of order $n\ge 4$, and "
            r"$a_{ij}=i+j$ represents the entry in row $i$ and column $j$, "
            r"then the rank of $A$ is always:"
        ),
        "choices": ["1", "2", r"$n-2$", r"$n-1$", r"$n$"],
    },
    ("problem_set_10", 2): {
        "prompt": (
            r"Let $A$ be a real $2\times2$ matrix. Which of the following "
            r"statements must be true? (I) All entries of $A^2$ are "
            r"nonnegative. (II) The determinant of $A^2$ is nonnegative. "
            r"(III) If $A$ has two distinct eigenvalues, then $A^2$ has two "
            r"distinct eigenvalues."
        ),
    },
    ("differential_equations", 4): {
        "prompt": (
            r"Find the general solution of the differential equation "
            r"$\frac{dy}{dx}=\frac{x+y}{x}$."
        ),
        "choices": [
            r"$e^{y/x}=cx$",
            r"$e^{y/x}=cy$",
            r"$e^{x/y}=cx$",
            r"$e^{x/y}=cy$",
            r"$e^{-x/y}=cx$",
        ],
    },
    ("differential_equations", 5): {
        "prompt": (
            r"What is the general solution to the differential equation "
            r"$y''-2y'+y=te^t$?"
        ),
        "choices": [
            r"$C_1e^t+C_2t^2e^t$",
            r"$C_1e^t+C_2te^t$",
            r"$C_1e^t+C_2te^t+\frac{1}{6}t^3e^t$",
            r"$C_1e^t+C_2te^t+\frac{t}{2}e^t$",
            r"$C_1e^t+C_2te^t+\frac{t^2}{2}e^t$",
        ],
    },
    ("combinatorics", 5): {
        "choices": [
            r"$5\cdot 7$",
            r"$\frac{7!}{5!}$",
            r"$\frac{12!}{7!5!}$",
            r"$2^{12}$",
            r"$7!5!$",
        ],
    },
    ("problem_set_10", 6): {
        "prompt": (
            r"Consider a hemisphere of radius $R$. What is the surface area "
            r"of the portion of the sphere that lies at height $h$ or more "
            r"above its center?"
        ),
        "choices": [
            r"$2\pi R^{1/2}(R-h)^{3/2}$",
            r"$2\pi R(R-h)$",
            r"$2\pi R(R^2-h^2)^{1/2}$",
            r"$3\pi Rh$",
            r"$\pi R(R-h)$",
        ],
    },
    ("problem_set_2", 3): {
        "prompt": (
            r"Let $S$ be a set with $|S|\ge 3$. How many non-surjective "
            r"functions from $S$ to $\{1,2,3\}$ are there?"
        ),
        "choices": [
            r"$3\cdot 2^{|S|}$",
            r"$3\cdot 2^{|S|}-3$",
            r"$3^{|S|}-3$",
            r"$|S|^3$",
            r"$2|S|^2-3$",
        ],
    },
    ("problem_set_2", 5): {
        "prompt": (
            r"Which of the following exist? (I) "
            r"$f_1:[0,1]\to(0,1)$ continuous and surjective. (II) "
            r"$f_2:(0,1)\to[0,1]$ continuous and surjective. (III) "
            r"$f_3:(0,1)\to[0,1]$ continuous and bijective."
        ),
    },
    ("problem_set_4", 2): {
        "prompt": (
            r"Let $(x(t),y(t))$ be a parametric curve in $\mathbb{R}^2$ "
            r"given by $x(t)=e^t$ and $y(t)=\sin(t)$. What is "
            r"$\frac{d^2y}{dx^2}$ as a function of $t$?"
        ),
        "choices": [
            r"$-\frac{\sin t}{e^t}$",
            r"$\frac{\cos t-e^t\sin t}{e^t}$",
            r"$\frac{-\sin t-\cos t}{e^t}$",
            r"$\frac{\sin t+\cos t}{e^{2t}}$",
            r"$\frac{-\sin t-\cos t}{e^{2t}}$",
        ],
    },
    ("problem_set_5", 6): {
        "prompt": (
            "A basketball player practices free throws and stops as soon as "
            "he has made 20 free throws (not necessarily consecutively). If "
            "his free-throw percentage is 80%, what is the probability that "
            "he needs exactly 50 attempts?"
        ),
        "choices": [
            r"$\binom{50}{20}(0.8)^{20}(0.2)^{30}$",
            r"$(0.8)^{20}(0.2)^{30}$",
            r"$\binom{50}{20}(20\cdot 0.8)(30\cdot 0.2)$",
            r"$\binom{49}{19}(0.8)^{20}(0.2)^{30}$",
            r"$(20\cdot 0.8)(30\cdot 0.2)$",
        ],
    },
    ("problem_set_6", 5): {
        "prompt": (
            "There are two cards: one is black on both sides, and the other "
            "is black on one side and orange on the other. A card and then "
            "one of its sides are chosen uniformly at random. Given that the "
            "chosen side is black, what is the probability that the other "
            "side is orange?"
        ),
    },
    ("problem_set_7", 2): {
        "prompt": (
            "Suppose you wish to make a bouquet of 10 flowers. You go to the "
            "flower store and there are 4 types of flowers you can use. How "
            "many bouquets can you make using only these flowers?"
        ),
        "choices": [
            r"$4^{10}$",
            "40",
            r"$\binom{9}{4}^{10}$",
            r"$\binom{13}{3}$",
            r"$\binom{13}{9}$",
        ],
    },
    ("problem_set_9", 1): {
        "prompt": r"The function $f(x,y)=x^2+3xy+y^2+y^4$:",
    },
}


@dataclass
class ParsedQuestion:
    qnum: int
    prompt: str
    choices: list[str]


def read_pdf_text(path: Path) -> str:
    r = PdfReader(str(path))
    return "\n".join((p.extract_text() or "") for p in r.pages)


def normalize_text(s: str) -> str:
    s = s.replace("\r", "\n")
    s = re.sub(r"\u00a0", " ", s)
    s = (
        s.replace("\ufb00", "ff")
        .replace("\ufb01", "fi")
        .replace("\ufb02", "fl")
        .replace("\ufb03", "ffi")
        .replace("\ufb04", "ffl")
    )
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s


def normalize_ocr_text(s: str) -> str:
    s = (s or "").replace("\r", "\n")
    s = re.sub(r"\u00a0", " ", s)
    s = s.replace("\x0c", "\n")
    s = s.replace("ﬁ", "fi").replace("ﬂ", "fl")
    # OCR often reads "1." as "i," in these scans.
    s = re.sub(r"(?m)^\s*[IiLl][,.;]\s+", "1. ", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def clean_prompt(s: str) -> str:
    s = normalize_text(s)
    s = re.sub(r"\bGO ON TO THE NEXT P AGE\.\b", " ", s, flags=re.I)
    s = re.sub(r"\bGO ON TO THE NEXT PAGE\.\b", " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .")


def clean_choice(s: str) -> str:
    s = normalize_text(s)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .")


def mathjax_sanitize(s: str) -> str:
    """Light cleanup to keep extracted text MathJax-friendly."""
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    s = s.replace("∈", "\\in ").replace("∞", "\\infty ")
    s = s.replace("≤", "\\le ").replace("≥", "\\ge ")
    s = s.replace("θ", "\\theta ")
    s = s.replace("π", "\\pi ")
    # Common OCR forms like x2 -> x^2, y3 -> y^3.
    s = re.sub(r"\b([a-zA-Z])(\d)\b", r"\1^\2", s)
    s = s.replace("sqrt", "\\sqrt")
    s = re.sub(r"\barcsin\b", r"\\arcsin", s)
    s = re.sub(r"\barccos\b", r"\\arccos", s)
    s = re.sub(r"\barctan\b", r"\\arctan", s)
    s = re.sub(r"\btan\b", r"\\tan", s)
    s = re.sub(r"\bsin\b", r"\\sin", s)
    s = re.sub(r"\bcos\b", r"\\cos", s)
    s = re.sub(r"\blog\b", r"\\log", s)
    s = re.sub(r"\blim\b", r"\\lim", s)
    # Remove common OCR footer noise.
    s = re.sub(r"\b(?:September\s+\d{1,2},\s+\d{4}|Charlie\s+Marshak)\b.*$", "", s)
    # Normalize spacing and keep text readable.
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def is_clean_prompt_ocr(s: str) -> bool:
    if len(s) < 20 or len(s) > 260:
        return False
    upper = s.upper()
    banned = [
        "GRE MATHEMATICS",
        "ANSWER KEY",
        "SCRATCH WORK",
        "GO ON TO THE NEXT PAGE",
        "DIRECTIONS:",
    ]
    if any(tok in upper for tok in banned):
        return False
    if re.search(r"\([A-E]\)", s):
        return False
    if re.search(r"\b\d{1,2}\.\s*[A-E]\b", s):
        return False
    if s.count("?") > 2:
        return False
    if BAD_OCR_CHAR_RE.search(s):
        return False
    if BAD_OCR_TOKEN_RE.search(s):
        return False
    return True


def is_clean_choice_ocr(s: str) -> bool:
    if len(s) < 1 or len(s) > 120:
        return False
    upper = s.upper()
    banned = [
        "GRE MATHEMATICS",
        "ANSWER KEY",
        "SCRATCH WORK",
        "GO ON TO THE NEXT PAGE",
    ]
    if any(tok in upper for tok in banned):
        return False
    if re.search(r"\([A-E]\)", s):
        return False
    # Reject obvious spillover from next problems.
    if re.search(r"\b\d{1,2}\.", s):
        return False
    if BAD_OCR_CHAR_RE.search(s):
        return False
    if BAD_OCR_TOKEN_RE.search(s):
        return False
    return True


def has_footer_noise(s: str) -> bool:
    upper = (s or "").upper()
    bad = [
        "GRE MATHEMATICS",
        "ANSWER KEY",
        "SCRATCH WORK",
        "GO ON TO THE NEXT PAGE",
        "DIRECTIONS:",
        "WORKSHEET",
        "CHARLIE MARSHAK",
    ]
    return any(tok in upper for tok in bad)


def is_quality_item(item: dict) -> bool:
    prompt = item.get("prompt", "")
    choices = item.get("choices", [])
    source = item.get("source", {}).get("dataset", "")
    is_rutgers = source == "RutgersOtherTests"

    if not isinstance(prompt, str) or not prompt:
        return False
    if len(prompt) < 20:
        return False
    if has_footer_noise(prompt):
        return False
    if BAD_OCR_CHAR_RE.search(prompt) or BAD_OCR_TOKEN_RE.search(prompt):
        return False
    if prompt.count("(") != prompt.count(")"):
        return False
    if prompt.count("{") != prompt.count("}"):
        return False
    if re.search(r"\b\d{1,2}\.\s*[A-E]\b", prompt):
        return False
    if is_rutgers and len(prompt) > 220:
        return False
    if is_rutgers:
        if not prompt.isascii():
            return False
        if re.search(r"[|~&$]", prompt):
            return False

    if not isinstance(choices, list) or len(choices) != 5:
        return False
    cleaned: list[str] = []
    for c in choices:
        if not isinstance(c, str):
            return False
        c = c.strip()
        if not c:
            return False
        if has_footer_noise(c):
            return False
        if BAD_OCR_CHAR_RE.search(c) or BAD_OCR_TOKEN_RE.search(c):
            return False
        if re.search(r"\b\d{1,2}\.\s*[A-E]\b", c):
            return False
        if re.search(r"\([A-E]\)", c):
            return False
        if len(c) > (75 if is_rutgers else 140):
            return False
        if is_rutgers:
            if not c.isascii():
                return False
            if re.search(r"[|~&$]", c):
                return False
            if c in {"on", "On", "&", "3 |"}:
                return False
            if re.fullmatch(r"[A-Za-z]{1,2}", c):
                return False
        cleaned.append(c)
    if len(set(cleaned)) < 5:
        return False
    return True


def parse_mcq_blocks(text: str) -> list[ParsedQuestion]:
    text = normalize_text(text)
    blocks: list[ParsedQuestion] = []
    matches = list(Q_START_RE.finditer(text))
    for i, m in enumerate(matches):
        qnum = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]

        choice_marks = list(CHOICE_MARK_RE.finditer(body))
        if len(choice_marks) < 5:
            continue
        # Use the first complete A..E run.
        run_start = None
        for j in range(len(choice_marks) - 4):
            labels = "".join(choice_marks[j + k].group(1).upper() for k in range(5))
            if labels == "ABCDE":
                run_start = j
                break
        if run_start is None:
            continue
        chosen = choice_marks[run_start:run_start + 5]
        prompt_raw = body[:chosen[0].start()]
        prompt = clean_prompt(prompt_raw)
        if len(prompt) < 20:
            continue

        choices: list[str] = []
        for k in range(5):
            c_start = chosen[k].end()
            c_end = chosen[k + 1].start() if k < 4 else len(body)
            choices.append(clean_choice(body[c_start:c_end]))
        if any(not c for c in choices):
            continue
        if len(set(choices)) < 5:
            continue
        blocks.append(ParsedQuestion(qnum=qnum, prompt=prompt, choices=choices))
    return blocks


def parse_answer_key_simple(text: str) -> dict[int, str]:
    out: dict[int, str] = {}
    for q, a in re.findall(r"(?m)^\s*(\d{1,3})\.\s*([A-E])\b", normalize_text(text)):
        out[int(q)] = a
    return out


def parse_answer_key_ocr(text: str) -> dict[int, str]:
    out: dict[int, str] = {}
    for q_raw, a in RUT_ANSWER_RE.findall(normalize_ocr_text(text)):
        if q_raw in {"I", "i", "L", "l"}:
            q = 1
        else:
            q = int(q_raw)
        out[q] = a.upper()
    return out


def split_by_problem_set(text: str) -> dict[int, str]:
    text = normalize_text(text)
    out: dict[int, str] = {}
    matches = list(SET_RE.finditer(text))
    for i, m in enumerate(matches):
        set_no = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out[set_no] = text[start:end]
    return out


def bootcamp_section_key(heading: str) -> str:
    normalized = " ".join(normalize_text(heading).casefold().split())
    problem_set = re.fullmatch(r"problem set #\s*(\d+)", normalized)
    if problem_set:
        return f"problem_set_{int(problem_set.group(1))}"
    try:
        return BOOTCAMP_TOPIC_SECTION_KEYS[normalized]
    except KeyError as exc:
        raise ValueError(f"Unknown Bootcamp section heading: {heading!r}") from exc


def split_bootcamp_sections(text: str) -> dict[str, str]:
    """Split a Bootcamp PDF extraction without merging repeated q numbers."""

    text = normalize_text(text)
    out: dict[str, str] = {}
    matches = list(BOOTCAMP_SECTION_RE.finditer(text))
    for i, match in enumerate(matches):
        section = bootcamp_section_key(match.group(1))
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        out[section] = text[start:end]
    return out


def bootcamp_legacy_problem_set(section: str) -> int:
    """Return legacy metadata used by stable IDs in the curated output."""

    problem_set = re.fullmatch(r"problem_set_(\d+)", section)
    if problem_set:
        return int(problem_set.group(1))
    # The old parser grouped every topical section under Problem Set #10.
    # Preserve that source field so clean_advanced_datasets.py regenerates the
    # same stable ID prefixes; source.section now supplies the missing identity.
    return 10


def parse_mcq_blocks_ocr(text: str) -> list[ParsedQuestion]:
    text = normalize_ocr_text(text)
    blocks: list[ParsedQuestion] = []
    matches = list(RUT_Q_START_RE.finditer(text))
    for i, m in enumerate(matches):
        q_raw = m.group(1)
        if q_raw in {"I", "i", "L", "l"}:
            qnum = 1
        else:
            qnum = int(q_raw)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        if "SCRATCH WORK" in body.upper():
            continue

        choice_marks = list(RUT_CHOICE_RE.finditer(body))
        if len(choice_marks) < 5:
            choice_marks = list(RUT_CHOICE_LINE_RE.finditer(body))
        if len(choice_marks) < 5:
            continue
        run_start = None
        for j in range(len(choice_marks) - 4):
            labels = "".join((choice_marks[j + k].group(1) or "").upper() for k in range(5))
            if labels == "ABCDE":
                # Pick the first clean run to avoid OCR spillover into adjacent problems.
                chosen = choice_marks[j:j + 5]
                prompt_raw = body[:chosen[0].start()]
                prompt = clean_prompt(prompt_raw)
                prompt = re.sub(r"\b(?:DIRECTIONS|RE MATHEMATICS)\b.*$", "", prompt, flags=re.I)
                prompt = mathjax_sanitize(prompt)
                choices: list[str] = []
                for k in range(5):
                    c_start = chosen[k].end()
                    c_end = chosen[k + 1].start() if k < 4 else len(body)
                    c = clean_choice(body[c_start:c_end])
                    c = mathjax_sanitize(c)
                    choices.append(c)
                if not is_clean_prompt_ocr(prompt):
                    continue
                if any(not is_clean_choice_ocr(c) for c in choices):
                    continue
                if len(set(choices)) < 5:
                    continue
                blocks.append(ParsedQuestion(qnum=qnum, prompt=prompt, choices=choices))
                run_start = j
                break
        if run_start is None:
            continue
    return blocks


def ocr_pdf_two_column(path: Path, density: int = 260) -> str:
    if not path.exists():
        return ""
    with tempfile.TemporaryDirectory(prefix=f"ocr_{path.stem}_") as td:
        tmp = Path(td)
        page_pattern = tmp / "page_%03d.png"
        subprocess.run(
            ["magick", "-density", str(density), str(path), "-quality", "100", str(page_pattern)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        chunks: list[str] = []
        for img in sorted(tmp.glob("page_*.png")):
            left = tmp / f"{img.stem}_L.png"
            right = tmp / f"{img.stem}_R.png"
            subprocess.run(
                ["magick", str(img), "-gravity", "West", "-crop", "49%x100%+0+0", "+repage", str(left)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["magick", str(img), "-gravity", "East", "-crop", "49%x100%+0+0", "+repage", str(right)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for part in (left, right):
                p = subprocess.run(
                    ["tesseract", "stdin", "stdout", "--oem", "1", "--psm", "6"],
                    input=part.read_bytes(),
                    capture_output=True,
                    check=True,
                )
                chunks.append(p.stdout.decode("utf-8", "ignore"))
        return "\n".join(chunks)


def classify_topic(prompt: str) -> str:
    p = prompt.lower()
    scores = {topic: 0 for topic in TOPIC_KEYWORDS}
    for topic, kws in TOPIC_KEYWORDS.items():
        for kw in kws:
            if kw in p:
                scores[topic] += 1
    best_score = max(scores.values())
    if best_score <= 0:
        return "other_upper_level"
    best_topics = [t for t, s in scores.items() if s == best_score]
    for t in TOPIC_PRIORITY:
        if t in best_topics:
            return t
    return "other_upper_level"


def build_item(
    source: str,
    set_no: Optional[int],
    q: ParsedQuestion,
    answer_key: str,
    idx: int,
    section: Optional[str] = None,
) -> dict:
    topic = classify_topic(q.prompt)
    prompt = mathjax_sanitize(q.prompt)
    choices = [mathjax_sanitize(c) for c in q.choices]
    source_metadata = {
        "dataset": source,
        "problemSet": set_no,
        "question": q.qnum,
    }
    if section:
        source_metadata["section"] = section
        if not section.startswith("problem_set_"):
            source_metadata["legacyProblemSet"] = source_metadata.pop(
                "problemSet"
            )
    return {
        "id": f"upper-gre-{source.lower()}-{f's{set_no}-' if set_no else ''}q{q.qnum}",
        "type": "mcq",
        "contest": "upper_level_mcq",
        "label": "GRE Mathematics Upper-Level MCQ",
        "topic": topic,
        "weight": 12,
        "prompt": prompt,
        "choices": choices,
        "answerIndex": idx,
        "answerKey": answer_key,
        "answer": choices[idx],
        "source": source_metadata,
    }


def apply_bootcamp_item_override(
    item: dict,
    section: str,
    question: int,
) -> dict:
    patch = BOOTCAMP_VERIFIED_ITEM_OVERRIDES.get((section, question))
    if not patch:
        return item
    out = dict(item)
    if "prompt" in patch:
        out["prompt"] = patch["prompt"]
    if "choices" in patch:
        out["choices"] = list(patch["choices"])
    answer_index = out["answerIndex"]
    out["answerKey"] = "ABCDE"[answer_index]
    out["answer"] = out["choices"][answer_index]
    return out


def apply_practice_item_override(item: dict, question: int) -> dict:
    patch = PRACTICE_VERIFIED_ITEM_OVERRIDES.get(question)
    if not patch:
        return item
    out = dict(item)
    if "prompt" in patch:
        out["prompt"] = patch["prompt"]
    if "choices" in patch:
        out["choices"] = list(patch["choices"])
    answer_index = out["answerIndex"]
    out["answerKey"] = "ABCDE"[answer_index]
    out["answer"] = out["choices"][answer_index]
    return out


def main() -> None:
    missing = [p for p in [PRACTICE_Q, PRACTICE_A, BOOT_Q, BOOT_A] if not p.exists()]
    if missing:
        raise SystemExit(f"Missing required files: {missing}")

    items: list[dict] = []
    stats = {
        "pipeline_stage": "raw_import_pre_quality_rewrite",
        "source_blocked_note": "mathematicsgre.com/viewtopic.php?t=4577 was Cloudflare-blocked (403); used public GRE-math practice PDFs.",
        "practice_parsed": 0,
        "practice_matched": 0,
        "boot_sets_parsed": 0,
        "boot_sections_parsed": 0,
        "boot_matched": 0,
        "rutgers_sets_processed": 0,
        "rutgers_q_parsed": 0,
        "rutgers_ans_parsed": 0,
        "rutgers_matched": 0,
        "rutgers_skipped": 0,
        "quality_dropped_total": 0,
        "quality_dropped_rutgers": 0,
        "quality_dropped_nonrutgers": 0,
        "final_count": 0,
        "topic_counts": {k: 0 for k in TOPIC_PRIORITY + ["other_upper_level"]},
    }

    # GRE practice exam + key
    practice_qs = parse_mcq_blocks(read_pdf_text(PRACTICE_Q))
    practice_key = parse_answer_key_simple(read_pdf_text(PRACTICE_A))
    stats["practice_parsed"] = len(practice_qs)
    for q in practice_qs:
        ans = practice_key.get(q.qnum)
        if not ans:
            continue
        idx = ord(ans) - ord("A")
        if idx < 0 or idx >= len(q.choices):
            continue
        item = build_item("GREpractice", None, q, ans, idx)
        item = apply_practice_item_override(item, q.qnum)
        if not is_quality_item(item):
            stats["quality_dropped_total"] += 1
            stats["quality_dropped_nonrutgers"] += 1
            continue
        items.append(item)
        stats["practice_matched"] += 1
        stats["topic_counts"][item["topic"]] += 1

    # Bootcamp sets + keyed solutions
    boot_q_sections = split_bootcamp_sections(read_pdf_text(BOOT_Q))
    boot_a_sections = split_bootcamp_sections(read_pdf_text(BOOT_A))
    stats["boot_sets_parsed"] = sum(
        section.startswith("problem_set_")
        for section in boot_q_sections
    )
    stats["boot_sections_parsed"] = len(boot_q_sections)
    for section, q_text in boot_q_sections.items():
        set_no = bootcamp_legacy_problem_set(section)
        qs = parse_mcq_blocks(q_text)
        key = parse_answer_key_simple(boot_a_sections.get(section, ""))
        for q in qs:
            ans = BOOTCAMP_VERIFIED_ANSWER_OVERRIDES.get(
                (section, q.qnum),
                key.get(q.qnum),
            )
            if not ans:
                continue
            idx = ord(ans) - ord("A")
            if idx < 0 or idx >= len(q.choices):
                continue
            item = build_item(
                "GREBootcamp",
                set_no,
                q,
                ans,
                idx,
                section=section,
            )
            item = apply_bootcamp_item_override(
                item,
                section,
                q.qnum,
            )
            if not is_quality_item(item):
                stats["quality_dropped_total"] += 1
                stats["quality_dropped_nonrutgers"] += 1
                continue
            items.append(item)
            stats["boot_matched"] += 1
            stats["topic_counts"][item["topic"]] += 1

    # Rutgers other tests (scan PDFs; OCR)
    for set_no, q_pdf, a_pdf in RUTGERS_PAIRS:
        if not q_pdf.exists() or not a_pdf.exists():
            stats["rutgers_skipped"] += 1
            continue
        try:
            q_ocr = ocr_pdf_two_column(q_pdf)
            a_ocr = ocr_pdf_two_column(a_pdf)
        except Exception:
            stats["rutgers_skipped"] += 1
            continue
        q_blocks = parse_mcq_blocks_ocr(q_ocr)
        key_map = parse_answer_key_ocr(a_ocr)
        stats["rutgers_sets_processed"] += 1
        stats["rutgers_q_parsed"] += len(q_blocks)
        stats["rutgers_ans_parsed"] += len(key_map)
        for q in q_blocks:
            ans = key_map.get(q.qnum)
            if not ans:
                continue
            idx = ord(ans) - ord("A")
            if idx < 0 or idx >= len(q.choices):
                continue
            item = build_item("RutgersOtherTests", set_no, q, ans, idx)
            if not is_quality_item(item):
                stats["quality_dropped_total"] += 1
                stats["quality_dropped_rutgers"] += 1
                continue
            items.append(item)
            stats["rutgers_matched"] += 1
            stats["topic_counts"][item["topic"]] += 1

    # Deduplicate by prompt text.
    dedup: dict[str, dict] = {}
    for item in items:
        key = item["prompt"].lower()
        if key not in dedup:
            dedup[key] = item
    final = list(dedup.values())
    final.sort(key=lambda x: x["id"])

    stats["final_count"] = len(final)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(final, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    print(stats)


if __name__ == "__main__":
    main()
