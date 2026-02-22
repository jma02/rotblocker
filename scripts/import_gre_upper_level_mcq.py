#!/usr/bin/env python3
"""
Build an upper-level GRE Mathematics MCQ dataset from public practice PDFs.

Outputs:
  - data/upper_level_mcq.json
  - data/upper_level_mcq_report.json

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

OUT = ROOT / "data" / "upper_level_mcq.json"
REPORT = ROOT / "data" / "upper_level_mcq_report.json"

Q_START_RE = re.compile(r"(?m)^\s*(\d{1,3})\.\s+")
CHOICE_MARK_RE = re.compile(r"\(([A-Ea-e])\)")
SET_RE = re.compile(r"Problem Set #\s*(\d+)", re.I)
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


def build_item(source: str, set_no: Optional[int], q: ParsedQuestion, answer_key: str, idx: int) -> dict:
    topic = classify_topic(q.prompt)
    prompt = mathjax_sanitize(q.prompt)
    choices = [mathjax_sanitize(c) for c in q.choices]
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
        "source": {
            "dataset": source,
            "problemSet": set_no,
            "question": q.qnum,
        },
    }


def main() -> None:
    missing = [p for p in [PRACTICE_Q, PRACTICE_A, BOOT_Q, BOOT_A] if not p.exists()]
    if missing:
        raise SystemExit(f"Missing required files: {missing}")

    items: list[dict] = []
    stats = {
        "source_blocked_note": "mathematicsgre.com/viewtopic.php?t=4577 was Cloudflare-blocked (403); used public GRE-math practice PDFs.",
        "practice_parsed": 0,
        "practice_matched": 0,
        "boot_sets_parsed": 0,
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
        if not is_quality_item(item):
            stats["quality_dropped_total"] += 1
            stats["quality_dropped_nonrutgers"] += 1
            continue
        items.append(item)
        stats["practice_matched"] += 1
        stats["topic_counts"][item["topic"]] += 1

    # Bootcamp sets + keyed solutions
    boot_q_sets = split_by_problem_set(read_pdf_text(BOOT_Q))
    boot_a_sets = split_by_problem_set(read_pdf_text(BOOT_A))
    stats["boot_sets_parsed"] = len(boot_q_sets)
    for set_no, q_text in boot_q_sets.items():
        qs = parse_mcq_blocks(q_text)
        key = parse_answer_key_simple(boot_a_sets.get(set_no, ""))
        for q in qs:
            ans = key.get(q.qnum)
            if not ans:
                continue
            idx = ord(ans) - ord("A")
            if idx < 0 or idx >= len(q.choices):
                continue
            item = build_item("GREBootcamp", set_no, q, ans, idx)
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
