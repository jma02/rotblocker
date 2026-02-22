#!/usr/bin/env python3
"""
Build a high-confidence calculus MCQ bank from:
  third_party/calculus_bank/3000_solved_problems_in_calculus.pdf

Output:
  data/calculus_mcq.json
  data/calculus_mcq_report.json

Notes:
- This parser is intentionally strict. It only keeps problems where a
  scalar numeric answer can be extracted with good confidence.
- Ambiguous items (proofs, equation-writing prompts, etc.) are filtered out.
"""

from __future__ import annotations

import json
import random
import re
from dataclasses import dataclass
from fractions import Fraction
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

SRC = Path("third_party/calculus_bank/3000_solved_problems_in_calculus.pdf")
OUT = Path("data/calculus_mcq.json")
REPORT = Path("data/calculus_mcq_report.json")
SEED = 1729

SEGMENT_RE = re.compile(r"(?m)^\s*(\d{1,2}\.\d{1,3})\s+")
NUMBER_TOKEN_RE = re.compile(r"[-+]?\d+(?:\.\d+)?(?:/\d+)?")
LEADING_VERB_RE = re.compile(
    r"^(?:Find|Evaluate|Compute|Determine|State|Approximate|Calculate|"
    r"Differentiate|Integrate|Solve|What\s+is)\b",
    re.I,
)

# Prompts likely expecting scalar numeric answers.
SCALAR_HINT_RE = re.compile(
    r"\b(?:value|evaluate|compute|slope|distance|radius|area|volume|length|"
    r"limit|derivative|integral|speed|rate|probability|sum|product|"
    r"angle|intersect(?:ion)?|remainder|root|maximum|minimum|"
    r"how\s+fast|how\s+many)\b",
    re.I,
)

# Prompts we should avoid for MCQ conversion without deeper symbolic parsing.
BLOCKLIST_RE = re.compile(
    r"\b(?:prove|show\s+that|write\s+an\s+equation|find\s+an\s+equation|"
    r"standard\s+equation|locus|domain|range|graph|sketch|"
    r"formula\s+for\s+the\s+function|point-slope\s+equation|"
    r"slope-intercept\s+equation)\b",
    re.I,
)

MALFORMED_PROMPT_RE = re.compile(
    r"[*`|]{1,}|\\\{|\\\}|(?:\b(?:jc|jr|At|Jt)\b)|\b(?:SCRATCH|WORKSHEET)\b",
    re.I,
)


@dataclass
class Segment:
    page: int
    key: str
    text: str


def clean_text(s: str) -> str:
    s = (s or "").replace("\r", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s).strip()
    # Common OCR artifacts in this PDF extraction.
    s = s.replace(" jc", " x").replace(" At", " x").replace(" jr", " x")
    s = s.replace("Jt", "x").replace("•", " * ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_prompt_math(s: str) -> str:
    s = (s or "").strip()
    # Common OCR substitutions.
    s = s.replace(" x-l", " x-1").replace("(x-l)", "(x-1)")
    s = s.replace(" Ix ", " 1x ").replace(" + Ix", " + 1x").replace(" - Ix", " - 1x")
    s = s.replace(" x2", " x^2").replace(" y2", " y^2").replace(" z2", " z^2")
    s = s.replace(" x3", " x^3").replace(" y3", " y^3").replace(" z3", " z^3")
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def is_renderable_prompt(s: str) -> bool:
    if MALFORMED_PROMPT_RE.search(s):
        return False
    if s.count("(") != s.count(")"):
        return False
    if s.count("[") != s.count("]"):
        return False
    # Must contain meaningful text, not mostly symbols.
    letters = len(re.findall(r"[A-Za-z]", s))
    symbols = len(re.findall(r"[^A-Za-z0-9\s]", s))
    if letters < 10:
        return False
    if symbols > letters * 0.9:
        return False
    return True


def load_segments(pdf_path: Path) -> list[Segment]:
    reader = PdfReader(str(pdf_path))
    out: list[Segment] = []
    for page_no, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            text = page.extract_text() or ""
        matches = list(SEGMENT_RE.finditer(text))
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            seg = text[m.start():end]
            out.append(Segment(page=page_no, key=m.group(1), text=seg))
    return out


def extract_prompt(seg: Segment) -> Optional[str]:
    raw = clean_text(seg.text)
    raw = re.sub(r"\bCHAPTER\s+\d+\b.*$", "", raw, flags=re.I).strip()
    # Remove leading item number.
    raw = re.sub(rf"^{re.escape(seg.key)}\s+", "", raw)
    # Keep only prompt preamble before solution transitions.
    raw = re.split(r"\b(?:Answer|Hence|Thus|Since|Method|Fig\.|CHAPTER)\b", raw, maxsplit=1)[0]
    raw = raw.strip(" .;:")
    if not raw:
        return None

    # Keep a bounded first sentence/question for UI readability.
    sentence_end = re.search(r"[?.]", raw)
    if sentence_end:
        prompt = raw[:sentence_end.end()].strip()
    else:
        prompt = raw[:260].strip(" .;:")
    prompt = normalize_prompt_math(prompt)

    if len(prompt) < 20 or len(prompt) > 260:
        return None
    if not LEADING_VERB_RE.search(prompt):
        return None
    if BLOCKLIST_RE.search(prompt):
        return None
    if not (SCALAR_HINT_RE.search(prompt) or "?" in prompt or prompt.lower().startswith("solve")):
        return None
    if not is_renderable_prompt(prompt):
        return None
    return prompt


def parse_number_token(token: str) -> Optional[Fraction]:
    t = (token or "").strip()
    if not t:
        return None
    if not re.fullmatch(r"[-+]?\d+(?:\.\d+)?(?:/\d+)?", t):
        return None
    try:
        if "/" in t:
            num, den = t.split("/", 1)
            frac = Fraction(int(num), int(den))
        elif "." in t:
            frac = Fraction(t)
        else:
            frac = Fraction(int(t), 1)
    except Exception:
        return None
    if abs(float(frac)) > 1_000_000:
        return None
    return frac


def extract_answer_fraction(seg: Segment) -> Optional[Fraction]:
    raw = seg.text
    # 1) Explicit Answer marker (highest confidence)
    m_ans = re.search(r"\bAnswer\b\s*[:\-]?\s*([^\n]{1,180})", raw, flags=re.I)
    if m_ans:
        line = clean_text(m_ans.group(1))
        # Truncate at strong clause transitions.
        line = re.split(r"\b(?:Find|Solve|If|For|Let|Since|Hence|Thus|CHAPTER|Fig\.)\b", line, maxsplit=1)[0]
        tok = NUMBER_TOKEN_RE.search(line)
        if tok:
            frac = parse_number_token(tok.group(0))
            if frac is not None:
                return frac

    # 2) Final equality in tail (high confidence)
    tail = clean_text(raw[-260:])
    m_eq = list(re.finditer(r"=\s*([-+]?\d+(?:\.\d+)?(?:/\d+)?)\b", tail))
    if m_eq:
        frac = parse_number_token(m_eq[-1].group(1))
        if frac is not None:
            return frac

    # 3) Concluding keyword with number nearby (medium confidence)
    m_kw = re.search(
        r"\b(?:Hence|Thus|So|therefore)\b[^.]{0,100}?([-+]?\d+(?:\.\d+)?(?:/\d+)?)\b",
        tail,
        flags=re.I,
    )
    if m_kw:
        frac = parse_number_token(m_kw.group(1))
        if frac is not None:
            return frac

    return None


def format_fraction(frac: Fraction) -> str:
    if frac.denominator == 1:
        return str(frac.numerator)
    return f"{frac.numerator}/{frac.denominator}"


def generate_distractors(ans: Fraction) -> list[Fraction]:
    cands: set[Fraction] = set()
    if ans.denominator == 1:
        base = ans.numerator
        for d in (1, 2, 3, 4, 5, 7):
            cands.add(Fraction(base + d, 1))
            cands.add(Fraction(base - d, 1))
        cands.add(Fraction(base * 2, 1))
        if base != 0:
            cands.add(Fraction(-base, 1))
    else:
        n, d = ans.numerator, ans.denominator
        for dn in (1, 2):
            cands.add(Fraction(n + dn, d))
            cands.add(Fraction(n - dn, d))
            cands.add(Fraction(n, d + dn))
            if d - dn != 0:
                cands.add(Fraction(n, d - dn))
        cands.add(Fraction(n + d, d))
        cands.add(Fraction(n - d, d))
    cands.discard(ans)
    # Keep reasonable display range.
    out = [x for x in cands if abs(float(x)) <= 1_000_000]
    out.sort(key=lambda x: (abs(float(x - ans)), float(x)))
    return out


def build_choices(ans: Fraction, rng: random.Random) -> Optional[tuple[list[str], int]]:
    distractors = generate_distractors(ans)
    if len(distractors) < 4:
        return None
    picked = distractors[:10]
    rng.shuffle(picked)
    picked = picked[:4]
    choices_frac = picked + [ans]
    rng.shuffle(choices_frac)
    choices = [format_fraction(x) for x in choices_frac]
    # Deduplicate after formatting.
    if len(set(choices)) != 5:
        return None
    answer_value = format_fraction(ans)
    answer_index = choices.index(answer_value)
    return choices, answer_index


def build_dataset(segments: Iterable[Segment]) -> tuple[list[dict], dict]:
    rng = random.Random(SEED)
    out: list[dict] = []
    seen_prompt = set()
    reasons = {
        "no_prompt": 0,
        "no_answer": 0,
        "no_choices": 0,
        "dup_prompt": 0,
    }

    for seg in segments:
        prompt = extract_prompt(seg)
        if not prompt:
            reasons["no_prompt"] += 1
            continue
        answer_frac = extract_answer_fraction(seg)
        if answer_frac is None:
            reasons["no_answer"] += 1
            continue
        built = build_choices(answer_frac, rng)
        if not built:
            reasons["no_choices"] += 1
            continue
        choices, answer_index = built

        prompt_norm = prompt.lower()
        if prompt_norm in seen_prompt:
            reasons["dup_prompt"] += 1
            continue
        seen_prompt.add(prompt_norm)

        pid = f"calc-schaum-{seg.key.replace('.', '-')}-p{seg.page}"
        out.append(
            {
                "id": pid,
                "type": "mcq",
                "contest": "calculus",
                "label": "Schaum (3000 Solved Problems) - Calculus",
                "weight": 8,
                "prompt": prompt,
                "choices": choices,
                "answerIndex": answer_index,
                "answerKey": "ABCDE"[answer_index],
                "answer": choices[answer_index],
                "source": {
                    "pdf": str(SRC),
                    "problemKey": seg.key,
                    "page": seg.page,
                },
            }
        )

    out.sort(key=lambda x: x["id"])
    report = {
        "source_pdf": str(SRC),
        "segments_total": len(list(segments)) if not isinstance(segments, list) else len(segments),
        "mcq_count": len(out),
        "drop_reasons": reasons,
        "notes": [
            "Parser keeps only high-confidence scalar-answer items.",
            "Two-column OCR noise in source PDF limits recoverable coverage.",
            "Generated distractors are heuristic; review before production use.",
        ],
    }
    return out, report


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source PDF: {SRC}")
    segments = load_segments(SRC)
    dataset, report = build_dataset(segments)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dataset, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
