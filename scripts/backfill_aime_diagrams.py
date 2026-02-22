#!/usr/bin/env python3
"""Backfill missing AIME diagram assets from AoPS problem pages.

This script targets AIME rows in data/aime.json that do not have diagramPng/diagramSvg.
For each candidate, it reads the AoPS problem link from the AMIO CSV, fetches the page,
extracts image tags from the Problem section (before Solution), downloads the best image,
stores it under assets/diagrams/<problem_id>.<ext>, and writes diagram metadata back.
"""

from __future__ import annotations

import csv
import json
import re
import argparse
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, unquote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
AMIO_CSV = ROOT / "third_party" / "amio_aops" / "parsed_ArtOfProblemSolving.csv"
AIME_JSON = ROOT / "data" / "aime.json"
DIAGRAMS_DIR = ROOT / "assets" / "diagrams"

USER_AGENT = "Mozilla/5.0 (RotBlock++ dataset backfill)"
IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.I)
SRC_RE = re.compile(r'src\s*=\s*"([^"]+)"', re.I)
ALT_RE = re.compile(r'alt\s*=\s*"([^"]*)"', re.I)
WIDTH_RE = re.compile(r'width\s*=\s*"(\d+)"', re.I)
HEIGHT_RE = re.compile(r'height\s*=\s*"(\d+)"', re.I)
PROBLEM_SECTION_RE = re.compile(r'id="Problem"', re.I)
SOLUTION_SECTION_RE = re.compile(r'id="Solution[^"]*"', re.I)

# These appear frequently as tiny UI/formatting images on wiki pages.
SKIP_IMAGE_HINTS = (
    "/skins/",
    "poweredby",
    "magnify-clip",
    "math/render/svg/",
    "math/render/png/",
    "aops_logo",
)


@dataclass
class ImageCandidate:
    order: int
    src: str
    alt: str
    match_rank: int
    width: int
    height: int
    area: int


@dataclass
class DownloadedCandidate:
    src: str
    ext: str
    body: bytes
    width: int
    height: int
    area: int
    match_rank: int


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def normalize_src(src: str) -> str:
    s = (src or "").strip()
    if not s:
        return ""
    if s.startswith("//"):
        return f"https:{s}"
    if s.startswith("/"):
        return f"https://artofproblemsolving.com{s}"
    return s


def infer_extension(url: str, content_type: str | None) -> str:
    path = urlparse(url).path.lower()
    if path.endswith(".svg"):
        return ".svg"
    if path.endswith(".png"):
        return ".png"
    if path.endswith(".gif"):
        return ".gif"
    if path.endswith(".jpg") or path.endswith(".jpeg"):
        return ".jpg"
    ctype = (content_type or "").lower()
    if "image/svg" in ctype:
        return ".svg"
    if "image/png" in ctype:
        return ".png"
    if "image/gif" in ctype:
        return ".gif"
    if "image/jpeg" in ctype:
        return ".jpg"
    return ".png"


def should_skip_src(src: str) -> bool:
    ls = src.lower()
    return any(h in ls for h in SKIP_IMAGE_HINTS)


def normalize_filename_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def extract_expected_filename(problem_text: str) -> str:
    text = problem_text or ""
    candidates = re.findall(r"([A-Za-z0-9 _-]+\.(?:png|gif|jpe?g))", text, flags=re.I)
    if not candidates:
        return ""
    # Prefer the last file mention; source rows often append explicit image names.
    return clean_text(candidates[-1])


def match_rank(src: str, expected_filename: str) -> int:
    if not expected_filename:
        return 0
    expected = normalize_filename_key(expected_filename)
    base = normalize_filename_key(Path(unquote(urlparse(src).path)).name)
    if not expected or not base:
        return 0
    if expected == base:
        return 3
    if expected in base or base in expected:
        return 2
    # Give partial credit for year/problem number overlap.
    year = re.search(r"(19|20)\d{2}", expected)
    prob = re.search(r"(problem|aime)[^0-9]*([0-9]{1,2})", expected)
    score = 0
    if year and year.group(0) in base:
        score += 1
    if prob and prob.group(2) in base:
        score += 1
    return 1 if score > 0 else 0


def parse_candidates(problem_html: str, expected_filename: str) -> list[ImageCandidate]:
    # Keep the slice from Problem heading to the first Solution heading.
    html = problem_html or ""
    p = PROBLEM_SECTION_RE.search(html)
    if p:
        html = html[p.start():]
    s = SOLUTION_SECTION_RE.search(html)
    if s:
        html = html[:s.start()]

    out: list[ImageCandidate] = []
    seen_src: set[str] = set()
    for idx, tag in enumerate(IMG_TAG_RE.findall(html), start=1):
        m_src = SRC_RE.search(tag)
        if not m_src:
            continue
        src = normalize_src(unescape(m_src.group(1)))
        if not src or should_skip_src(src):
            continue
        if src in seen_src:
            continue
        seen_src.add(src)
        alt = unescape(ALT_RE.search(tag).group(1)) if ALT_RE.search(tag) else ""
        w = int(WIDTH_RE.search(tag).group(1)) if WIDTH_RE.search(tag) else 0
        h = int(HEIGHT_RE.search(tag).group(1)) if HEIGHT_RE.search(tag) else 0
        area = w * h
        out.append(
            ImageCandidate(
                order=idx,
                src=src,
                alt=alt,
                match_rank=match_rank(src, expected_filename),
                width=w,
                height=h,
                area=area,
            )
        )

    # Prefer name-matched and larger candidates, and avoid latex inline images
    # when a regular wiki image exists.
    non_latex = [c for c in out if "latex.artofproblemsolving.com" not in c.src]
    if non_latex:
        out = non_latex
    out.sort(key=lambda c: (c.match_rank, c.area), reverse=True)
    return out


def fetch_bytes(url: str) -> tuple[bytes, str]:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=25) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def fetch_text(url: str) -> str:
    body, ctype = fetch_bytes(url)
    enc = "utf-8"
    m = re.search(r"charset=([A-Za-z0-9_\-]+)", ctype or "", re.I)
    if m:
        enc = m.group(1)
    try:
        return body.decode(enc, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def parse_image_dimensions(body: bytes, ext: str, content_type: str) -> tuple[int, int]:
    """Return (width, height) for common raster formats without external deps."""
    e = (ext or "").lower()
    c = (content_type or "").lower()
    if (e == ".png" or "image/png" in c) and len(body) >= 24 and body[:8] == b"\x89PNG\r\n\x1a\n":
        # IHDR width/height at bytes 16..24.
        w = int.from_bytes(body[16:20], "big")
        h = int.from_bytes(body[20:24], "big")
        return w, h
    if (e == ".gif" or "image/gif" in c) and len(body) >= 10 and body[:3] == b"GIF":
        w = int.from_bytes(body[6:8], "little")
        h = int.from_bytes(body[8:10], "little")
        return w, h
    if e in {".jpg", ".jpeg"} or "image/jpeg" in c:
        # Minimal JPEG SOF parser.
        i = 2
        if len(body) < 4 or body[0:2] != b"\xff\xd8":
            return 0, 0
        while i + 9 < len(body):
            if body[i] != 0xFF:
                i += 1
                continue
            marker = body[i + 1]
            i += 2
            # Standalone markers.
            if marker in {0xD8, 0xD9}:
                continue
            if i + 1 >= len(body):
                break
            seg_len = (body[i] << 8) + body[i + 1]
            if seg_len < 2 or i + seg_len > len(body):
                break
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                if i + 6 < len(body):
                    h = (body[i + 3] << 8) + body[i + 4]
                    w = (body[i + 5] << 8) + body[i + 6]
                    return w, h
            i += seg_len
    return 0, 0


def quality_ok(width: int, height: int, byte_len: int) -> bool:
    if width <= 0 or height <= 0:
        return False
    area = width * height
    if area < 12000:
        return False
    if width < 120 or height < 60:
        return False
    ratio = max(width / max(height, 1), height / max(width, 1))
    if ratio > 10:
        return False
    if byte_len < 600:
        return False
    return True


def select_equation_line_candidates(candidates: list[ImageCandidate]) -> list[ImageCandidate]:
    eq_lines = [
        c for c in candidates
        if "latex.artofproblemsolving.com" in c.src
        and "=" in (c.alt or "")
        and c.width >= 180
        and c.height >= 10
        and c.height <= 48
    ]
    eq_lines.sort(key=lambda c: c.order)
    return eq_lines


FIGURE_CUE_RE = re.compile(
    r"(?:\.(?:png|gif|jpe?g)\b|\bfigure\b|\bdiagram\b|\bas shown\b|\bshown\b|\bbelow\b)",
    re.I,
)


@dataclass
class AimeSourceRow:
    link: str
    problem: str


def extract_amio_aime_rows() -> dict[str, AimeSourceRow]:
    by_pid: dict[str, AimeSourceRow] = {}
    with AMIO_CSV.open(newline="", encoding="utf-8") as fh:
        rd = csv.DictReader(fh)
        for row in rd:
            link = clean_text(row.get("link", ""))
            pid = clean_text(row.get("problem_id", ""))
            problem = row.get("problem", "") or ""
            if not pid or not link:
                continue
            if "AIME_Problems" not in link:
                continue
            by_pid.setdefault(pid, AimeSourceRow(link=link, problem=problem))
    return by_pid


def has_figure_cue(problem_text: str) -> bool:
    return FIGURE_CUE_RE.search(problem_text or "") is not None


def iter_missing_aime_rows(rows: list[dict], target_ids: set[str]) -> Iterable[dict]:
    for row in rows:
        if row.get("contest") != "aime":
            continue
        rid = str(row.get("id", ""))
        if not rid.startswith("amio-"):
            continue
        if rid not in target_ids:
            continue
        if row.get("diagramPng") or row.get("diagramSvg"):
            continue
        yield row


def iter_target_rows(rows: list[dict], target_ids: set[str], repair_existing: bool) -> Iterable[dict]:
    if not repair_existing:
        yield from iter_missing_aime_rows(rows, target_ids)
        return
    for row in rows:
        if row.get("contest") != "aime":
            continue
        rid = str(row.get("id", ""))
        if not rid.startswith("amio-"):
            continue
        if rid not in target_ids:
            continue
        yield row


def backfill(*, all_missing: bool, repair_existing: bool) -> None:
    DIAGRAMS_DIR.mkdir(parents=True, exist_ok=True)

    source_rows = extract_amio_aime_rows()
    rows = json.loads(AIME_JSON.read_text(encoding="utf-8"))

    if all_missing:
        target_ids = {
            rid
            for rid in (str(r.get("id", "")) for r in rows)
            if rid.startswith("amio-")
        }
    else:
        target_ids = {
            f"amio-{pid}"
            for pid, src in source_rows.items()
            if has_figure_cue(src.problem)
        }

    scanned = 0
    patched = 0
    skipped = 0
    failed: list[str] = []

    for row in iter_target_rows(rows, target_ids, repair_existing):
        scanned += 1
        rid = str(row["id"])
        pid = rid.replace("amio-", "", 1)
        source = source_rows.get(pid)
        if not source:
            skipped += 1
            continue
        link = source.link
        expected_filename = extract_expected_filename(source.problem)

        try:
            html = fetch_text(link)
            candidates = parse_candidates(html, expected_filename)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            failed.append(f"{rid}: page fetch failed ({exc})")
            continue
        except Exception as exc:
            failed.append(f"{rid}: unexpected page parse error ({exc})")
            continue

        if not candidates:
            skipped += 1
            continue

        prompt_text = (row.get("prompt") or "") + " " + (source.problem or "")
        if re.search(r"system of equations below", prompt_text, re.I):
            eq_candidates = select_equation_line_candidates(candidates)
            if len(eq_candidates) >= 2:
                line_paths = []
                for idx, cand in enumerate(eq_candidates, start=1):
                    try:
                        body, content_type = fetch_bytes(cand.src)
                    except Exception:
                        continue
                    if not body or len(body) < 40:
                        continue
                    ext = infer_extension(cand.src, content_type)
                    out_file = DIAGRAMS_DIR / f"{pid}-eq{idx}{ext}"
                    out_file.write_bytes(body)
                    line_paths.append(f"assets/diagrams/{pid}-eq{idx}{ext}")
                if len(line_paths) >= 2:
                    row.pop("diagramPng", None)
                    row.pop("diagramSvg", None)
                    row["diagramPngs"] = line_paths
                    patched += 1
                    continue

        best: DownloadedCandidate | None = None
        accepted: DownloadedCandidate | None = None
        for cand in candidates:
            try:
                body, content_type = fetch_bytes(cand.src)
            except Exception:
                continue
            if not body or len(body) < 40:
                continue
            ext = infer_extension(cand.src, content_type)
            w, h = parse_image_dimensions(body, ext, content_type)
            area = w * h
            item = DownloadedCandidate(
                src=cand.src,
                ext=ext,
                body=body,
                width=w,
                height=h,
                area=area,
                match_rank=cand.match_rank,
            )
            if best is None:
                best = item
            else:
                best_key = (best.match_rank, best.area, len(best.body))
                cur_key = (item.match_rank, item.area, len(item.body))
                if cur_key > best_key:
                    best = item
            if quality_ok(w, h, len(body)) and (cand.match_rank > 0 or area >= 30000):
                accepted = item
                break

        chosen = accepted or best
        if not chosen:
            failed.append(f"{rid}: no downloadable candidate image")
            continue

        row.pop("diagramPng", None)
        row.pop("diagramSvg", None)
        out_file = DIAGRAMS_DIR / f"{pid}{chosen.ext}"
        out_file.write_bytes(chosen.body)
        rel_path = f"assets/diagrams/{pid}{chosen.ext}"
        if chosen.ext == ".svg":
            row["diagramSvg"] = rel_path
        else:
            row["diagramPng"] = rel_path
        patched += 1

    AIME_JSON.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")

    print(f"scanned={scanned} patched={patched} skipped={skipped} failed={len(failed)}")
    if failed:
        print("failures:")
        for msg in failed[:80]:
            print(" -", msg)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill missing AIME diagrams from AoPS.")
    parser.add_argument(
        "--all-missing",
        action="store_true",
        help="Target all missing AMIO AIME rows (default only rows with explicit figure/image cues).",
    )
    parser.add_argument(
        "--repair-existing",
        action="store_true",
        help="Re-fetch and replace existing diagram entries for targeted rows.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    backfill(all_missing=args.all_missing, repair_existing=args.repair_existing)
