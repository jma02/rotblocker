#!/usr/bin/env python3
"""
Quarantine the retired calculus import used by RotBlock++.

The curated upper-level GRE bank is validated without rewriting rows, IDs, or
its historical pre-rewrite quality report.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CALC_PATH = ROOT / "data" / "calculus_mcq.json"
UPPER_PATH = ROOT / "data" / "upper_level_mcq.json"
CALC_REPORT = ROOT / "data" / "calculus_mcq_quality_report.json"
UPPER_REPORT = ROOT / "data" / "upper_level_mcq_quality_report.json"

BAD_TOKEN_RE = re.compile(
    r"(?:\bfrorr\b|\bthereliability\b|\bcoliection\b|\bshadect\b|\bonconstamt\b|"
    r"\bineducibility\b|\bparaliel\b|\bmust\s+aug\b|\bef\s+the\b)",
    re.I,
)
FOOTER_RE = re.compile(
    r"(?:GRE\s+MATHEMATICS|ANSWER\s+KEY|SCRATCH\s+WORK|Unauthorized\s+copying|"
    r"GO\s+ON\s+TO\s+THE\s+NEXT\s+PAGE|\.EGAP\s+TXEN)",
    re.I,
)
XREF_RE = re.compile(r"\bin Problem\b|\bsee Problem\b|\bProblem\s+\d", re.I)
WEIRD_CHAR_RE = re.compile(r"[£¢¥§©�]")
DANGLING_RE = re.compile(r"[=+\-*/]\s*$")
NON_SCALAR_RE = re.compile(
    r"\b(parametric|find equations|find a formula|equation of|tangent plane|"
    r"intersection of the planes|graph|sketch)\b",
    re.I,
)
NUMERIC_CHOICE_RE = re.compile(r"-?\d+(?:/\d+)?")


def load_json(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def normalize_text(s: Any) -> str:
    out = str(s or "")
    out = out.replace("\ufb01", "fi").replace("\ufb02", "fl")
    out = out.replace("−", "-").replace("–", "-").replace("—", "-")
    out = re.sub(r"\s+", " ", out).strip()
    return out


def odd_unescaped_dollar(s: str) -> bool:
    count = 0
    for i, ch in enumerate(s):
        if ch == "$" and (i == 0 or s[i - 1] != "\\"):
            count += 1
    return count % 2 == 1


def structurally_valid(item: dict[str, Any]) -> str | None:
    prompt = normalize_text(item.get("prompt", ""))
    choices = item.get("choices")
    answer_index = item.get("answerIndex")
    answer = normalize_text(item.get("answer", ""))

    if not prompt:
        return "empty_prompt"
    if not isinstance(choices, list) or len(choices) != 5:
        return "choices_shape"
    if not isinstance(answer_index, int) or not (0 <= answer_index < 5):
        return "answer_index"
    norm_choices = [normalize_text(c) for c in choices]
    if any(not c for c in norm_choices):
        return "empty_choice"
    if len(set(norm_choices)) < 5:
        return "duplicate_choices"
    if answer != norm_choices[answer_index]:
        return "answer_mismatch"
    if odd_unescaped_dollar(prompt) or any(odd_unescaped_dollar(c) for c in norm_choices):
        return "dollar_balance"
    return None


def drop_reason_calculus(item: dict[str, Any]) -> str | None:
    structural = structurally_valid(item)
    if structural:
        return structural

    prompt = normalize_text(item["prompt"])
    choices = [normalize_text(c) for c in item["choices"]]
    numeric_only = all(NUMERIC_CHOICE_RE.fullmatch(c) for c in choices)

    if len(prompt) < 20 or len(prompt) > 320:
        return "prompt_len"
    if FOOTER_RE.search(prompt) or any(FOOTER_RE.search(c) for c in choices):
        return "footer_noise"
    if BAD_TOKEN_RE.search(prompt) or any(BAD_TOKEN_RE.search(c) for c in choices):
        return "bad_token"
    if WEIRD_CHAR_RE.search(prompt) or any(WEIRD_CHAR_RE.search(c) for c in choices):
        return "weird_char"
    if XREF_RE.search(prompt):
        return "cross_reference"
    if NON_SCALAR_RE.search(prompt) and numeric_only:
        return "non_scalar_numeric_choices"
    return None


def drop_reason_upper(item: dict[str, Any]) -> str | None:
    structural = structurally_valid(item)
    if structural:
        return structural

    prompt = normalize_text(item["prompt"])
    choices = [normalize_text(c) for c in item["choices"]]

    if len(prompt) < 20 or len(prompt) > 320:
        return "prompt_len"
    if FOOTER_RE.search(prompt) or any(FOOTER_RE.search(c) for c in choices):
        return "footer_noise"
    if BAD_TOKEN_RE.search(prompt) or any(BAD_TOKEN_RE.search(c) for c in choices):
        return "bad_token"
    if WEIRD_CHAR_RE.search(prompt) or any(WEIRD_CHAR_RE.search(c) for c in choices):
        return "weird_char"
    if DANGLING_RE.search(prompt):
        return "dangling_prompt"
    return None


def clean_row(item: dict[str, Any]) -> dict[str, Any]:
    out = dict(item)
    out["prompt"] = normalize_text(out.get("prompt", ""))
    out["choices"] = [normalize_text(c) for c in out.get("choices", [])]
    out["answer"] = normalize_text(out.get("answer", ""))
    return out


def clean_calculus(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Quarantine every row from the retired solved-problem-book extractor."""

    dropped_ids = [str(row.get("id", "")) for row in rows]
    report = {
        "source": "data/calculus_mcq.json",
        "source_pdf": "third_party/calculus_bank/3000_solved_problems_in_calculus.pdf",
        "pipeline_stage": "retired_untrusted_import",
        "input_count": len(rows),
        "kept_count": 0,
        "dropped_count": len(rows),
        "drop_reasons": {"unverified_synthetic_choices": len(rows)} if rows else {},
        "dropped_id_sample": dropped_ids[:40],
        "notes": [
            "The source is a solved-problem book with no multiple-choice options.",
            "The retired importer synthesized every distractor and could mistake OCR intermediate values for answers.",
            "Use data/calculus_mcq_synthetic.json for the shipped calculus bank.",
        ],
    }
    return [], report


def clean_upper(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Validate the curated bank without applying an obsolete import filter."""

    invalid = [
        {
            "id": str(row.get("id", "")),
            "reason": structurally_valid(row),
        }
        for row in rows
        if structurally_valid(row) is not None
    ]
    ids = [str(row.get("id", "")) for row in rows]
    if len(ids) != len(set(ids)):
        invalid.append({"id": "", "reason": "duplicate_id"})
    if invalid:
        sample = ", ".join(
            f"{item['id'] or '<unknown>'}:{item['reason']}"
            for item in invalid[:10]
        )
        raise ValueError(f"Curated upper-level bank failed validation: {sample}")

    report = {
        "source": "data/upper_level_mcq.json",
        "pipeline_stage": "curated_validation_only",
        "input_count": len(rows),
        "kept_count": len(rows),
        "dropped_count": 0,
        "drop_reasons": {},
    }
    return rows, report


def main() -> None:
    calc_rows = load_json(CALC_PATH)
    upper_rows = load_json(UPPER_PATH)

    calc_clean, calc_report = clean_calculus(calc_rows)
    upper_clean, upper_report = clean_upper(upper_rows)

    write_json(CALC_PATH, calc_clean)
    if upper_clean != upper_rows:
        raise RuntimeError("Upper-level validation attempted to rewrite curated rows")
    # Preserve the historical retirement report once the active placeholder is
    # empty; re-running the cleaner must not erase how many rows were removed.
    if calc_rows or not CALC_REPORT.exists():
        write_json(CALC_REPORT, calc_report)

    print("calculus:", calc_report["input_count"], "->", calc_report["kept_count"])
    print("upper:", upper_report["kept_count"], "validated, unchanged")


if __name__ == "__main__":
    main()
