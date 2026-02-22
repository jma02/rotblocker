#!/usr/bin/env python3
"""
Clean and validate advanced datasets used by RotBlock++:
  - data/calculus_mcq.json
  - data/upper_level_mcq.json

This script enforces structural integrity, removes clearly malformed OCR rows,
normalizes text, and emits cleanup reports.
"""

from __future__ import annotations

import hashlib
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
    kept: list[dict[str, Any]] = []
    drops: Counter[str] = Counter()
    dropped_ids: list[str] = []

    for row in rows:
        reason = drop_reason_calculus(row)
        if reason:
            drops[reason] += 1
            dropped_ids.append(str(row.get("id", "")))
            continue
        kept.append(clean_row(row))

    kept.sort(key=lambda x: str(x.get("id", "")))
    report = {
        "source": str(CALC_PATH),
        "input_count": len(rows),
        "kept_count": len(kept),
        "dropped_count": len(rows) - len(kept),
        "drop_reasons": dict(drops),
        "dropped_id_sample": dropped_ids[:40],
    }
    return kept, report


def clean_upper(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    drops: Counter[str] = Counter()
    dropped_ids: list[str] = []

    for row in rows:
        reason = drop_reason_upper(row)
        if reason:
            drops[reason] += 1
            dropped_ids.append(str(row.get("id", "")))
            continue
        kept.append(clean_row(row))

    # Ensure deterministic, unique IDs even when imported source IDs collide.
    dedup_prompt: set[str] = set()
    final_rows: list[dict[str, Any]] = []
    id_collisions = 0
    for row in kept:
        prompt_key = row["prompt"].lower()
        if prompt_key in dedup_prompt:
            drops["duplicate_prompt"] += 1
            continue
        dedup_prompt.add(prompt_key)

        source = row.get("source", {}) if isinstance(row.get("source"), dict) else {}
        dataset = normalize_text(source.get("dataset", "upper"))
        set_no = normalize_text(source.get("problemSet", "na"))
        q_no = normalize_text(source.get("question", "na"))
        digest = hashlib.sha1(row["prompt"].encode("utf-8")).hexdigest()[:8]
        new_id = f"upper-gre-{dataset.lower()}-s{set_no}-q{q_no}-{digest}"
        row["id"] = new_id
        final_rows.append(row)

    id_counts = Counter(str(r["id"]) for r in final_rows)
    if any(v > 1 for v in id_counts.values()):
        # Extremely unlikely after hash; keep first if collision happens.
        unique: dict[str, dict[str, Any]] = {}
        for row in final_rows:
            rid = str(row["id"])
            if rid in unique:
                id_collisions += 1
                continue
            unique[rid] = row
        final_rows = list(unique.values())

    final_rows.sort(key=lambda x: str(x.get("id", "")))
    report = {
        "source": str(UPPER_PATH),
        "input_count": len(rows),
        "kept_count": len(final_rows),
        "dropped_count": len(rows) - len(final_rows),
        "drop_reasons": dict(drops),
        "dropped_id_sample": dropped_ids[:40],
        "id_collisions_after_reid": id_collisions,
    }
    return final_rows, report


def main() -> None:
    calc_rows = load_json(CALC_PATH)
    upper_rows = load_json(UPPER_PATH)

    calc_clean, calc_report = clean_calculus(calc_rows)
    upper_clean, upper_report = clean_upper(upper_rows)

    write_json(CALC_PATH, calc_clean)
    write_json(UPPER_PATH, upper_clean)
    write_json(CALC_REPORT, calc_report)
    write_json(UPPER_REPORT, upper_report)

    print("calculus:", calc_report["input_count"], "->", calc_report["kept_count"])
    print("upper:", upper_report["input_count"], "->", upper_report["kept_count"])


if __name__ == "__main__":
    main()
