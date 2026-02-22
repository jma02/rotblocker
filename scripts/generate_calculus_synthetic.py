#!/usr/bin/env python3
"""
Generate a high-quality synthetic Calculus MCQ dataset (precalculus -> Calc III)
with MathJax-friendly formatting and deterministic answers.
"""

from __future__ import annotations

import argparse
import json
import random
from fractions import Fraction
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "calculus_mcq_synthetic.json"
DEFAULT_REPORT = ROOT / "data" / "calculus_mcq_synthetic_report.json"
DATASET_NAME = "synthetic_calculus_v3"


def frac_to_tex(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return f"\\frac{{{value.numerator}}}{{{value.denominator}}}"


def pretty_num(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return f"${frac_to_tex(value)}$"


def fmt_term(coef: int, var: str, power: int = 1, first: bool = False) -> str:
    if coef == 0:
        return ""
    sign = "-" if coef < 0 else "+"
    mag = abs(coef)
    if power == 0:
        body = str(mag)
    elif power == 1:
        body = f"{'' if mag == 1 else mag}{var}"
    else:
        body = f"{'' if mag == 1 else mag}{var}^{power}"
    if first:
        return body if coef > 0 else f"-{body}"
    return f"{sign}{body}"


def fmt_poly(terms: list[tuple[int, str, int]]) -> str:
    out = ""
    first_used = False
    for coef, var, power in terms:
        if coef == 0:
            continue
        out += fmt_term(coef, var, power, first=not first_used)
        first_used = True
    return out or "0"


def fmt_x_minus(value: int) -> str:
    if value >= 0:
        return f"x-{value}"
    return f"x+{abs(value)}"


def unique_choices(correct: Fraction, pool: list[Fraction]) -> list[Fraction]:
    out: list[Fraction] = []
    seen = {correct}
    for p in pool:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
        if len(out) == 4:
            break
    if len(out) < 4:
        k = 1
        while len(out) < 4:
            cand = correct + Fraction(k, 1)
            k += 1
            if cand in seen:
                continue
            seen.add(cand)
            out.append(cand)
    return out


def make_mcq(
    *,
    pid: str,
    topic: str,
    prompt: str,
    correct: Fraction,
    distractor_pool: list[Fraction],
    rng: random.Random,
) -> dict:
    distractors = unique_choices(correct, distractor_pool)
    all_vals = distractors + [correct]
    rng.shuffle(all_vals)
    answer_index = all_vals.index(correct)
    choices = [pretty_num(v) for v in all_vals]
    return {
        "id": pid,
        "type": "mcq",
        "contest": "calculus",
        "label": "Synthetic Calculus MCQ",
        "topic": topic,
        "weight": 5,
        "prompt": prompt,
        "choices": choices,
        "answerIndex": answer_index,
        "answerKey": "ABCDE"[answer_index],
        "answer": choices[answer_index],
        "source": {
            "dataset": DATASET_NAME,
            "generator": "scripts/generate_calculus_synthetic.py",
            "topic": topic,
        },
    }


def make_text_mcq(
    *,
    pid: str,
    topic: str,
    prompt: str,
    choices: list[str],
    answer_index: int,
    rng: random.Random,
) -> dict:
    if len(choices) != 5:
        raise ValueError("text MCQ must have exactly 5 choices")
    ordered = list(choices)
    correct = ordered[answer_index]
    rng.shuffle(ordered)
    answer_index = ordered.index(correct)
    return {
        "id": pid,
        "type": "mcq",
        "contest": "calculus",
        "label": "Synthetic Calculus MCQ",
        "topic": topic,
        "weight": 5,
        "prompt": prompt,
        "choices": ordered,
        "answerIndex": answer_index,
        "answerKey": "ABCDE"[answer_index],
        "answer": ordered[answer_index],
        "source": {
            "dataset": DATASET_NAME,
            "generator": "scripts/generate_calculus_synthetic.py",
            "topic": topic,
        },
    }


def normalize_for_key(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def row_dedupe_key(row: dict) -> str:
    prompt = normalize_for_key(row.get("prompt", ""))
    topic = normalize_for_key(row.get("topic", ""))
    choices = [normalize_for_key(c) for c in row.get("choices", [])]
    choice_sig = "|".join(sorted(choices))
    return f"{topic}::{prompt}::{choice_sig}"


def svg_escape(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def make_plot_svg(points: list[tuple[float, float]], title: str) -> str:
    width, height = 520, 280
    margin = 24
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    x_span = max(1e-6, x_max - x_min)
    y_span = max(1e-6, y_max - y_min)
    x_pad = 0.08 * x_span
    y_pad = 0.15 * y_span
    x0, x1 = x_min - x_pad, x_max + x_pad
    y0, y1 = y_min - y_pad, y_max + y_pad

    def sx(xv: float) -> float:
        return margin + (xv - x0) * (width - 2 * margin) / (x1 - x0)

    def sy(yv: float) -> float:
        return height - margin - (yv - y0) * (height - 2 * margin) / (y1 - y0)

    axis_x = sy(0.0)
    axis_y = sx(0.0)
    axis_x = max(margin, min(height - margin, axis_x))
    axis_y = max(margin, min(width - margin, axis_y))

    poly = " ".join(f"{sx(px):.2f},{sy(py):.2f}" for px, py in points)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="{svg_escape(title)}">'
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>'
        f'<line x1="{margin}" y1="{axis_x:.2f}" x2="{width-margin}" y2="{axis_x:.2f}" '
        f'stroke="#7f7f7f" stroke-width="1"/>'
        f'<line x1="{axis_y:.2f}" y1="{margin}" x2="{axis_y:.2f}" y2="{height-margin}" '
        f'stroke="#7f7f7f" stroke-width="1"/>'
        f'<polyline points="{poly}" fill="none" stroke="#1f4f95" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
        f'<text x="{margin}" y="{margin-6}" font-size="12" fill="#444">{svg_escape(title)}</text>'
        '</svg>'
    )


def gen_poly_derivative(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5])
    b = rng.choice([-5, -3, -2, -1, 1, 2, 3, 4])
    c = rng.choice([-6, -4, -2, -1, 1, 2, 3, 5, 6])
    d = rng.choice([-5, -2, -1, 0, 1, 2, 4, 7])
    x0 = rng.choice([-3, -2, -1, 0, 1, 2, 3])
    ans = Fraction(3 * a * x0 * x0 + 2 * b * x0 + c, 1)
    pool = [
        Fraction(3 * a * x0 * x0 + b * x0 + c, 1),
        Fraction(3 * a * x0 * x0 + 2 * b * x0 - c, 1),
        ans + 1,
        ans - 1,
        ans + 2,
        ans - 2,
    ]
    poly = fmt_poly([(a, "x", 3), (b, "x", 2), (c, "x", 1), (d, "", 0)])
    prompt = f"For $f(x)={poly}$, what is $f'({x0})$?"
    return make_mcq(
        pid=f"calcv2-deriv-poly-{idx}",
        topic="derivatives",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_limit_factor(idx: int, rng: random.Random) -> dict:
    a = rng.choice([x for x in range(-20, 21) if x != 0])
    ans = Fraction(2 * a, 1)
    factor = fmt_x_minus(a)
    prompt = f"Evaluate $\\lim_{{x\\to {a}}}\\frac{{x^2-{a*a}}}{{{factor}}}$."
    pool = [Fraction(a, 1), Fraction(a * a, 1), ans + 1, ans - 1, -ans, ans + 2]
    return make_mcq(
        pid=f"calcv2-limit-factor-{idx}",
        topic="limits",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_limit_trig(idx: int, rng: random.Random) -> dict:
    k = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 18, 20, 24, 25, 30])
    ans = Fraction(k, 1)
    prompt = f"Evaluate $\\lim_{{x\\to 0}}\\frac{{\\sin({k}x)}}{{x}}$."
    pool = [Fraction(1, k), Fraction(k * k, 1), Fraction(k - 1, 1), Fraction(k + 1, 1), -ans]
    return make_mcq(
        pid=f"calcv2-limit-trig-{idx}",
        topic="limits",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_def_integral_linear(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5, -1, -2, -3])
    b = rng.choice([-6, -4, -2, -1, 0, 1, 2, 3, 5, 6])
    m = rng.choice([-2, -1, 0, 1, 2])
    n = rng.choice([3, 4, 5, 6])
    ans = Fraction(a * (n * n - m * m), 2) + Fraction(b * (n - m), 1)
    integrand = fmt_poly([(a, "x", 1), (b, "", 0)])
    prompt = f"Compute $\\int_{{{m}}}^{{{n}}}({integrand})\\,dx$."
    pool = [ans + 1, ans - 1, ans + 2, ans - 2, Fraction(a * (n - m), 1)]
    return make_mcq(
        pid=f"calcv2-int-linear-{idx}",
        topic="integration",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_def_integral_quad(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    b = rng.choice([-4, -2, -1, 1, 2, 3, 5])
    c = rng.choice([-6, -3, -1, 0, 1, 2, 4])
    m = rng.choice([0, 1])
    n = rng.choice([2, 3, 4])
    ans = Fraction(a * (n**3 - m**3), 3) + Fraction(b * (n * n - m * m), 2) + Fraction(c * (n - m), 1)
    integrand = fmt_poly([(a, "x", 2), (b, "x", 1), (c, "", 0)])
    prompt = f"Compute $\\int_{{{m}}}^{{{n}}}({integrand})\\,dx$."
    pool = [ans + 1, ans - 1, ans + 3, ans - 3, Fraction((n - m) * (a + b + c), 1)]
    return make_mcq(
        pid=f"calcv2-int-quad-{idx}",
        topic="integration",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_def_integral_trig(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5, 6])
    b = rng.choice([-4, -3, -2, -1, 1, 2, 3, 4])
    ans = Fraction(2 * a, 1)
    trig = join_terms([mul_term(a, "\\sin x"), mul_term(b, "\\cos x")])
    prompt = f"Compute $\\int_0^\\pi ({trig})\\,dx$."
    pool = [Fraction(0, 1), Fraction(a, 1), Fraction(2 * b, 1), ans + 1, ans - 1]
    return make_mcq(
        pid=f"calcv2-int-trig-{idx}",
        topic="integration",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_def_integral_abs(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5, 6, 8, 10])
    ans = Fraction(a * a, 1)
    prompt = f"Compute $\\int_{{-{a}}}^{{{a}}} |x|\\,dx$."
    pool = [Fraction(2 * a, 1), Fraction(a * a // 2, 1), Fraction(2 * a * a, 1), ans + 1, ans - 1]
    return make_mcq(
        pid=f"calcv2-int-abs-{idx}",
        topic="integration",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def join_terms(terms: list[str]) -> str:
    out = ""
    for t in terms:
        if not t:
            continue
        if not out:
            out = t
            continue
        if t.startswith("-"):
            out += t
        else:
            out += f"+{t}"
    return out or "0"


def mul_term(coef: int, body: str) -> str:
    if coef == 0:
        return ""
    if coef == 1:
        return body
    if coef == -1:
        return f"-{body}"
    return f"{coef}{body}"


def gen_indef_integral_poly(idx: int, rng: random.Random) -> dict:
    a = rng.choice([-9, -6, -3, 3, 6, 9])
    b = rng.choice([-8, -6, -4, -2, 2, 4, 6, 8])
    c = rng.choice([-7, -5, -3, -1, 1, 2, 3, 5, 7])
    integrand = fmt_poly([(a, "x", 2), (b, "x", 1), (c, "", 0)])
    true_expr = join_terms(
        [
            mul_term(a // 3, "x^3"),
            mul_term(b // 2, "x^2"),
            mul_term(c, "x"),
            "C",
        ]
    )
    choices = [
        f"${true_expr}$",
        f"${join_terms([mul_term(a, 'x^3'), mul_term(b, 'x^2'), mul_term(c, 'x'), 'C'])}$",
        f"${join_terms([mul_term(a // 3, 'x^3'), mul_term(b, 'x^2'), mul_term(c, 'x'), 'C'])}$",
        f"${join_terms([mul_term(a // 3, 'x^3'), mul_term(b // 2, 'x^2'), mul_term(-c, 'x'), 'C'])}$",
        f"${join_terms([mul_term(a // 3, 'x^3'), mul_term(b // 2, 'x^2'), mul_term(c, 'x^2'), 'C'])}$",
    ]
    prompt = f"Which expression is an antiderivative of $f(x)={integrand}$?"
    return make_text_mcq(
        pid=f"calcv2-int-indef-poly-{idx}",
        topic="integration",
        prompt=prompt,
        choices=choices,
        answer_index=0,
        rng=rng,
    )


def gen_indef_integral_trig(idx: int, rng: random.Random) -> dict:
    m = rng.choice([1, 2, 3, 4, 5, 6])
    t = rng.choice([1, 2, 3, 4])
    a = rng.choice([-1, 1]) * m * t
    b = rng.choice([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5])
    trig_part = join_terms([mul_term(a, f"\\sin({m}x)"), mul_term(b, "\\sec^2(x)")])
    true_expr = join_terms([mul_term(-(a // m), f"\\cos({m}x)"), mul_term(b, "\\tan(x)"), "C"])
    wrong_1 = join_terms([mul_term(a // m, f"\\cos({m}x)"), mul_term(b, "\\tan(x)"), "C"])
    wrong_2 = join_terms([mul_term(-(a // m), f"\\sin({m}x)"), mul_term(b, "\\tan(x)"), "C"])
    wrong_3 = join_terms([mul_term(-(a // m), f"\\cos({m}x)"), mul_term(-b, "\\tan(x)"), "C"])
    wrong_4 = join_terms([mul_term(-(a // m), f"\\cos({m}x)"), mul_term(b, "\\sec^2(x)"), "C"])
    prompt = f"Which expression is an antiderivative of $f(x)={trig_part}$?"
    return make_text_mcq(
        pid=f"calcv2-int-indef-trig-{idx}",
        topic="integration",
        prompt=prompt,
        choices=[f"${true_expr}$", f"${wrong_1}$", f"${wrong_2}$", f"${wrong_3}$", f"${wrong_4}$"],
        answer_index=0,
        rng=rng,
    )


def gen_opt_rectangle(idx: int, rng: random.Random) -> dict:
    p = rng.choice(list(range(20, 102, 2)))
    # A=xy with 2x+2y=p => max at x=y=p/4 => area=p^2/16
    ans = Fraction(p * p, 16)
    prompt = (
        f"A rectangle has perimeter {p}. What is the maximum possible area?"
    )
    pool = [Fraction(p * p, 20), Fraction(p * p, 12), ans + 2, ans - 2, Fraction(p * p, 8)]
    return make_mcq(
        pid=f"calcv2-opt-rect-{idx}",
        topic="optimization",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_opt_fixed_area(idx: int, rng: random.Random) -> dict:
    n = rng.choice(list(range(3, 31)))
    area = n * n
    ans = Fraction(4 * n, 1)
    prompt = (
        f"Among all rectangles of area {area}, what is the minimum possible perimeter?"
    )
    pool = [Fraction(2 * n, 1), Fraction(8 * n, 1), ans + 2, ans - 2, Fraction(area, 2)]
    return make_mcq(
        pid=f"calcv2-opt-area-{idx}",
        topic="optimization",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_opt_open_box(idx: int, rng: random.Random) -> dict:
    side = rng.choice(list(range(12, 126, 6)))
    # Maximize V=x(s-2x)^2 on (0, s/2): x=s/6
    ans = Fraction(side, 6)
    prompt = (
        f"A square sheet with side length {side} is used to make an open-top box by cutting "
        f"equal squares of side length $x$ from each corner and folding. What value of $x$ "
        f"maximizes volume?"
    )
    pool = [Fraction(side, 8), Fraction(side, 4), Fraction(side, 3), ans + 1, ans - 1]
    return make_mcq(
        pid=f"calcv2-opt-box-{idx}",
        topic="optimization",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_partial_derivative(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    b = rng.choice([-3, -2, -1, 1, 2, 3])
    x0 = rng.choice([-2, -1, 0, 1, 2, 3])
    y0 = rng.choice([-2, -1, 0, 1, 2, 3])
    # f = a x^2 y + b y^3
    ans = Fraction(2 * a * x0 * y0, 1)
    y_term = f"{'' if a == 1 else a}x^2y"
    y3 = fmt_term(b, "y", 3, first=False)
    prompt = f"If $f(x,y)={y_term}{y3}$, find $\\frac{{\\partial f}}{{\\partial x}}({x0},{y0})$."
    pool = [
        Fraction(a * x0 * x0 + 3 * b * y0 * y0, 1),
        Fraction(2 * a * x0, 1),
        ans + 1,
        ans - 1,
        -ans,
    ]
    return make_mcq(
        pid=f"calcv2-partial-x-{idx}",
        topic="multivariable",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_gradient_norm_sq(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    b = rng.choice([1, 2, 3, 4])
    x0 = rng.choice([1, 2, 3, -1, -2])
    y0 = rng.choice([1, 2, 3, -1, -2])
    gx = 2 * a * x0
    gy = 2 * b * y0
    ans = Fraction(gx * gx + gy * gy, 1)
    prompt = (
        f"For $f(x,y)={a}x^2+{b}y^2$, find $\\|\\nabla f({x0},{y0})\\|^2$."
    )
    pool = [Fraction(gx * gx + gy, 1), Fraction(abs(gx) + abs(gy), 1), ans + 4, ans - 4, Fraction(gx * gx - gy * gy, 1)]
    return make_mcq(
        pid=f"calcv2-gradnorm-{idx}",
        topic="multivariable",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_double_integral(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    b = rng.choice([1, 2, 3, 4])
    c = rng.choice([-2, -1, 0, 1, 2, 3])
    m = rng.choice([0, 1])
    n = rng.choice([2, 3])
    p = rng.choice([0, 1])
    q = rng.choice([2, 3])
    # ∫∫ (a x + b y + c) dy dx on [m,n]x[p,q]
    x_span = n - m
    y_span = q - p
    x_term = Fraction(a * (n * n - m * m), 2) * y_span
    y_term = Fraction(b * (q * q - p * p), 2) * x_span
    c_term = Fraction(c * x_span * y_span, 1)
    ans = x_term + y_term + c_term
    integrand = f"{fmt_term(a, 'x', 1, first=True)}{fmt_term(b, 'y', 1)}{fmt_term(c, '', 0)}"
    prompt = f"Compute $\\int_{{{m}}}^{{{n}}}\\int_{{{p}}}^{{{q}}}({integrand})\\,dy\\,dx$."
    pool = [ans + 1, ans - 1, ans + 3, ans - 3, Fraction(x_span * y_span * (a + b + c), 1)]
    return make_mcq(
        pid=f"calcv2-doubleint-{idx}",
        topic="multivariable",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_series_geo(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5])
    r_num = rng.choice([1, 2, 3, 4])
    r_den = rng.choice([5, 6, 7, 8, 9, 10])
    r = Fraction(r_num, r_den)
    ans = Fraction(a, 1) / (1 - r)
    prompt = f"Find the sum of the infinite geometric series $\\sum_{{n=0}}^\\infty {a}\\left(\\frac{{{r_num}}}{{{r_den}}}\\right)^n$."
    pool = [Fraction(a, 1) * (1 - r), Fraction(a, 1) / r, ans + 1, ans - 1, Fraction(a * r_num, r_den - r_num)]
    return make_mcq(
        pid=f"calcv2-series-geo-{idx}",
        topic="series",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_limit_sqrt(idx: int, rng: random.Random) -> dict:
    a = rng.choice([n * n for n in range(1, 19)])
    root = int(a**0.5)
    ans = Fraction(1, 2 * root)
    prompt = f"Evaluate $\\lim_{{x\\to {a}}}\\frac{{\\sqrt{{x}}-{root}}}{{x-{a}}}$."
    pool = [Fraction(1, root), Fraction(1, 4 * root), ans + Fraction(1, 10), ans - Fraction(1, 10), Fraction(root, 2)]
    return make_mcq(
        pid=f"calcv2-limit-sqrt-{idx}",
        topic="limits",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_limit_exp(idx: int, rng: random.Random) -> dict:
    k = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 18, 20, 24, 25, 30])
    ans = Fraction(k, 1)
    prompt = f"Evaluate $\\lim_{{x\\to 0}}\\frac{{e^{{{k}x}}-1}}{{x}}$."
    pool = [Fraction(1, k), Fraction(k * k, 1), Fraction(k - 1, 1), Fraction(k + 1, 1), -ans]
    return make_mcq(
        pid=f"calcv2-limit-exp-{idx}",
        topic="limits",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_ps_series(idx: int, rng: random.Random) -> dict:
    p = rng.choice([2, 3, 4, 5, 6])
    # sum 1/n^p converges for p>1
    ans = Fraction(1, 1)
    prompt = f"Does the series $\\sum_{{n=1}}^\\infty \\frac{{1}}{{n^{p}}}$ converge? (Use 1 for yes, 0 for no.)"
    pool = [Fraction(0, 1), Fraction(2, 1), Fraction(-1, 1), Fraction(3, 1), Fraction(4, 1)]
    return make_mcq(
        pid=f"calcv2-pseries-{idx}",
        topic="series",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_chain_rule(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    t = rng.choice([0, 1, 2, 3])  # multiples of pi/2
    phase_map = {0: "0", 1: "\\pi/2", 2: "\\pi", 3: "3\\pi/2"}
    b_expr = phase_map[t]
    val = t % 4
    cosv = [1, 0, -1, 0][val]
    ans = Fraction(a * cosv, 1)
    inner = f"{'' if a == 1 else a}x"
    if b_expr != "0":
        inner = f"{inner}+{b_expr}"
    prompt = f"If $f(x)=\\sin({inner})$, what is $f'(0)$?"
    pool = [Fraction(-a * cosv, 1), Fraction(a, 1), Fraction(-a, 1), ans + 1, ans - 1]
    return make_mcq(
        pid=f"calcv2-chain-{idx}",
        topic="derivatives",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_divergence(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5])
    b = rng.choice([1, 2, 3, 4, 5])
    c = rng.choice([1, 2, 3, 4, 5])
    ans = Fraction(a + b + c, 1)
    prompt = f"For $\\mathbf{{F}}(x,y,z)=({'' if a == 1 else a}x,{'' if b == 1 else b}y,{'' if c == 1 else c}z)$, compute $\\nabla\\cdot\\mathbf{{F}}$."
    pool = [Fraction(a * b * c, 1), Fraction(a + b - c, 1), ans + 1, ans - 1, Fraction(a * a + b * b + c * c, 1)]
    return make_mcq(
        pid=f"calcv2-div-{idx}",
        topic="vector_calculus",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_green_theorem_rect(idx: int, rng: random.Random) -> dict:
    u = rng.choice([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5])
    v = rng.choice([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5])
    a = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    b = rng.choice([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    ans = Fraction((v - u) * a * b, 1)
    p_term = fmt_term(u, "y", 1, first=True)
    q_term = fmt_term(v, "x", 1, first=True)
    prompt = (
        f"Let $C$ be the positively oriented boundary of the rectangle "
        f"$0\\le x\\le {a},\\,0\\le y\\le {b}$. Compute "
        f"$\\oint_C ({p_term})\\,dx+({q_term})\\,dy$."
    )
    pool = [
        Fraction((u - v) * a * b, 1),
        Fraction((u + v) * a * b, 1),
        Fraction((v - u) * (a + b), 1),
        ans + 2,
        ans - 2,
    ]
    return make_mcq(
        pid=f"calcv2-green-{idx}",
        topic="vector_calculus",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_stokes_scaled(idx: int, rng: random.Random) -> dict:
    m = rng.choice([1, 2, 3, 4, 5, 6])
    n = rng.choice([1, 2, 3, 4, 5, 6])
    r = rng.choice([1, 2, 3, 4, 5, 6, 8, 10])
    # F = (-my, nx, 0), C = x^2+y^2=r^2 ccw => integral = (m+n)pi r^2
    ans = Fraction((m + n) * r * r, 1)
    prompt = (
        f"Let $C$ be the circle $x^2+y^2={r*r}$ oriented counterclockwise. For "
        f"$\\mathbf{{F}}(x,y,z)=(-{m}y,{n}x,0)$, compute "
        f"$\\frac{{1}}{{\\pi}}\\oint_C \\mathbf{{F}}\\cdot d\\mathbf{{r}}$."
    )
    pool = [
        Fraction((n - m) * r * r, 1),
        Fraction((m + n) * r, 1),
        Fraction((m + n), 1),
        ans + 1,
        ans - 1,
    ]
    return make_mcq(
        pid=f"calcv2-stokes-{idx}",
        topic="vector_calculus",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_div_theorem_box(idx: int, rng: random.Random) -> dict:
    p = rng.choice([1, 2, 3, 4, 5])
    q = rng.choice([1, 2, 3, 4, 5])
    r = rng.choice([1, 2, 3, 4, 5])
    a = rng.choice([1, 2, 3, 4, 5, 6])
    b = rng.choice([1, 2, 3, 4, 5, 6])
    c = rng.choice([1, 2, 3, 4, 5, 6])
    ans = Fraction((p + q + r) * a * b * c, 1)
    fx = f"{'' if p == 1 else p}x"
    fy = f"{'' if q == 1 else q}y"
    fz = f"{'' if r == 1 else r}z"
    prompt = (
        f"Compute the outward flux of $\\mathbf{{F}}(x,y,z)=({fx},{fy},{fz})$ through "
        f"the box $0\\le x\\le {a},\\,0\\le y\\le {b},\\,0\\le z\\le {c}$."
    )
    pool = [
        Fraction((p + q + r) * (a + b + c), 1),
        Fraction((p * q * r) * a * b * c, 1),
        Fraction((p + q - r) * a * b * c, 1),
        ans + 2,
        ans - 2,
    ]
    return make_mcq(
        pid=f"calcv2-divthm-{idx}",
        topic="vector_calculus",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_continuity_piecewise(idx: int, rng: random.Random) -> dict:
    a = rng.choice([x for x in range(-24, 25) if x != 0])
    ans = Fraction(2 * a, 1)
    factor = fmt_x_minus(a)
    prompt = (
        f"Define $f(x)=\\frac{{x^2-{a*a}}}{{{factor}}}$ for $x\\ne {a}$ and $f({a})=k$. "
        f"What value of $k$ makes $f$ continuous at $x={a}$?"
    )
    pool = [Fraction(a, 1), Fraction(-2 * a, 1), ans + 1, ans - 1, Fraction(a * a, 1)]
    return make_mcq(
        pid=f"calcv2-cont-piece-{idx}",
        topic="continuity_graphing",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_continuity_count_discont(idx: int, rng: random.Random) -> dict:
    a = rng.choice([x for x in range(-10, 11) if x != 0])
    b_choices = [x for x in range(-10, 11) if x not in {a, 0}]
    b = rng.choice(b_choices)
    c_choices = [x for x in range(-10, 11) if x not in {a, b, 0}]
    c = rng.choice(c_choices)
    ans = Fraction(2, 1)
    fa = fmt_x_minus(a)
    fb = fmt_x_minus(b)
    fc = fmt_x_minus(c)
    prompt = (
        f"How many discontinuities does "
        f"$f(x)=\\frac{{({fa})({fb})}}{{({fa})({fc})}}$ have on $\\mathbb{{R}}$?"
    )
    pool = [Fraction(0, 1), Fraction(1, 1), Fraction(3, 1), Fraction(4, 1), Fraction(5, 1)]
    return make_mcq(
        pid=f"calcv2-cont-count-{idx}",
        topic="continuity_graphing",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_graph_vertex_x(idx: int, rng: random.Random) -> dict:
    a = rng.choice([x for x in range(-8, 9) if x not in {-1, 0, 1}])
    b = rng.choice([x for x in range(-20, 21) if x != 0])
    c = rng.choice([x for x in range(-12, 13)])
    ans = Fraction(-b, 2 * a)
    quad = fmt_poly([(a, "x", 2), (b, "x", 1), (c, "", 0)])
    prompt = f"For $y={quad}$, what is the $x$-coordinate of the vertex?"
    pool = [Fraction(-b, a), Fraction(b, 2 * a), ans + Fraction(1, 2), ans - Fraction(1, 2), Fraction(-c, a)]
    return make_mcq(
        pid=f"calcv2-graph-vertex-{idx}",
        topic="continuity_graphing",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_graph_abs_nondiff(idx: int, rng: random.Random) -> dict:
    a = rng.choice([x for x in range(-20, 0)])
    b = rng.choice([x for x in range(1, 21)])
    ans = Fraction(2, 1)
    fa = fmt_x_minus(a)
    fb = fmt_x_minus(b)
    prompt = (
        f"How many points of nondifferentiability does "
        f"$f(x)=|{fa}|+|{fb}|$ have?"
    )
    pool = [Fraction(0, 1), Fraction(1, 1), Fraction(3, 1), Fraction(4, 1), Fraction(5, 1)]
    return make_mcq(
        pid=f"calcv2-graph-abs-{idx}",
        topic="continuity_graphing",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_graph_critical_count(idx: int, rng: random.Random) -> dict:
    k = rng.choice([0, 1, 2, 3, 4, 5, 6, 7, 8])
    d = rng.choice([x for x in range(-15, 16)])
    ans = Fraction(1 if k == 0 else 2, 1)
    prompt = f"How many critical points does $f(x)=x^3-3({k})x+{d}$ have?"
    pool = [Fraction(0, 1), Fraction(1, 1), Fraction(2, 1), Fraction(3, 1), Fraction(4, 1)]
    return make_mcq(
        pid=f"calcv2-graph-critical-{idx}",
        topic="continuity_graphing",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_parametric_dydx(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    b = rng.choice([1, 2, 3, 4, 5])
    t0 = rng.choice([1, 2, 3, 4])
    # x=t^2 + b, y=a t^3 -> dy/dx = (3a t^2)/(2t)=3a t/2
    ans = Fraction(3 * a * t0, 2)
    prompt = f"If $x=t^2+{b}$ and $y={a}t^3$, find $\\frac{{dy}}{{dx}}$ at $t={t0}$."
    pool = [Fraction(3 * a * t0 * t0, 1), Fraction(2 * t0, 1), ans + 1, ans - 1, Fraction(3 * a, 2)]
    return make_mcq(
        pid=f"calcv2-param-dydx-{idx}",
        topic="parametric",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_tangent_plane(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4])
    b = rng.choice([1, 2, 3, 4])
    x0 = rng.choice([1, 2, -1, -2])
    y0 = rng.choice([1, 2, -1, -2])
    z0 = a * x0 * x0 + b * y0 * y0
    # z = z0 + 2a x0 (x-x0) + 2b y0 (y-y0)
    # ask for coefficient of x in expanded plane:
    coef_x = Fraction(2 * a * x0, 1)
    surface = f"{fmt_term(a, 'x', 2, first=True)}{fmt_term(b, 'y', 2)}"
    prompt = (
        f"For $z={surface}$, the tangent plane at $({x0},{y0},{z0})$ has form "
        f"$z=\\alpha x+\\beta y+\\gamma$. What is $\\alpha$?"
    )
    pool = [Fraction(2 * b * y0, 1), Fraction(a * x0, 1), coef_x + 1, coef_x - 1, Fraction(-2 * a * x0, 1)]
    return make_mcq(
        pid=f"calcv2-tangent-plane-{idx}",
        topic="multivariable",
        prompt=prompt,
        correct=coef_x,
        distractor_pool=pool,
        rng=rng,
    )


def gen_log_derivative(idx: int, rng: random.Random) -> dict:
    a = rng.choice([1, 2, 3, 4, 5, 6])
    b = rng.choice([1, 2, 3, 4, 5, 6])
    x0 = rng.choice([1, 2, 3, 4])
    ans = Fraction(a, a * x0 + b)
    inner = fmt_poly([(a, "x", 1), (b, "", 0)])
    prompt = f"If $f(x)=\\ln({inner})$, compute $f'({x0})$."
    pool = [Fraction(1, a * x0 + b), Fraction(a * x0 + b, a), ans + Fraction(1, 10), ans - Fraction(1, 10), Fraction(a, 1)]
    return make_mcq(
        pid=f"calcv2-deriv-log-{idx}",
        topic="derivatives",
        prompt=prompt,
        correct=ans,
        distractor_pool=pool,
        rng=rng,
    )


def gen_plot_parabola_fact(idx: int, rng: random.Random) -> dict:
    h = rng.choice([-4, -3, -2, -1, 0, 1, 2, 3, 4])
    k = rng.choice([1, 2, 3, 4, 5])
    xs = [h + Fraction(i, 2) for i in range(-10, 11)]
    points = [(float(x), float((x - h) * (x - h) + k)) for x in xs]
    title = f"Plot of f(x) = (x-{h})^2 + {k}"
    prompt = "Based on the plotted graph, which statement is true?"
    choices = [
        f"$f({h})={k}$, $f'({h})=0$, and $f$ has a local minimum at $x={h}$.",
        f"$f$ is decreasing on $({h},\\infty)$.",
        "$f''(x)<0$ for all real $x$.",
        "$f$ has exactly two $x$-intercepts.",
        f"$f({h}+1)<f({h})$.",
    ]
    row = make_text_mcq(
        pid=f"calcv2-plot-parabola-{idx}",
        topic="plot_interpretation",
        prompt=prompt,
        choices=choices,
        answer_index=0,
        rng=rng,
    )
    row["_diagramSvgName"] = f"calcv3-plot-parabola-{idx}.svg"
    row["_diagramSvgContent"] = make_plot_svg(points, title)
    row["source"]["diagram"] = "generated_svg"
    return row


def gen_plot_odd_fact(idx: int, rng: random.Random) -> dict:
    left = rng.choice([-4, -3, -2])
    right = -left
    high = rng.choice([3, 4, 5, 6])
    low = rng.choice([1, 2, 3])
    if low >= high:
        low = high - 1
    inner = rng.choice([1, 2])
    points = [
        (float(left), float(high)),
        (float(-inner), float(low)),
        (0.0, 0.0),
        (float(inner), float(-low)),
        (float(right), float(-high)),
    ]
    title = "Odd-symmetric piecewise linear plot"
    prompt = "Based on the plotted graph, which statement must be true?"
    choices = [
        f"$f$ is odd, so $\\int_{{{left}}}^{{{right}}} f(x)\\,dx = 0$.",
        "$f$ is even.",
        f"$f({inner})={low}$.",
        f"$f({-inner})={-low}$.",
        f"$f$ is increasing on $[{left},{right}]$.",
    ]
    row = make_text_mcq(
        pid=f"calcv2-plot-odd-{idx}",
        topic="plot_interpretation",
        prompt=prompt,
        choices=choices,
        answer_index=0,
        rng=rng,
    )
    row["_diagramSvgName"] = f"calcv3-plot-odd-{idx}.svg"
    row["_diagramSvgContent"] = make_plot_svg(points, title)
    row["source"]["diagram"] = "generated_svg"
    return row


TEMPLATES: list[tuple[str, Callable[[int, random.Random], dict]]] = [
    ("derivatives", gen_poly_derivative),
    ("derivatives", gen_log_derivative),
    ("derivatives", gen_chain_rule),
    ("limits", gen_limit_factor),
    ("limits", gen_limit_trig),
    ("limits", gen_limit_sqrt),
    ("limits", gen_limit_exp),
    ("integration", gen_def_integral_linear),
    ("integration", gen_def_integral_quad),
    ("integration", gen_def_integral_trig),
    ("integration", gen_def_integral_abs),
    ("integration", gen_indef_integral_poly),
    ("integration", gen_indef_integral_trig),
    ("optimization", gen_opt_rectangle),
    ("optimization", gen_opt_fixed_area),
    ("optimization", gen_opt_open_box),
    ("multivariable", gen_partial_derivative),
    ("multivariable", gen_gradient_norm_sq),
    ("multivariable", gen_double_integral),
    ("multivariable", gen_tangent_plane),
    ("series", gen_series_geo),
    ("series", gen_ps_series),
    ("vector_calculus", gen_divergence),
    ("vector_calculus", gen_green_theorem_rect),
    ("vector_calculus", gen_stokes_scaled),
    ("vector_calculus", gen_div_theorem_box),
    ("parametric", gen_parametric_dydx),
    ("continuity_graphing", gen_continuity_piecewise),
    ("continuity_graphing", gen_continuity_count_discont),
    ("continuity_graphing", gen_graph_vertex_x),
    ("continuity_graphing", gen_graph_abs_nondiff),
    ("continuity_graphing", gen_graph_critical_count),
    ("plot_interpretation", gen_plot_parabola_fact),
    ("plot_interpretation", gen_plot_odd_fact),
]


def build_dataset(total: int, seed: int) -> tuple[list[dict], dict]:
    rng = random.Random(seed)
    rows: list[dict] = []
    topic_counts: dict[str, int] = {}
    template_usage: dict[str, int] = {}
    seen_prompts: set[str] = set()
    templates_by_topic: dict[str, list[Callable[[int, random.Random], dict]]] = {}
    for topic, fn in TEMPLATES:
        templates_by_topic.setdefault(topic, []).append(fn)

    topic_order = [
        ("derivatives", 40),
        ("limits", 38),
        ("integration", 70),
        ("optimization", 28),
        ("multivariable", 46),
        ("series", 24),
        ("parametric", 18),
        ("vector_calculus", 24),
        ("continuity_graphing", 26),
        ("plot_interpretation", 36),
    ]
    base_quota = sum(count for _, count in topic_order)
    scale = total / base_quota
    quotas = {topic: max(1, round(count * scale)) for topic, count in topic_order}
    while sum(quotas.values()) < total:
        for topic, _ in topic_order:
            quotas[topic] += 1
            if sum(quotas.values()) == total:
                break
    while sum(quotas.values()) > total:
        for topic, _ in reversed(topic_order):
            if quotas[topic] > 1:
                quotas[topic] -= 1
            if sum(quotas.values()) == total:
                break

    attempts = 0
    global_index = 0
    for topic, _ in topic_order:
        needed = quotas[topic]
        target_needed = needed
        template_fns = templates_by_topic.get(topic, [])
        local_attempts = 0
        while needed > 0 and local_attempts < target_needed * 80:
            local_attempts += 1
            attempts += 1
            global_index += 1
            fn = rng.choice(template_fns)
            row = fn(global_index, rng)
            key = row_dedupe_key(row)
            if key in seen_prompts:
                continue
            seen_prompts.add(key)
            row["id"] = f"calcv2-{topic}-{len(rows) + 1:04d}"
            rows.append(row)
            needed -= 1
            topic_counts[topic] = topic_counts.get(topic, 0) + 1
            template_usage[fn.__name__] = template_usage.get(fn.__name__, 0) + 1

    # Backfill if any quota underfilled due dedup collisions.
    backfill_attempts = 0
    while len(rows) < total and backfill_attempts < total * 120:
        backfill_attempts += 1
        attempts += 1
        global_index += 1
        topic, fn = rng.choice(TEMPLATES)
        row = fn(global_index, rng)
        key = row_dedupe_key(row)
        if key in seen_prompts:
            continue
        seen_prompts.add(key)
        row["id"] = f"calcv2-{topic}-{len(rows) + 1:04d}"
        rows.append(row)
        topic_counts[topic] = topic_counts.get(topic, 0) + 1
        template_usage[fn.__name__] = template_usage.get(fn.__name__, 0) + 1

    # Basic structural guardrail.
    for row in rows:
        assert row["type"] == "mcq"
        assert len(row["choices"]) == 5
        assert 0 <= int(row["answerIndex"]) < 5
        assert row["answer"] == row["choices"][row["answerIndex"]]

    report = {
        "dataset": DATASET_NAME,
        "count": len(rows),
        "seed": seed,
        "attempts": attempts,
        "requested_total": total,
        "target_quotas": quotas,
        "topic_counts": topic_counts,
        "template_usage": template_usage,
    }
    return rows, report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate synthetic calculus MCQ dataset.")
    parser.add_argument("--count", type=int, default=320, help="Number of MCQs to generate.")
    parser.add_argument("--seed", type=int, default=20260221, help="Random seed.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Output JSON path.")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="Report JSON path.")
    return parser.parse_args()


def persist_generated_plot_svgs(rows: list[dict]) -> int:
    diagram_dir = ROOT / "assets" / "diagrams"
    diagram_dir.mkdir(parents=True, exist_ok=True)
    for stale in diagram_dir.glob("calcv3-plot-*.svg"):
        stale.unlink()

    written = 0
    for row in rows:
        name = row.pop("_diagramSvgName", None)
        svg = row.pop("_diagramSvgContent", None)
        if not name or not svg:
            continue
        path = diagram_dir / name
        path.write_text(str(svg), encoding="utf-8")
        row["diagramSvg"] = f"assets/diagrams/{name}"
        written += 1
    return written


def main() -> None:
    args = parse_args()
    rows, report = build_dataset(total=max(50, int(args.count)), seed=int(args.seed))
    report["diagram_svg_count"] = persist_generated_plot_svgs(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.out} ({len(rows)} rows)")
    print(f"Wrote {args.report}")


if __name__ == "__main__":
    main()
