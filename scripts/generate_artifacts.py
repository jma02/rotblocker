#!/usr/bin/env python3
"""
Generate publishable offline dataset artifacts for:
  - Calculus MCQ
  - GRE Mathematics Upper-Level MCQ

This script intentionally emits versioned JSON artifacts in one shot, rather than
maintaining a long-running data pipeline.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
ARTIFACTS_DIR = ROOT / "artifacts"

CALC_INPUT = DATA_DIR / "calculus_mcq_synthetic.json"
GRE_INPUT = DATA_DIR / "upper_level_mcq.json"

BAD_TOKEN_RE = re.compile(
    r"(?:\bfrorr\b|\bthereliability\b|\bcoliection\b|\bshadect\b|\bonconstamt\b|"
    r"\bineducibility\b|\bparaliel\b|\bmust\s+aug\b|\bef\s+the\b)",
    re.I,
)
UNSUPPORTED_LATEX_RE = re.compile(
    r"(?:\\begin\{tabular\*?\}|\\end\{tabular\*?\}|\\multicolumn|\\hspace\*?\{|"
    r"\\vspace\*?\{|\\setlength\{\\tabcolsep\}|\\textdollars?)",
    re.I,
)
WEIRD_CHAR_RE = re.compile(r"[£¢¥§©�]")


def load_rows(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def sha256_text(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def normalize_text(text: Any) -> str:
    s = str(text or "")
    s = s.replace("\ufb01", "fi").replace("\ufb02", "fl")
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    s = s.replace("\u00a0", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def normalize_math_text(text: Any) -> str:
    s = normalize_text(text)
    replacements = [
        ("∈", "\\in "),
        ("∞", "\\infty "),
        ("≤", "\\le "),
        ("≥", "\\ge "),
        ("≠", "\\ne "),
        ("≈", "\\approx "),
        ("∑", "\\sum "),
        ("∏", "\\prod "),
        ("∫", "\\int "),
        ("π", "\\pi "),
        ("θ", "\\theta "),
        ("α", "\\alpha "),
        ("β", "\\beta "),
        ("γ", "\\gamma "),
        ("λ", "\\lambda "),
        ("μ", "\\mu "),
        ("σ", "\\sigma "),
        ("ϕ", "\\phi "),
        ("φ", "\\phi "),
        ("ω", "\\omega "),
    ]
    for src, dst in replacements:
        s = s.replace(src, dst)

    s = re.sub(r"(?<!\\)\bsqrt\b", r"\\sqrt", s)
    s = re.sub(r"(?<!\\)\barcsin\b", r"\\arcsin", s, flags=re.I)
    s = re.sub(r"(?<!\\)\barccos\b", r"\\arccos", s, flags=re.I)
    s = re.sub(r"(?<!\\)\barctan\b", r"\\arctan", s, flags=re.I)
    s = re.sub(r"(?<!\\)\bsin\b", r"\\sin", s, flags=re.I)
    s = re.sub(r"(?<!\\)\bcos\b", r"\\cos", s, flags=re.I)
    s = re.sub(r"(?<!\\)\btan\b", r"\\tan", s, flags=re.I)
    s = re.sub(r"(?<!\\)\bsec\b", r"\\sec", s, flags=re.I)
    s = re.sub(r"(?<!\\)\bcsc\b", r"\\csc", s, flags=re.I)
    s = re.sub(r"(?<!\\)\bcot\b", r"\\cot", s, flags=re.I)
    s = re.sub(r"(?<!\\)\blog\b", r"\\log", s, flags=re.I)
    s = re.sub(r"(?<!\\)\bln\b", r"\\ln", s, flags=re.I)
    s = re.sub(r"(?<!\\)\blim\b", r"\\lim", s, flags=re.I)
    s = re.sub(r"(?<=\d)\s*T(?=\s*/\s*\d)", r"\\pi", s)
    s = re.sub(r"\bT(?=\s*/\s*\d)", r"\\pi", s)
    s = re.sub(r"\bI(?=\s*/\s*\d)", "1", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def odd_unescaped_dollar(s: str) -> bool:
    count = 0
    for i, ch in enumerate(s):
        if ch == "$" and (i == 0 or s[i - 1] != "\\"):
            count += 1
    return count % 2 == 1


def unbalanced_delimiters(s: str) -> bool:
    return (
        s.count("(") != s.count(")")
        or s.count("[") != s.count("]")
        or s.count("{") != s.count("}")
    )


def validate_math_text(s: str) -> str | None:
    if not s:
        return "empty_text"
    if BAD_TOKEN_RE.search(s):
        return "bad_ocr_token"
    if WEIRD_CHAR_RE.search(s):
        return "weird_char"
    if UNSUPPORTED_LATEX_RE.search(s):
        return "unsupported_latex"
    if odd_unescaped_dollar(s):
        return "odd_dollar"
    if unbalanced_delimiters(s):
        return "unbalanced_delimiters"
    return None


def clean_mcq_row(
    row: dict[str, Any],
    *,
    contest: str,
    label: str,
) -> tuple[dict[str, Any] | None, str | None]:
    item = deepcopy(row)
    item["contest"] = contest
    item["label"] = label
    item["type"] = "mcq"

    item["prompt"] = normalize_math_text(item.get("prompt", ""))
    choices = item.get("choices")
    if not isinstance(choices, list) or len(choices) != 5:
        return None, "choices_shape"

    item["choices"] = [normalize_math_text(c) for c in choices]
    if any(not c for c in item["choices"]):
        return None, "empty_choice"
    if len(set(item["choices"])) < 5:
        return None, "duplicate_choices"

    answer_index = item.get("answerIndex")
    if not isinstance(answer_index, int) or not (0 <= answer_index < 5):
        return None, "answer_index"
    item["answerIndex"] = answer_index
    item["answerKey"] = "ABCDE"[answer_index]
    item["answer"] = item["choices"][answer_index]

    item["hint"] = normalize_text(item.get("hint", "")) or "Break it down into manageable steps and verify each one."

    prompt_reason = validate_math_text(item["prompt"])
    if prompt_reason:
        return None, f"prompt_{prompt_reason}"
    for c in item["choices"]:
        choice_reason = validate_math_text(c)
        if choice_reason:
            return None, f"choice_{choice_reason}"

    if not item.get("id"):
        return None, "missing_id"
    item["id"] = normalize_text(item["id"])
    return item, None


def build_calculus(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Counter]:
    keeps: list[dict[str, Any]] = []
    rejects: list[dict[str, Any]] = []
    reasons: Counter = Counter()

    for row in rows:
        cleaned, reason = clean_mcq_row(
            row,
            contest="calculus",
            label="Calculus MCQ",
        )
        if cleaned is None:
            reasons[reason or "unknown"] += 1
            rejects.append({"id": row.get("id"), "pool": "calculus", "reason": reason or "unknown"})
            continue
        keeps.append(cleaned)

    keeps.sort(key=lambda x: x["id"])
    return keeps, rejects, reasons


def build_gre(
    rows: list[dict[str, Any],
             ],
    *,
    source_policy: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Counter]:
    keeps: list[dict[str, Any]] = []
    rejects: list[dict[str, Any]] = []
    reasons: Counter = Counter()

    allowed_sources = None
    if source_policy == "grepractice_only":
        allowed_sources = {"GREpractice"}

    for row in rows:
        src = row.get("source", {}) if isinstance(row.get("source"), dict) else {}
        src_name = normalize_text(src.get("dataset", "")) or "unknown"
        if allowed_sources is not None and src_name not in allowed_sources:
            reasons["source_filtered"] += 1
            rejects.append({"id": row.get("id"), "pool": "upper_level_mcq", "reason": "source_filtered"})
            continue

        cleaned, reason = clean_mcq_row(
            row,
            contest="upper_level_mcq",
            label="GRE Mathematics Upper-Level MCQ",
        )
        if cleaned is None:
            reasons[reason or "unknown"] += 1
            rejects.append({"id": row.get("id"), "pool": "upper_level_mcq", "reason": reason or "unknown"})
            continue
        keeps.append(cleaned)

    dedup: dict[str, dict[str, Any]] = {}
    for item in keeps:
        key = normalize_text(item.get("prompt", "")).lower()
        if key in dedup:
            reasons["duplicate_prompt"] += 1
            rejects.append({"id": item.get("id"), "pool": "upper_level_mcq", "reason": "duplicate_prompt"})
            continue
        dedup[key] = item

    final = sorted(dedup.values(), key=lambda x: x["id"])
    return final, rejects, reasons


def generate(version: str, gre_source_policy: str, calculus_input: Path) -> None:
    calc_rows = load_rows(calculus_input)
    gre_rows = load_rows(GRE_INPUT)

    calc_final, calc_rejects, calc_reasons = build_calculus(calc_rows)
    gre_final, gre_rejects, gre_reasons = build_gre(gre_rows, source_policy=gre_source_policy)

    calc_name = f"calculus_mcq_{version}.json"
    gre_name = f"gre_math_mcq_{version}.json"
    manifest_name = f"manifest_{version}.json"
    rejects_name = f"rejects_{version}.json"

    calc_path = ARTIFACTS_DIR / calc_name
    gre_path = ARTIFACTS_DIR / gre_name
    manifest_path = ARTIFACTS_DIR / manifest_name
    rejects_path = ARTIFACTS_DIR / rejects_name

    write_json(calc_path, calc_final)
    write_json(gre_path, gre_final)

    rejects = {
        "version": version,
        "calculus": {
            "count": len(calc_rejects),
            "reasons": dict(calc_reasons),
            "sample": calc_rejects[:200],
        },
        "upper_level_mcq": {
            "count": len(gre_rejects),
            "reasons": dict(gre_reasons),
            "sample": gre_rejects[:200],
        },
    }
    write_json(rejects_path, rejects)

    manifest = {
        "schema_version": 1,
        "artifact_version": version,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "calculus": {
                "path": display_path(calculus_input),
                "sha256": sha256_file(calculus_input),
                "count": len(calc_rows),
                "source_credit": "Synthetic original calculus MCQ bank generated locally",
            },
            "upper_level_mcq": {
                "path": display_path(GRE_INPUT),
                "sha256": sha256_file(GRE_INPUT),
                "count": len(gre_rows),
                "source_credit": "GRE Mathematics practice materials in third_party/gre_math",
                "source_policy": gre_source_policy,
            },
        },
        "outputs": {
            "calculus": {
                "path": display_path(calc_path),
                "count": len(calc_final),
                "sha256": sha256_text(calc_path.read_text(encoding="utf-8")),
            },
            "upper_level_mcq": {
                "path": display_path(gre_path),
                "count": len(gre_final),
                "sha256": sha256_text(gre_path.read_text(encoding="utf-8")),
            },
            "rejects": {
                "path": display_path(rejects_path),
                "sha256": sha256_text(rejects_path.read_text(encoding="utf-8")),
            },
        },
        "quality_gate": {
            "checks": [
                "mcq shape (5 choices, answerIndex)",
                "duplicate choice rejection",
                "text normalization for MathJax-oriented LaTeX symbols",
                "unsupported latex pattern rejection",
                "odd-dollar and unbalanced delimiter rejection",
                "OCR garbage token rejection",
                "prompt dedup for GRE set",
            ],
        },
    }
    write_json(manifest_path, manifest)

    print(f"Wrote {calc_path.relative_to(ROOT)} ({len(calc_final)} rows)")
    print(f"Wrote {gre_path.relative_to(ROOT)} ({len(gre_final)} rows)")
    print(f"Wrote {manifest_path.relative_to(ROOT)}")
    print(f"Wrote {rejects_path.relative_to(ROOT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate frozen calculus and GRE artifacts.")
    parser.add_argument(
        "--version",
        default="v1",
        help="Artifact version suffix (default: v1).",
    )
    parser.add_argument(
        "--gre-source-policy",
        choices=["all", "grepractice_only"],
        default="all",
        help="Filter policy for GRE sources.",
    )
    parser.add_argument(
        "--calculus-input",
        type=Path,
        default=CALC_INPUT,
        help="Input calculus JSON path (default: data/calculus_mcq_synthetic.json).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    calculus_input = args.calculus_input
    if not calculus_input.is_absolute():
        calculus_input = (ROOT / calculus_input).resolve()
    generate(
        version=args.version,
        gre_source_policy=args.gre_source_policy,
        calculus_input=calculus_input,
    )


if __name__ == "__main__":
    main()
