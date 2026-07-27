#!/usr/bin/env python3
"""Normalize and audit RotBlock++ problem-bank JSON files.

The importer sources are noisy and historically used several different TeX
conventions.  This module intentionally limits automatic edits to mechanical,
meaning-preserving transformations.  Content that cannot be repaired without
guessing is reported for review instead.
"""

from __future__ import annotations

import argparse
import difflib
import html
import json
import re
import struct
import subprocess
import sys
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = (
    "aime.json",
    "amc8.json",
    "amc10.json",
    "amc12.json",
    "calculus_mcq.json",
    "calculus_mcq_synthetic.json",
    "upper_level_mcq.json",
)
DEFAULT_REPORT = ROOT / "data" / "problem_cleanup_report.json"
BASELINE_REF = "8f5ceb3151b2975ff591a5c277ff2981ef477947"

UNESCAPED_DOLLAR_RE = re.compile(r"(?<!\\)\$")
CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
HTML_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
HTML_ENTITY_RE = re.compile(r"&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);", re.I)
MOJIBAKE_RE = re.compile(r"(?:\ufffd|Ã.|Â.|â[\x80-\xbf]|ð[\x80-\xbf])")
MARKER_RE = re.compile(r"\[(?:/?asy|/?mathjax|/?tex)\]", re.I)
MEDIA_FILENAME_RE = re.compile(r"\.(?:png|jpe?g|gif|svg)\b", re.I)
BARE_COMMAND_RE = re.compile(
    r"^(?:[+-]\s*)?(?:d?frac|tfrac|sqrt|pi|overline|mbox|texttt|textrm)"
    r"(?![A-Za-z])"
)
TRUNCATED_PROMPT_RE = re.compile(
    r"\bfor which\s+find\b|"
    r"\band where\b|"
    r"\blet\s+what\b|"
    r"\bthat\s+what\b|"
    r"\bsatisfy\s+if\b|"
    r"\bwe write\s+to denote\b|"
    r"\bexpansions\s+find\b|"
    r"\bfollowing properties\?\s*$|"
    r"\brules:\s*(?:what|how|which)\b|"
    r",\s*find\s*$|"
    r"\bfor each real number\b[^.]{0,24}\bif\b|"
    r"\bgraphs of the equations are drawn\b",
    re.I,
)
TRAILING_TEX_SPACE_RE = re.compile(
    r"(?:\s*(?:\\qquad|\\quad|\\[,;:!]|\\\\))+\s*$"
)

# These source rows are demonstrably truncated or corrupted.  The patches are
# deliberately small and keyed by the stable AMIO source id.
APPEND_CLOSING_PAREN_IDS = {
    "amio-33a3110a13b7b1100384be28275b57ff",
    "amio-03ba8fa9f71721051b46a01a8e620a94",
    "amio-bba59d30fd76667bf71c9a33bb8984e8",
    "amio-bdf9142ed2bed6d886b651ccb048f0f3",
    "amio-2bf214fa5caab8d392ad5010cbc10947",
    "amio-df8dfcf765351f3b14a535dd7e4ce771",
    "amio-e6740a52784f53941e2b4f75a1f3d80d",
}

OFFICIAL_AMC12B_2023_Q7_ID = "amio-536444f8c922ff0dba205bd5e4ccbfd6"
OFFICIAL_AMC12B_2012_Q12_ID = "amio-9958192892d058ab3cbc1ba71c827ac6"
OFFICIAL_AMC12A_2016_Q16_ID = "amio-b4d0972c5fb5351b74e4648e973fe3a0"
OFFICIAL_AMC8_2023_Q24_ID = "amio-c9614b6913980d73802c6d63b24149b8"
GRE_BOOTCAMP_ROUTES_ID = "upper-gre-grebootcamp-s10-q5-bbfd600b"
GRE_PRACTICE_EXPONENT_TOWER_ID = "upper-gre-grepractice-s-q48-8157c15f"
SPECULATIVE_CALENDAR_CROP_ID = "amio-43b2c056b96a9474e34431445277d923"
VERIFIED_AMC8_CHOICE_OVERRIDES = {
    "amio-b9979cb9613ec70e0886881b00e6a7ab": (4, "5"),
    "amio-fe18aad6e52038198dd0f9c9c01eecef": (4, "32"),
}
HEARTSUIT_IDS = {
    "amio-f165dff76f703f9f670719f6b7b07e15",
    "amio-a96f0e383b0940adee69c346f646b968",
}

STAMP_COLLECTION_CONTEXT = (
    "Juan organizes the stamps in his collection by country and by the "
    "decade in which they were issued. The prices he paid for them at a "
    "stamp shop were: Brazil and France, 6 cents each; Peru, 4 cents each; "
    "and Spain, 5 cents each. (Brazil and Peru are South American countries, "
    "and France and Spain are in Europe.)"
)

VERIFIED_EXACT_PROMPT_OVERRIDES = {
    "amio-39fb0975b13cbe4ced5436758447f72b": (
        r"How many three-digit positive integers $N$ satisfy the following "
        r"properties? (1) The number $N$ is divisible by $7$. (2) The "
        r"number formed by reversing the digits of $N$ is divisible by $5$."
    ),
    "amio-61fda9fb244c94efa274c5e045298e33": (
        "Rohan keeps a total of 90 guppies in 4 fish tanks. There is 1 more "
        "guppy in the 2nd tank than in the 1st tank. There are 2 more "
        "guppies in the 3rd tank than in the 2nd tank. There are 3 more "
        "guppies in the 4th tank than in the 3rd tank. How many guppies are "
        "in the 4th tank?"
    ),
    "amio-e5e922acf502a1832f6b4f6693da6149": (
        r"Let $x=-2016$. What is the value of "
        r"$\Bigg\vert\Big\vert |x|-x\Big\vert-|x|\Bigg\vert-x$?"
    ),
    "amio-ee1bdfcb98da5de80d3a873baafff3e2": (
        r"The first two terms of a sequence are $a_1=1$ and "
        r"$a_2=\frac{1}{\sqrt{3}}$. For $n\ge1$, "
        r"\[a_{n+2}=\frac{a_n+a_{n+1}}{1-a_na_{n+1}}.\] "
        r"What is $|a_{2009}|$?"
    ),
    "amio-97ed9915cbef9ad8c9136dfb53ee58c0": (
        r"A $3 \times 7$ rectangle is covered without overlap by 3 shapes of "
        r"tiles: $2 \times 2$, $1 \times 4$, and $1 \times 1$, shown below. "
        r"What is the minimum possible number of $1 \times 1$ tiles used?"
    ),
    "amio-18167852ccabbc147d57d50df08cd523": (
        r"Four congruent semicircles are drawn on the surface of a sphere "
        r"with radius $2$, as shown, creating a closed curve that divides "
        r"the surface into two congruent regions. The length of the curve "
        r"is $\pi\sqrt{n}$. What is $n$?"
    ),
}

# Narrow source-backed prose/table repairs keyed by stable row id.  These are
# intentionally not global substitutions because the source context matters.
VERIFIED_PROMPT_TEXT_REPLACEMENTS = {
    "amio-f9dc3f3febf32227dd066d9b170c1a61": (
        ("figure below(not drawn to scale).The", "figure below (not drawn to scale). The"),
    ),
    "amio-faaccf9259bff468d99045641db8964e": (
        (r"\end{array}$,what digit", r"\end{array}$, what digit"),
    ),
    "amio-bbc8b2bcbd811466824eda4c94d2dc46": (
        ("Ms.Osborne", "Ms. Osborne"),
    ),
    "amio-3d6ba4a9134cc345e3a668e2330c196f": (
        ("two,or", "two, or"),
    ),
    "amio-1f2ac522535b2962aa2bd710cbc6deca": (
        (r"$n = 5$.What", r"$n = 5$. What"),
    ),
    "amio-a5a8575f3dcbbd1f65efff33b50a99a0": (
        ("nickels,dimes", "nickels, dimes"),
    ),
    "amio-aae24b862004e67889b97a440c22bf3c": (
        ("parallelpiped", "parallelepiped"),
    ),
    "amio-e343bfd5714a46552e0923858c2dfa43": (
        ("non- empty", "nonempty"),
    ),
    "amio-df037de97863e546885f43ef348f2a44": (
        ("Everyday at school", "Every day at school"),
    ),
    "amio-5d77f13b2b5103309b57cf5acd9c9aac": (
        ("and the the ratio", "and the ratio"),
    ),
    "amio-c16fb0e4349ade90096f16df1c945f10": (
        ("if the the area", "if the area"),
    ),
    "amio-24bfde7529dba29c74dc7996166640d3": (
        (r"In triangle $\triangle ABC$", r"In $\triangle ABC$"),
    ),
    "amio-1a673bc4502d9757d0f7da2139cd1735": (
        (r"\cdot \cdot \cdot", r"\cdots"),
    ),
    "amio-f94ac51df8f5609c071ea4cd49f11383": (
        (r"\cdot \cdot \cdot", r"\cdots"),
    ),
    "amio-fe18aad6e52038198dd0f9c9c01eecef": (
        (r"$3$ $3$ grid", r"$3\times3$ grid"),
    ),
    "amio-cc9aabc25427c0c0552a8f98f73225b7": (
        (r"$2$ $1$", r"$2:1$"),
    ),
    "amio-77ab84124f7ac8447faf4ec39cd1263b": (
        (r"$2$ $1$", r"$2:1$"),
    ),
    "amio-dde422fbadb4f280cf5e468b4f04503a": (
        (
            r"$AB$ $3$ $BC$ $1$, and $CG$ $2$",
            r"$AB=3$, $BC=1$, and $CG=2$",
        ),
    ),
    "amio-eb6d596d52e16acd21af1873447a45e9": (
        (r"for each $2\le$ $i$ $\le10$", r"for each $2\le i\le10$"),
    ),
    "amio-f4aac60acb95fc0044277fe50e45d791": (
        (r"with $a\ge$ $b\ge$ $c$", r"with $a\ge b\ge c$"),
    ),
    "amio-7f7ffaeb5358384574e1d713e6c4f944": (
        (r"with $a\ge$ $b\ge$ $c$", r"with $a\ge b\ge c$"),
    ),
    "amio-b6b6184a11a773b6050d5be3bce67e9f": (
        (
            "rules: A sample transformation",
            (
                "rules: (1) Any filled square with two or three filled "
                "neighbors remains filled. (2) Any empty square with exactly "
                "three filled neighbors becomes a filled square. (3) All "
                "other squares remain empty or become empty. A sample "
                "transformation"
            ),
        ),
    ),
    "amio-59984d65302fc4acc4f8d116285323ad": (
        (
            "rules: A sample transformation",
            (
                "rules: (1) Any filled square with two or three filled "
                "neighbors remains filled. (2) Any empty square with exactly "
                "three filled neighbors becomes a filled square. (3) All "
                "other squares remain empty or become empty. A sample "
                "transformation"
            ),
        ),
    ),
    "amio-9adc7bd7514a005d92b2dd14a4cfc668": (
        (
            "properties: The roots",
            (
                r"properties: (1) $P(x)$ has leading coefficient $1$. "
                r"(2) $1$ is a root of $P(x)-1$. (3) $2$ is a root of "
                r"$P(x-2)$. (4) $3$ is a root of $P(3x)$. (5) $4$ is a "
                r"root of $4P(x)$. The roots"
            ),
        ),
    ),
    "amio-879f415f2f62a1f9bfc66e7c11c75113": (
        (
            r"0 \le j \le 4 \text\\ f(i-1,1)",
            r"0 \le j \le 4 \text{,}\\ f(i-1,1)",
        ),
    ),
    "amio-6256aaadc589c33014adb0886fe821c0": (
        (r"$\text 111111111$", r"$111{,}111{,}111$"),
    ),
    "amio-4c6b64f3497b40b5afa6131eadff127c": (
        (
            (
                r"Given a positive integer $n$, it can be shown that every "
                r"complex number of the form $r+si$, where $r$ and $s$ are "
                r"integers, can be uniquely expressed in the base $-n+i$ "
                r"using the integers $0,1,2,\ldots,n^2$ as digits. That is, "
                r"the equation is true for a unique choice of non-negative "
                r"integer $m$ and digits $a_0,a_1,\ldots,a_m$ chosen from "
                r"the set $\{0,1,2,\ldots,n^2\}$, with $a_m\ne 0$. We write "
                r"to denote the base $-n+i$ expansion of $r+si$. There are "
                r"only finitely many integers $k+0i$ that have four-digit "
                r"expansions Find the sum of all such $k$"
            ),
            (
                r"Given a positive integer $n$, it can be shown that every "
                r"complex number of the form $r+si$, where $r$ and $s$ are "
                r"integers, can be uniquely expressed in the base $-n+i$ "
                r"using the integers $0,1,2,\ldots,n^2$ as digits. That is, "
                r"the equation "
                r"\[r+si=a_m(-n+i)^m+a_{m-1}(-n+i)^{m-1}+\cdots+"
                r"a_1(-n+i)+a_0\] is true for a unique choice of "
                r"nonnegative integer $m$ and digits "
                r"$a_0,a_1,\ldots,a_m$ chosen from "
                r"$\{0,1,2,\ldots,n^2\}$, with $a_m\ne0$. We write "
                r"\[r+si=(a_ma_{m-1}\ldots a_1a_0)_{-n+i}\] to denote the "
                r"base $-n+i$ expansion of $r+si$. There are only finitely "
                r"many integers $k+0i$ that have four-digit expansions "
                r"\[k=(a_3a_2a_1a_0)_{-3+i},\quad a_3\ne0.\] Find the sum "
                r"of all such $k$."
            ),
        ),
    ),
    "amio-8c8e542a115aa4a20e4f922070bf2ade": (
        (
            (
                r"Let $S$ be the set of points in the Cartesian plane that "
                r"satisfy If a model of $S$ were built from wire of "
                r"negligible thickness, then the total length of wire "
                r"required would be $a\sqrt{b}$, where $a$ and $b$ are "
                r"positive integers and $b$ is not divisible by the square "
                r"of any prime number. Find $a+b$"
            ),
            (
                r"Let $S$ be the set of points $(x,y)$ in the Cartesian "
                r"plane that satisfy "
                r"\[\Big|\big||x|-2\big|-1\Big|+"
                r"\Big|\big||y|-2\big|-1\Big|=1.\] If a model of $S$ were "
                r"built from wire of negligible thickness, then the total "
                r"length of wire required would be $a\sqrt{b}$, where $a$ "
                r"and $b$ are positive integers and $b$ is not divisible "
                r"by the square of any prime number. Find $a+b$."
            ),
        ),
    ),
    "amio-16dffb75f3e15c4823f6db7d163398ed": (
        (
            "table: How many",
            f"table: {STAMP_COLLECTION_CONTEXT} How many",
        ),
    ),
    "amio-ac1a24b9bcb728d734f04b1193e5266d": (
        (
            "table: In dollars",
            f"table: {STAMP_COLLECTION_CONTEXT} In dollars",
        ),
    ),
    "amio-f7aac714a9a971d023b425e78fb13b4e": (
        (
            "table: The average",
            f"table: {STAMP_COLLECTION_CONTEXT} The average",
        ),
    ),
    "amio-b11d9737add2b2a76fccb1d2a11e1b83": (
        (
            (
                r"$\circ$ Trisha's cookies are triangles: How many cookies "
                r"will be in one batch of Trisha's cookies?"
            ),
            (
                r"$\circ$ Trisha's cookies are triangles: Each friend uses "
                r"the same amount of dough, and Art makes exactly $12$ "
                r"cookies. How many cookies will be in one batch of "
                r"Trisha's cookies?"
            ),
        ),
    ),
    "amio-c721f665706b36c0258ef42fc731085e": (
        (
            (
                r"For every integer $n\ge2$, let $\text{pow}(n)$ be the "
                r"largest power of the largest prime that divides $n$. For "
                r"example $\text{pow}(144)=\text{pow}(2^4\cdot3^2)=3^2$. "
                r"What is the largest integer $m$ such that $2010^m$ divides"
            ),
            (
                r"For every integer $n\ge2$, let $\operatorname{pow}(n)$ be "
                r"the largest power of the largest prime that divides $n$. "
                r"For example, "
                r"$\operatorname{pow}(144)=\operatorname{pow}"
                r"(2^4\cdot3^2)=3^2$. What is the largest integer $m$ such "
                r"that $2010^m$ divides "
                r"\[\prod_{n=2}^{5300}\operatorname{pow}(n)\]?"
            ),
        ),
        (
            r"\[\prod_{n=2}^{5300}\operatorname{pow}(n)?\]",
            r"\[\prod_{n=2}^{5300}\operatorname{pow}(n)\]?",
        ),
    ),
    "amio-2ee242ba369a1d8d1bd942a67d943d40": (
        (
            (
                r"The number $2013$ is expressed in the form where "
                r"$a_1 \ge a_2 \ge \cdots \ge a_m$ and "
                r"$b_1 \ge b_2 \ge \cdots \ge b_n$ are positive integers "
                r"and $a_1 + b_1$ is as small as possible. What is "
                r"$|a_1 - b_1|$"
            ),
            (
                r"The number $2013$ is expressed in the form "
                r"\[2013=\frac{a_1!a_2!\cdots a_m!}"
                r"{b_1!b_2!\cdots b_n!},\] where "
                r"$a_1\ge a_2\ge\cdots\ge a_m$ and "
                r"$b_1\ge b_2\ge\cdots\ge b_n$ are positive integers and "
                r"$a_1+b_1$ is as small as possible. What is "
                r"$|a_1-b_1|$?"
            ),
        ),
    ),
    "amio-f947d416ed5e04489c729d7003bd1fe9": (
        (
            (
                r"The number $2013$ is expressed in the form where "
                r"$a_1 \ge a_2 \ge \cdots \ge a_m$ and "
                r"$b_1 \ge b_2 \ge \cdots \ge b_n$ are positive integers "
                r"and $a_1 + b_1$ is as small as possible. What is "
                r"$|a_1 - b_1|$"
            ),
            (
                r"The number $2013$ is expressed in the form "
                r"\[2013=\frac{a_1!a_2!\cdots a_m!}"
                r"{b_1!b_2!\cdots b_n!},\] where "
                r"$a_1\ge a_2\ge\cdots\ge a_m$ and "
                r"$b_1\ge b_2\ge\cdots\ge b_n$ are positive integers and "
                r"$a_1+b_1$ is as small as possible. What is "
                r"$|a_1-b_1|$?"
            ),
        ),
    ),
    "amio-1e3194e2a14646b1527d7ad5c16b0c36": (
        (
            (
                r"Let $p(x) = x^3 + ax^2 + bx + c$, where $a$ $b$, and $c$ "
                r"are complex numbers. Suppose that What is the number of "
                r"nonreal zeros of $x^{12} + ax^8 + bx^4 + c$"
            ),
            (
                r"Let $p(x)=x^3+ax^2+bx+c$, where $a$, $b$, and $c$ are "
                r"complex numbers. Suppose that "
                r"\[p(2009+9002\pi i)=p(2009)=p(9002)=0.\] What is the "
                r"number of nonreal zeros of $x^{12}+ax^8+bx^4+c$?"
            ),
        ),
    ),
    "amio-8c77a574f062843a158f36f3a1da1bc1": (
        (
            (
                r"Let $a > 0$, and let $P(x)$ be a polynomial with integer "
                r"coefficients such that What is the smallest possible "
                r"value of $a$"
            ),
            (
                r"Let $a>0$, and let $P(x)$ be a polynomial with integer "
                r"coefficients such that "
                r"\[P(1)=P(3)=P(5)=P(7)=a,\qquad "
                r"P(2)=P(4)=P(6)=P(8)=-a.\] What is the smallest possible "
                r"value of $a$?"
            ),
        ),
    ),
    "amio-c72e2b9d9977d5a7f4a539abec54ce32": (
        (
            (
                r"Let $a > 0$, and let $P(x)$ be a polynomial with integer "
                r"coefficients such that What is the smallest possible "
                r"value of $a$"
            ),
            (
                r"Let $a>0$, and let $P(x)$ be a polynomial with integer "
                r"coefficients such that "
                r"\[P(1)=P(3)=P(5)=P(7)=a,\qquad "
                r"P(2)=P(4)=P(6)=P(8)=-a.\] What is the smallest possible "
                r"value of $a$?"
            ),
        ),
    ),
    "amio-d9ba9b1ca08bee47e026577ce5441eee": (
        (
            (
                r"Positive integers $a,b,$ and $c$ are chosen so that "
                r"$a<b<c$, and the system of equations has exactly one "
                r"solution. What is the minimum value of $c$"
            ),
            (
                r"Positive integers $a$, $b$, and $c$ are chosen so that "
                r"$a<b<c$, and the system of equations "
                r"\[2x+y=2003,\qquad "
                r"y=|x-a|+|x-b|+|x-c|\] has exactly one solution. What is "
                r"the minimum value of $c$?"
            ),
        ),
    ),
    "amio-9594b8df76721b6e2c4911f9677f956a": (
        (
            (
                r"The numbers $-2, 4, 6, 9$ and $12$ are rearranged "
                r"according to these rules: What is the average of the "
                r"first and last numbers?"
            ),
            (
                r"The numbers $-2$, $4$, $6$, $9$, and $12$ are rearranged "
                r"according to these rules: (1) The largest isn't first, "
                r"but it is in one of the first three places. (2) The "
                r"smallest isn't last, but it is in one of the last three "
                r"places. (3) The median isn't first or last. What is the "
                r"average of the first and last numbers?"
            ),
        ),
    ),
    "amio-c9ec465de29de52b45f7994d4a2aafea": (
        (
            (
                r"The function $f$ has the property that, for each real "
                r"number $x,\,$ If $f(19)=94,\,$ what is the remainder when "
                r"$f(94)\,$ is divided by $1000$"
            ),
            (
                r"The function $f$ has the property that, for each real "
                r"number $x$, \[f(x)+f(x-1)=x^2.\] If $f(19)=94$, what is "
                r"the remainder when $f(94)$ is divided by $1000$?"
            ),
        ),
    ),
    "amio-309ab70ab52a2b4424874abcc6cabbae": (
        (
            (
                r"Given that $(1+\sin t)(1+\cos t)=5/4$ and where $k, m,$ "
                r"and $n$ are positive integers with $m$ and $n$ relatively "
                r"prime, find $k+m+n.$"
            ),
            (
                r"Given that $(1+\sin t)(1+\cos t)=\frac{5}{4}$ and "
                r"$(1-\sin t)(1-\cos t)=\frac{m}{n}-\sqrt{k}$, where $k$, "
                r"$m$, and $n$ are positive integers with $m$ and $n$ "
                r"relatively prime, find $k+m+n$."
            ),
        ),
    ),
    "amio-067f0b089095b4b384e3d0f791979204": (
        (
            (
                r"Given a positive integer $n\,$, let $p(n)\,$ be the "
                r"product of the non-zero digits of $n\,$. (If $n\,$ has "
                r"only one digits, then $p(n)\,$ is equal to that digit.) "
                r"Let What is the largest prime factor of $S\,$"
            ),
            (
                r"Given a positive integer $n$, let $p(n)$ be the product "
                r"of the nonzero digits of $n$. (If $n$ has only one digit, "
                r"then $p(n)$ is equal to that digit.) Let "
                r"\[S=p(1)+p(2)+p(3)+\cdots+p(999).\] What is the largest "
                r"prime factor of $S$?"
            ),
        ),
    ),
    "amio-e04415018886b333e8fcfca30ac133d1": (
        (
            (
                r"For certain ordered pairs $(a,b)\,$ of real numbers, the "
                r"system of equations has at least one solution, and each "
                r"solution is an ordered pair $(x,y)\,$ of integers. How "
                r"many such ordered pairs $(a,b)\,$ are there?"
            ),
            (
                r"For certain ordered pairs $(a,b)$ of real numbers, the "
                r"system of equations "
                r"\[\begin{aligned} ax+by&=1,\\x^2+y^2&=50. "
                r"\end{aligned}\] has at least one solution, and each "
                r"solution is an ordered pair $(x,y)$ of integers. How many "
                r"such ordered pairs $(a,b)$ are there?"
            ),
        ),
    ),
    "amio-53e112d374764867391a4f889396fd50": (
        (
            (
                r"The table below displays some of the results of last "
                r"summer's Frostbite Falls Fishing Festival, showing how "
                r"many contestants caught $n\,$ fish for various values of "
                r"$n\,$ In the newspaper story covering the event, it was "
                r"reported that What was the total number of fish caught "
                r"during the festival?"
            ),
            (
                r"The table below displays some of the results of last "
                r"summer's Frostbite Falls Fishing Festival, showing how "
                r"many contestants caught $n$ fish for various values of "
                r"$n$. In the newspaper story covering the event, it was "
                r"reported that (a) the winner caught 15 fish; (b) those "
                r"who caught 3 or more fish averaged 6 fish each; and (c) "
                r"those who caught 12 or fewer fish averaged 5 fish each. "
                r"What was the total number of fish caught during the "
                r"festival?"
            ),
        ),
    ),
    "amio-9a5a6f1fd4069ff884ee2830fa74b6f3": (
        (
            (
                r"The graphs of the equations are drawn in the coordinate "
                r"plane for $k=-10,-9,-8,\ldots,9,10.\,$ These 63 lines "
                r"cut part of the plane into equilateral triangles of side "
                r"length $\tfrac{2}{\sqrt{3}}.\,$ How many such triangles "
                r"are formed?"
            ),
            (
                r"The graphs of the equations "
                r"\[y=k,\qquad y=\sqrt{3}x+2k,\qquad "
                r"y=-\sqrt{3}x+2k\] are drawn in the coordinate plane for "
                r"$k=-10,-9,-8,\ldots,9,10$. These 63 lines cut part of "
                r"the plane into equilateral triangles of side length "
                r"$\frac{2}{\sqrt{3}}$. How many such triangles are formed?"
            ),
        ),
    ),
    "amio-94a53012c117cd9385ccb0c2aa4462cf": (
        (
            (
                r"Suppose $r$ is a real number for which Find "
                r"$\lfloor 100r \rfloor$. (For real $x$ "
                r"$\lfloor x \rfloor$ is the greatest integer less than or "
                r"equal to $x$.)"
            ),
            (
                r"Suppose $r$ is a real number for which "
                r"\[\left\lfloor r+\frac{19}{100}\right\rfloor+"
                r"\left\lfloor r+\frac{20}{100}\right\rfloor+\cdots+"
                r"\left\lfloor r+\frac{91}{100}\right\rfloor=546.\] "
                r"Find $\lfloor 100r\rfloor$. (For real $x$, "
                r"$\lfloor x\rfloor$ is the greatest integer less than or "
                r"equal to $x$.)"
            ),
        ),
    ),
    "amio-f16156f4fc4a548c40cca2f804e2694d": (
        (
            (
                r"Let $a$ $b$ $c$ be the three sides of a triangle, and let "
                r"$\alpha$ $\beta$ $\gamma$, be the angles opposite them. "
                r"If $a^2+b^2=1989c^2$, find"
            ),
            (
                r"Let $a$, $b$, and $c$ be the three sides of a triangle, "
                r"and let $\alpha$, $\beta$, and $\gamma$ be the angles "
                r"opposite them. If $a^2+b^2=1989c^2$, find "
                r"$\frac{\cot\gamma}{\cot\alpha+\cot\beta}$."
            ),
        ),
    ),
    "amio-9cfe3f60cd374c069df86eeb8babeea7": (
        (
            (
                r"Let $P$ be the parabola with equation $y=x^2$ and let "
                r"$Q = (20, 14)$. There are real numbers $r$ and $s$ such "
                r"that the line through $Q$ with slope $m$ does not "
                r"intersect $P$ if and only if $r$ $m$ $s$. What is $r + s$"
            ),
            (
                r"Let $P$ be the parabola with equation $y=x^2$ and let "
                r"$Q=(20,14)$. There are real numbers $r$ and $s$ such that "
                r"the line through $Q$ with slope $m$ does not intersect "
                r"$P$ if and only if $r<m<s$. What is $r+s$?"
            ),
        ),
    ),
    "amio-07d8f9f7da5174c54967b0b422387f38": (
        (
            "For how many positive integers $n$ does $1+2+...+n$ evenly "
            "divide from $6n$",
            r"For how many positive integers $n$ does "
            r"$1+2+\cdots+n$ evenly divide $6n$?",
        ),
    ),
    "amio-7c7b929da1ffdf4c179ef4c871d0f923": (
        ("Supposed that", "Suppose that"),
    ),
    "amio-8c02d125f106b5362bcd85e8fa82402f": (
        ("Supposed that", "Suppose that"),
    ),
    "amio-77fb83402afdf5d51537d2f43b0ce047": (
        ("8-digital display", "8-digit display"),
    ),
    "amio-38abd2523b95190be4c0c2feed7a2263": (
        ("8-digital display", "8-digit display"),
    ),
    "amio-258d68f46e74a6bc473986f937210798": (
        ("first quartle", "first quartile"),
    ),
    "amio-0c007fa9bf834dab5df14f5c176f6993": (
        ("lists this items", "lists the following items"),
    ),
    "amio-174456a04e1d0467eee87d396dfc3d26": (
        ("lists this items", "lists the following items"),
    ),
    "amio-43b0bf5b758b18c9b631f7261691be8b": (
        ("radiostation", "radio station"),
        (
            "& Listen & Don't Listen & Total",
            r"& \text{Listen} & \text{Don't Listen} & \text{Total}",
        ),
        (r"\hline Males &", r"\hline \text{Males} &"),
        (r"\hline Females &", r"\hline \text{Females} &"),
        (r"\hline Total &", r"\hline \text{Total} &"),
    ),
    "amio-7c7d03eba309acae3722263567dc3012": (
        (" Tree 1 &", r" \text{Tree 1} &"),
        (" Tree 2 &", r" \text{Tree 2} &"),
        (" Tree 3 &", r" \text{Tree 3} &"),
        (" Tree 4 &", r" \text{Tree 4} &"),
        (" Tree 5 &", r" \text{Tree 5} &"),
        (
            r"\underline{\phantom{00}} meters",
            r"\underline{\phantom{00}}\ \text{meters}",
        ),
        ("11 meters", r"11\ \text{meters}"),
        (" Average height &", r" \text{Average height} &"),
        (r"\text{.}2 meters", r"\text{.}2\ \text{meters}"),
    ),
    "amio-ae139542a200cb4687c817e01bcfe7bf": (
        (" Player & Result", r" \text{Player} & \text{Result}"),
        (" Lola &", r" \text{Lola} &"),
        (" Lolo &", r" \text{Lolo} &"),
        (" Tiya &", r" \text{Tiya} &"),
        (" Tiyo &", r" \text{Tiyo} &"),
    ),
}

# Every retained GREBootcamp row is mapped to the section heading in the
# bundled Problems PDF.  This disambiguates the repeated question numbers that
# the legacy importer incorrectly folded into Problem Set #10.
GRE_BOOTCAMP_SECTION_BY_ID = {
    "upper-gre-grebootcamp-s10-q1-56947df0": "multivariable_calculus",
    "upper-gre-grebootcamp-s10-q1-f4824339": "real_analysis",
    "upper-gre-grebootcamp-s10-q10-546b239d": "combinatorics",
    "upper-gre-grebootcamp-s10-q2-0a75d49b": "linear_algebra_1",
    "upper-gre-grebootcamp-s10-q2-266e319c": "problem_set_10",
    "upper-gre-grebootcamp-s10-q4-5f32abbf": "number_theory",
    "upper-gre-grebootcamp-s10-q4-b776a88b": "linear_algebra_2",
    "upper-gre-grebootcamp-s10-q4-c6c5b4c5": "differential_equations",
    "upper-gre-grebootcamp-s10-q5-3c37ef6a": "topology",
    "upper-gre-grebootcamp-s10-q5-47905f84": "differential_equations",
    GRE_BOOTCAMP_ROUTES_ID: "combinatorics",
    "upper-gre-grebootcamp-s10-q6-5a2656bb": "problem_set_10",
    "upper-gre-grebootcamp-s10-q6-ca16f83b": "number_theory",
    "upper-gre-grebootcamp-s10-q6-e4d6fb77": "topology",
    "upper-gre-grebootcamp-s10-q7-a7170d3a": "topology",
    "upper-gre-grebootcamp-s10-q7-c3572295": "number_theory",
    "upper-gre-grebootcamp-s2-q3-7236172b": "problem_set_2",
    "upper-gre-grebootcamp-s2-q4-f0ab66fc": "problem_set_2",
    "upper-gre-grebootcamp-s2-q5-8ffdf5eb": "problem_set_2",
    "upper-gre-grebootcamp-s2-q7-3fd7f086": "problem_set_2",
    "upper-gre-grebootcamp-s3-q3-ef6fa1bd": "problem_set_3",
    "upper-gre-grebootcamp-s4-q1-6e79f657": "problem_set_4",
    "upper-gre-grebootcamp-s4-q2-067e0b63": "problem_set_4",
    "upper-gre-grebootcamp-s4-q6-11cb1cd1": "problem_set_4",
    "upper-gre-grebootcamp-s5-q6-298ef97e": "problem_set_5",
    "upper-gre-grebootcamp-s6-q5-1b0db2d5": "problem_set_6",
    "upper-gre-grebootcamp-s7-q2-8b400f7b": "problem_set_7",
    "upper-gre-grebootcamp-s7-q4-00981d19": "problem_set_7",
    "upper-gre-grebootcamp-s7-q5-f223691f": "problem_set_7",
    "upper-gre-grebootcamp-s8-q5-6e10e3ba": "problem_set_8",
    "upper-gre-grebootcamp-s8-q9-23824afc": "problem_set_8",
    "upper-gre-grebootcamp-s9-q1-db6efd4d": "problem_set_9",
    "upper-gre-grebootcamp-s9-q2-c8601747": "problem_set_9",
}

# Source-image transcription repairs plus answer corrections from the matching
# Solutions section.  The three unkeyed sections are independently verified:
# the plane derivative is 1/5; the linear ODE gives e^(y/x)=cx; and variation
# of parameters gives the t^3 e^t / 6 particular solution.  Problem Set #9
# question 1 corrects an error in the printed solution key: its Hessian is
# indefinite, so the origin is a saddle.
GRE_BOOTCAMP_ROW_OVERRIDES = {
    "upper-gre-grebootcamp-s10-q1-56947df0": {
        "answerIndex": 2,
    },
    "upper-gre-grebootcamp-s10-q1-f4824339": {
        "answerIndex": 3,
    },
    "upper-gre-grebootcamp-s10-q2-0a75d49b": {
        "choices": ["1", "2", r"$n-2$", r"$n-1$", r"$n$"],
        "answerIndex": 1,
    },
    "upper-gre-grebootcamp-s10-q2-266e319c": {
        "prompt": (
            r"Let $A$ be a real $2\times2$ matrix. Which of the following "
            r"statements must be true? (I) All entries of $A^2$ are "
            r"nonnegative. (II) The determinant of $A^2$ is nonnegative. "
            r"(III) If $A$ has two distinct eigenvalues, then $A^2$ has two "
            r"distinct eigenvalues."
        ),
        "answerIndex": 3,
    },
    "upper-gre-grebootcamp-s10-q4-5f32abbf": {
        "answerIndex": 3,
    },
    "upper-gre-grebootcamp-s10-q4-c6c5b4c5": {
        "prompt": (
            r"Find the general solution of the differential equation "
            r"$\frac{dy}{dx}=\frac{x+y}{x}$."
        ),
    },
    "upper-gre-grebootcamp-s10-q5-47905f84": {
        "choices": [
            r"$C_1e^t+C_2t^2e^t$",
            r"$C_1e^t+C_2te^t$",
            r"$C_1e^t+C_2te^t+\frac{1}{6}t^3e^t$",
            r"$C_1e^t+C_2te^t+\frac{t}{2}e^t$",
            r"$C_1e^t+C_2te^t+\frac{t^2}{2}e^t$",
        ],
        "answerIndex": 2,
    },
    "upper-gre-grebootcamp-s10-q6-5a2656bb": {
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
    "upper-gre-grebootcamp-s10-q6-ca16f83b": {
        "answerIndex": 2,
    },
    "upper-gre-grebootcamp-s10-q7-a7170d3a": {
        "answerIndex": 2,
    },
    "upper-gre-grebootcamp-s10-q7-c3572295": {
        "answerIndex": 3,
    },
    "upper-gre-grebootcamp-s2-q3-7236172b": {
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
    "upper-gre-grebootcamp-s2-q5-8ffdf5eb": {
        "prompt": (
            r"Which of the following exist? (I) "
            r"$f_1:[0,1]\to(0,1)$ continuous and surjective. (II) "
            r"$f_2:(0,1)\to[0,1]$ continuous and surjective. (III) "
            r"$f_3:(0,1)\to[0,1]$ continuous and bijective."
        ),
    },
    "upper-gre-grebootcamp-s4-q2-067e0b63": {
        "choices": [
            r"$-\frac{\sin t}{e^t}$",
            r"$\frac{\cos t-e^t\sin t}{e^t}$",
            r"$\frac{-\sin t-\cos t}{e^t}$",
            r"$\frac{\sin t+\cos t}{e^{2t}}$",
            r"$\frac{-\sin t-\cos t}{e^{2t}}$",
        ],
    },
    "upper-gre-grebootcamp-s5-q6-298ef97e": {
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
    "upper-gre-grebootcamp-s7-q2-8b400f7b": {
        "choices": [
            r"$4^{10}$",
            "40",
            r"$\binom{9}{4}^{10}$",
            r"$\binom{13}{3}$",
            r"$\binom{13}{9}$",
        ],
    },
    "upper-gre-grebootcamp-s6-q5-1b0db2d5": {
        "prompt": (
            "There are two cards: one is black on both sides, and the other "
            "is black on one side and orange on the other. A card and then "
            "one of its sides are chosen uniformly at random. Given that the "
            "chosen side is black, what is the probability that the other "
            "side is orange?"
        ),
    },
    "upper-gre-grebootcamp-s9-q1-db6efd4d": {
        "prompt": r"The function $f(x,y)=x^2+3xy+y^2+y^4$:",
        "answerIndex": 3,
    },
}

# Some contests reuse one figure or table across several consecutive
# questions. These links were verified against the source pages rather than
# inferred from visual similarity. Keep the full stable ids here: prefix-only
# matching could silently attach the wrong asset after a future import.
VERIFIED_SHARED_DIAGRAMS = {
    "amio-ac1a24b9bcb728d734f04b1193e5266d": (
        "diagramPng",
        "assets/diagrams/16dffb75f3e15c4823f6db7d163398ed.png",
    ),
    "amio-f7aac714a9a971d023b425e78fb13b4e": (
        "diagramPng",
        "assets/diagrams/16dffb75f3e15c4823f6db7d163398ed.png",
    ),
    "amio-b11d9737add2b2a76fccb1d2a11e1b83": (
        "diagramPng",
        "assets/diagrams/4c30110e5ed6631eddda7289a3a9a5e3.png",
    ),
    "amio-9120324a1d3cca922636ac79477fd8a5": (
        "diagramSvg",
        "assets/diagrams/956b2a5e0eee881d65bbc50986453fce.svg",
    ),
    "amio-d972ec98bcd704ac3ca4eaf6409d69e3": (
        "diagramSvg",
        "assets/diagrams/a44fec80677fee2bd201cc78636a5cac.svg",
    ),
    "amio-5c45505d0b0e0790a63ea9078745b57a": (
        "diagramPng",
        "assets/diagrams/4fdca0ad68e25e359c10aadb7f68f6d6.png",
    ),
    "amio-e0ac70db00646afc0cf27788525faaab": (
        "diagramPng",
        "assets/diagrams/5224566ce602732d3c1883654e518b72.png",
    ),
    "amio-380451ea9c7157f1bfe54b094b8a92b9": (
        "diagramPng",
        "assets/diagrams/54ac4707af6243ce09f349d87255573f.png",
    ),
    "amio-392dcb7752789e95e5dcd0fb119d5ee7": (
        "diagramPng",
        "assets/diagrams/569e37555efc7af96b67e8a7e4f73300.png",
    ),
    "amio-99c5ba211cb755dde9eda00c6ce9e509": (
        "diagramPng",
        "assets/diagrams/89af124d6c36b7a8c3fcc57e408ad926.png",
    ),
    "amio-4dc77293dd11ac11b7c85b698bc26cec": (
        "diagramPng",
        "assets/diagrams/bee906e6bda2dcf788b96ab15973292e.png",
    ),
    "amio-e828b447da89623adbc406b6e327eb58": (
        "diagramPng",
        "assets/diagrams/beee1f89d8141011a57821601922498b.png",
    ),
    "amio-97cc7ca02b87488ee3766a53dfcded95": (
        "diagramPng",
        "assets/diagrams/f61b38cd82dd6149e6ce4021a24a88b1.png",
    ),
}


def count_unescaped_dollars(text: str) -> int:
    return len(UNESCAPED_DOLLAR_RE.findall(text or ""))


def _bump(changes: Counter[str] | None, name: str, before: str, after: str) -> str:
    if before != after and changes is not None:
        changes[name] += 1
    return after


def normalize_basic_text(text: Any, changes: Counter[str] | None = None) -> str:
    before = str(text or "")
    out = before.replace("\ufb01", "fi").replace("\ufb02", "fl")
    out = out.replace("\u00a0", " ")
    out = CONTROL_CHAR_RE.sub("", out)
    if HTML_ENTITY_RE.search(out):
        out = html.unescape(out)
    out = out.replace("\r", " ").replace("\n", " ")
    out = re.sub(r"\s+", " ", out).strip()
    return _bump(changes, "basic_text", before, out)


def strip_embedded_media_noise(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Remove source image filenames/credits, never mathematical content."""

    before = str(text or "")
    out = before
    out = re.sub(
        r"\s*\\?\$\s*\(NOTE:\s*THE FOLLOWING DIAGRAM WAS NOT SHOWN DURING "
        r"THE ACTUAL EXAM,.*?PICTURING THE PROBLEM\)\s*$",
        " ",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"\s*\\?\$\s*[~_]?[Dd]iagram by [^_\n]+_?\s*$",
        " ",
        out,
    )
    # Filenames with spaces found in the AMIO scrape.
    out = re.sub(r"\s+\bIMG\s+\d+\.(?:png|jpe?g|gif|svg)\b", " ", out, flags=re.I)
    out = re.sub(
        r"\s+\b\d{4}\s+AMC\s+\d{1,2}[AB]?\s+problem\s+\d+\.(?:png|jpe?g|gif|svg)\b",
        " ",
        out,
        flags=re.I,
    )
    # Multi-token AMIO attribution, for example "2003 12B AMC-20.png".
    # Match this before the generic single-token filename rule so its year and
    # contest suffix do not remain behind.
    out = re.sub(
        r"\s+\b\d{4}\s+\d{1,2}[AB]\s+AMC-\d+\.(?:png|jpe?g|gif|svg)\b",
        " ",
        out,
        flags=re.I,
    )
    # Single-token filenames such as 2006amc10b04.gif or AMC102005Aq.png.
    out = re.sub(
        r"\s+\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\.(?:png|jpe?g|gif|svg)\b",
        " ",
        out,
        flags=re.I,
    )
    # Also clean a residue produced by older normalizer versions that removed
    # only the filename from the multi-token attribution above.
    out = re.sub(
        r"\s+\b\d{4}\s+\d{1,2}[AB]\s*$",
        "",
        out,
        flags=re.I,
    )
    out = re.sub(r"\s+_Diagram by [^_]+_\s*$", "", out, flags=re.I)
    out = re.sub(r"\s+", " ", out).strip()
    return _bump(changes, "media_noise", before, out)


def _read_tex_argument(text: str, start: int) -> tuple[str, int] | None:
    pos = start
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if pos >= len(text):
        return None
    if text[pos] == "{":
        depth = 0
        for end in range(pos, len(text)):
            if text[end] == "{":
                depth += 1
            elif text[end] == "}":
                depth -= 1
                if depth == 0:
                    return text[pos + 1 : end], end + 1
        return None
    if text[pos] == "\\":
        command = re.match(r"\\[A-Za-z]+|\\.", text[pos:])
        if command:
            return command.group(0), pos + len(command.group(0))
    return text[pos], pos + 1


def canonicalize_fraction_commands(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Restore missing slashes and make TeX fraction arguments explicit."""

    before = str(text or "")
    out = re.sub(
        r"(?<![\\A-Za-z])(?P<cmd>d?frac|tfrac)(?![A-Za-z])"
        r"(?=\s*(?:\{|\\|[A-Za-z0-9]))",
        lambda match: "\\" + match.group("cmd"),
        before,
    )

    result: list[str] = []
    pos = 0
    command_re = re.compile(r"\\(?:d?frac|tfrac)(?![A-Za-z])")
    while True:
        match = command_re.search(out, pos)
        if not match:
            result.append(out[pos:])
            break
        result.append(out[pos : match.start()])
        first = _read_tex_argument(out, match.end())
        if first is None:
            result.append(match.group(0))
            pos = match.end()
            continue
        second = _read_tex_argument(out, first[1])
        if second is None:
            result.append(out[match.start() : first[1]])
            pos = first[1]
            continue
        result.append(f"{match.group(0)}{{{first[0]}}}{{{second[0]}}}")
        pos = second[1]
    normalized = "".join(result)
    return _bump(changes, "fraction_commands", before, normalized)


def canonicalize_sqrt_commands(
    text: Any, changes: Counter[str] | None = None
) -> str:
    before = str(text or "")
    out = re.sub(
        r"(?<![\\A-Za-z])sqrt(?![A-Za-z])(?=\s*(?:\[|\{|\\|[A-Za-z0-9]))",
        r"\\sqrt",
        before,
    )
    # A single unbraced TeX token is unambiguous.  Do not guess how a
    # multi-digit unbraced radicand should be grouped.
    out = re.sub(r"\\sqrt\s+([A-Za-z0-9])", r"\\sqrt{\1}", out)
    out = re.sub(r"\\sqrt([A-Za-z0-9])", r"\\sqrt{\1}", out)
    return _bump(changes, "sqrt_commands", before, out)


def restore_leading_tex_command(
    text: Any, changes: Counter[str] | None = None
) -> str:
    before = str(text or "")
    out = before
    out = re.sub(r"^([+-]?\s*)pi(?=$|[\s+*/^_({])", r"\1\\pi", out)
    out = re.sub(r"^([+-]?\s*)overline(?=\s*\{)", r"\1\\overline", out)
    return _bump(changes, "leading_tex_command", before, out)


def canonicalize_display_math(
    text: Any, changes: Counter[str] | None = None
) -> str:
    before = str(text or "")
    out = re.sub(
        r"(?<!\\)\$\$(.+?)(?<!\\)\$\$",
        lambda match: rf"\[{match.group(1).strip()}\]",
        before,
        flags=re.S,
    )

    env_pattern = (
        r"\\begin\{(?P<env>align\*?|eqnarray\*?)\}(?P<body>.*?)"
        r"\\end\{(?P=env)\}"
    )
    env_re = re.compile(env_pattern, flags=re.S)
    delimited_env_re = re.compile(
        rf"\\\[\s*(?P<environment>{env_pattern})\s*\\\]",
        flags=re.S,
    )

    def aligned_environment(match: re.Match[str]) -> str:
        body = match.group("body").strip()
        if match.group("env").startswith("eqnarray"):
            body = body.replace("&=&", "&=")
        return rf"\begin{{aligned}} {body} \end{{aligned}}"

    # An imported align may already live inside $$...$$ or \[...\]. Convert
    # that environment in place so it does not become a nested display.
    def replace_delimited_environment(match: re.Match[str]) -> str:
        environment = env_re.fullmatch(match.group("environment"))
        assert environment is not None
        return rf"\[{aligned_environment(environment)}\]"

    out = delimited_env_re.sub(replace_delimited_environment, out)
    out = env_re.sub(lambda match: rf"\[{aligned_environment(match)}\]", out)
    return _bump(changes, "display_math", before, out)


def canonicalize_choice_braces(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Remove a scrape-only triple wrapper around an entire choice."""

    before = str(text or "")
    stripped = before.strip()
    delimited = re.fullmatch(r"\$\s*\{\{\{(?P<body>.+)\}\}\}\s*\$", stripped, re.S)
    raw = re.fullmatch(r"\{\{\{(?P<body>.+)\}\}\}", stripped, re.S)
    if delimited:
        out = delimited.group("body").strip()
    elif raw:
        out = raw.group("body").strip()
    else:
        out = before
    return _bump(changes, "triple_brace_choice", before, out)


def canonicalize_mathjax_commands(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Replace source-valid commands unsupported by the shipped MathJax build."""

    before = str(text or "")
    out = before.replace(r"\thickspace", r"\;").replace(r"\hdots", r"\cdots")
    out = re.sub(
        r"\\\?(?P<close>\$|\\\)|\\\])",
        lambda match: f"{match.group('close')}?",
        out,
    )
    return _bump(changes, "mathjax_command_compatibility", before, out)


def canonicalize_currency_choice(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Undo an invalid math wrapper around an escaped currency amount."""

    before = str(text or "")
    match = re.fullmatch(
        r"\$\s*(?P<body>[+-]?\s*\\\$\s*\d+(?:\.\d+)?)\s*\$",
        before.strip(),
    )
    out = match.group("body").strip() if match else before
    out = re.sub(r"(\\\$)\s+", r"\1", out)
    return _bump(changes, "currency_choice_wrapper", before, out)


def repair_missing_choice_commands(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Repair scrape-lost text commands without exposing command names in UI."""

    before = str(text or "")
    out = re.sub(r"^mbox\{\s*\}\s*", "", before)
    out = re.sub(r"^texttt(?=\s*\{)", r"\\texttt", out)
    textrm = re.fullmatch(r"textrm\{(?P<body>.*)\}", out, re.S)
    if textrm:
        out = textrm.group("body").replace(r"\,", " ")
        out = re.sub(r"\s+", " ", out).strip()
    return _bump(changes, "missing_choice_command", before, out)


def strip_trailing_empty_phantom(
    text: Any, changes: Counter[str] | None = None
) -> str:
    """Remove an empty source-layout placeholder only at the prompt tail."""

    before = str(text or "")
    out = re.sub(
        r"\s*(?:\$\s*\\phantom\s*\{\s*\}\s*\$|"
        r"\\\(\s*\\phantom\s*\{\s*\}\s*\\\)|"
        r"\\phantom\s*\{\s*\})\s*$",
        "",
        before,
    )
    return _bump(changes, "trailing_empty_phantom", before, out)


def _strip_text_groups(text: str) -> str:
    out = text
    group_re = re.compile(
        r"\\(?:text|texttt|textrm|mbox|mathrm|mathbf|operatorname)"
        r"\s*\{[^{}]*\}"
    )
    previous = None
    while previous != out:
        previous = out
        out = group_re.sub(" ", out)
    return out


def looks_like_math_choice(text: str) -> bool:
    if not text or count_unescaped_dollars(text) or r"\$" in text:
        return False
    without_text = _strip_text_groups(text)
    without_commands = re.sub(r"\\[A-Za-z]+", " ", without_text)
    prose_words = re.findall(r"\b[a-z]{2,}\b", without_commands)
    has_tex = re.search(r"\\[A-Za-z]+", text) is not None
    has_operators = re.search(r"[=<>^_{}|]|(?:^|[^A-Za-z])[+\-*/](?:[^A-Za-z]|$)", text) is not None
    return not prose_words and (has_tex or has_operators)


def normalize_prompt(text: Any, changes: Counter[str] | None = None) -> str:
    out = normalize_basic_text(text, changes)
    out = strip_embedded_media_noise(out, changes)
    out = canonicalize_mathjax_commands(out, changes)
    out = canonicalize_fraction_commands(out, changes)
    out = canonicalize_sqrt_commands(out, changes)
    out = canonicalize_display_math(out, changes)
    out = strip_trailing_empty_phantom(out, changes)
    before = out
    out = re.sub(r"(\$)\s+-(?=[A-Za-z])", r"\1-", out)
    out = re.sub(r"\s+([,;:.!?])", r"\1", out)
    return _bump(changes, "prompt_spacing", before, out)


def normalize_choice(text: Any, changes: Counter[str] | None = None) -> str:
    out = normalize_basic_text(text, changes)
    out = strip_embedded_media_noise(out, changes)
    out = canonicalize_currency_choice(out, changes)
    out = repair_missing_choice_commands(out, changes)
    out = canonicalize_choice_braces(out, changes)
    before = out
    out = re.sub(r"^~\s*", "", out)
    out = TRAILING_TEX_SPACE_RE.sub("", out).strip()
    out = _bump(changes, "choice_layout_noise", before, out)
    out = canonicalize_mathjax_commands(out, changes)
    out = canonicalize_fraction_commands(out, changes)
    out = canonicalize_sqrt_commands(out, changes)
    out = restore_leading_tex_command(out, changes)
    before = out
    if looks_like_math_choice(out):
        out = f"${out}$"
    return _bump(changes, "choice_math_wrapper", before, out)


def attach_existing_diagram_assets(
    row: dict[str, Any],
    changes: Counter[str] | None = None,
    root: Path = ROOT,
) -> dict[str, Any]:
    """Link a stable AMIO row to source-faithful assets already in the repo."""

    out = deepcopy(row)
    if any(
        out.get(field)
        for field in ("diagramPng", "diagramPngs", "diagramSvg", "diagramSvgs")
    ):
        return out
    row_id = str(out.get("id", ""))
    if row_id == SPECULATIVE_CALENDAR_CROP_ID:
        return out
    shared = VERIFIED_SHARED_DIAGRAMS.get(row_id)
    if shared is not None:
        field, rel = shared
        before = json.dumps(
            {
                "diagramPng": out.get("diagramPng"),
                "diagramSvg": out.get("diagramSvg"),
            },
            sort_keys=True,
        )
        if (root / rel).is_file():
            out[field] = rel
        after = json.dumps(
            {
                "diagramPng": out.get("diagramPng"),
                "diagramSvg": out.get("diagramSvg"),
            },
            sort_keys=True,
        )
        _bump(changes, "verified_shared_diagram_link", before, after)
        return out

    match = re.fullmatch(r"amio-([0-9a-f]{32})", row_id)
    if not match:
        return out

    problem_id = match.group(1)
    before = json.dumps(
        {
            "diagramPng": out.get("diagramPng"),
            "diagramSvg": out.get("diagramSvg"),
        },
        sort_keys=True,
    )
    png = root / "assets" / "diagrams" / f"{problem_id}.png"
    svg = root / "assets" / "diagrams" / f"{problem_id}.svg"
    if png.is_file():
        out["diagramPng"] = f"assets/diagrams/{problem_id}.png"
    if svg.is_file():
        out["diagramSvg"] = f"assets/diagrams/{problem_id}.svg"
    after = json.dumps(
        {
            "diagramPng": out.get("diagramPng"),
            "diagramSvg": out.get("diagramSvg"),
        },
        sort_keys=True,
    )
    _bump(changes, "existing_diagram_link", before, after)
    return out


def apply_known_row_patches(
    row: dict[str, Any], changes: Counter[str] | None = None
) -> dict[str, Any]:
    out = deepcopy(row)
    row_id = str(out.get("id", ""))

    exact_prompt = VERIFIED_EXACT_PROMPT_OVERRIDES.get(row_id)
    if exact_prompt is not None:
        before = str(out.get("prompt", ""))
        out["prompt"] = exact_prompt
        _bump(changes, "verified_prompt_override", before, exact_prompt)

    if row_id == GRE_PRACTICE_EXPONENT_TOWER_ID:
        before = str(out.get("prompt", ""))
        out["prompt"] = (
            "Suppose today is Wednesday. What day of the week will it be "
            r"$10^{10^{10}}$ days from now?"
        )
        _bump(changes, "source_backed_gre_override", before, out["prompt"])

    amc8_choice_override = VERIFIED_AMC8_CHOICE_OVERRIDES.get(row_id)
    if amc8_choice_override:
        choice_index, verified_choice = amc8_choice_override
        choices = list(out.get("choices", []))
        if len(choices) == 5:
            before = json.dumps(
                {
                    "choices": choices,
                    "answerIndex": out.get("answerIndex"),
                    "answerKey": out.get("answerKey"),
                    "answer": out.get("answer"),
                },
                sort_keys=True,
            )
            choices[choice_index] = verified_choice
            out["choices"] = choices
            if out.get("answerIndex") == choice_index:
                out["answer"] = verified_choice
            after = json.dumps(
                {
                    "choices": out["choices"],
                    "answerIndex": out.get("answerIndex"),
                    "answerKey": out.get("answerKey"),
                    "answer": out.get("answer"),
                },
                sort_keys=True,
            )
            _bump(changes, "verified_choice_override", before, after)

    bootcamp_section = GRE_BOOTCAMP_SECTION_BY_ID.get(row_id)
    if bootcamp_section:
        source = deepcopy(out.get("source", {}))
        if not isinstance(source, dict):
            source = {}
        before = json.dumps(source, sort_keys=True)
        source["section"] = bootcamp_section
        if not bootcamp_section.startswith("problem_set_"):
            legacy_problem_set = source.pop("problemSet", None)
            if legacy_problem_set is not None:
                source["legacyProblemSet"] = legacy_problem_set
        out["source"] = source
        _bump(
            changes,
            "source_section_disambiguation",
            before,
            json.dumps(source, sort_keys=True),
        )

    bootcamp_patch = GRE_BOOTCAMP_ROW_OVERRIDES.get(row_id)
    if bootcamp_patch:
        tracked_fields = ("prompt", "choices", "answerIndex", "answerKey", "answer")
        before = json.dumps(
            {field: out.get(field) for field in tracked_fields},
            sort_keys=True,
        )
        if "prompt" in bootcamp_patch:
            out["prompt"] = bootcamp_patch["prompt"]
        if "choices" in bootcamp_patch:
            out["choices"] = list(bootcamp_patch["choices"])
        if "answerIndex" in bootcamp_patch:
            out["answerIndex"] = bootcamp_patch["answerIndex"]
        answer_index = out.get("answerIndex")
        choices = out.get("choices")
        if (
            isinstance(answer_index, int)
            and isinstance(choices, list)
            and 0 <= answer_index < len(choices)
        ):
            out["answerKey"] = "ABCDE"[answer_index]
            out["answer"] = choices[answer_index]
        after = json.dumps(
            {field: out.get(field) for field in tracked_fields},
            sort_keys=True,
        )
        _bump(changes, "source_backed_gre_override", before, after)

    if row_id == SPECULATIVE_CALENDAR_CROP_ID:
        speculative_path = (
            "assets/diagrams/43b2c056b96a9474e34431445277d923.png"
        )
        if out.get("diagramPng") == speculative_path:
            before = str(out["diagramPng"])
            out.pop("diagramPng")
            _bump(changes, "speculative_diagram_removal", before, "")

    if row_id == OFFICIAL_AMC12B_2023_Q7_ID:
        official_choices = ["2", "3", "900", "901", "902"]
        before = json.dumps(
            {
                "choices": out.get("choices"),
                "answerIndex": out.get("answerIndex"),
                "answerKey": out.get("answerKey"),
                "answer": out.get("answer"),
            },
            sort_keys=True,
        )
        out["choices"] = official_choices
        out["answerIndex"] = 3
        out["answerKey"] = "D"
        out["answer"] = "901"
        after = json.dumps(
            {
                "choices": out["choices"],
                "answerIndex": out["answerIndex"],
                "answerKey": out["answerKey"],
                "answer": out["answer"],
            },
            sort_keys=True,
        )
        _bump(changes, "official_source_override", before, after)

    if row_id == OFFICIAL_AMC12B_2012_Q12_ID:
        before = json.dumps(
            {
                "answerIndex": out.get("answerIndex"),
                "answerKey": out.get("answerKey"),
                "answer": out.get("answer"),
            },
            sort_keys=True,
        )
        out["answerIndex"] = 4
        out["answerKey"] = "E"
        out["answer"] = "382"
        after = json.dumps(
            {
                "answerIndex": out["answerIndex"],
                "answerKey": out["answerKey"],
                "answer": out["answer"],
            },
            sort_keys=True,
        )
        _bump(changes, "official_answer_override", before, after)

    if row_id == OFFICIAL_AMC12A_2016_Q16_ID:
        before = str(out.get("prompt", ""))
        out["prompt"] = (
            r"The graphs of $y=\log_{3} x, y=\log_{x} 3, "
            r"y=\log_{\frac{1}{3}} x,$ and "
            r"$y=\log_{x} \dfrac{1}{3}$ are plotted on the same set of "
            r"axes. How many points in the plane with positive "
            r"$x$-coordinates lie on two or more of the graphs?"
        )
        _bump(changes, "official_source_override", before, out["prompt"])

    if row_id == OFFICIAL_AMC8_2023_Q24_ID:
        before = str(out.get("prompt", ""))
        out["prompt"] = (
            r"Isosceles $\triangle ABC$ has equal side lengths $AB$ and "
            r"$BC$. In the figure below, segments are drawn parallel to "
            r"$\overline{AC}$ so that the shaded portions of $\triangle "
            r"ABC$ have the same area. The heights of the two unshaded "
            r"portions are 11 and 5 units, respectively. What is the height "
            r"$h$ of $\triangle ABC$?"
        )
        _bump(changes, "official_source_override", before, out["prompt"])

    if row_id == GRE_BOOTCAMP_ROUTES_ID:
        source_choices = [
            r"$5\cdot 7$",
            r"$\frac{7!}{5!}$",
            r"$\frac{12!}{7!5!}$",
            r"$2^{12}$",
            r"$7!5!$",
        ]
        before = json.dumps(
            {
                "choices": out.get("choices"),
                "answerIndex": out.get("answerIndex"),
                "answerKey": out.get("answerKey"),
                "answer": out.get("answer"),
            },
            sort_keys=True,
        )
        out["choices"] = source_choices
        out["answerIndex"] = 2
        out["answerKey"] = "C"
        out["answer"] = source_choices[2]
        after = json.dumps(
            {
                "choices": out["choices"],
                "answerIndex": out["answerIndex"],
                "answerKey": out["answerKey"],
                "answer": out["answer"],
            },
            sort_keys=True,
        )
        _bump(changes, "source_backed_answer_override", before, after)

    if row_id in HEARTSUIT_IDS:
        choices = [
            r"$x \heartsuit y = y \heartsuit x$ for all $x$ and $y$",
            r"$2(x \heartsuit y) = (2x) \heartsuit (2y)$ for all $x$ and $y$",
            r"$x \heartsuit 0 = x$ for all $x$",
            r"$x \heartsuit x = 0$ for all $x$",
            r"$x \heartsuit y > 0 \text{ if } x \neq y$",
        ]
        before = json.dumps(out.get("choices"), ensure_ascii=False)
        out["choices"] = choices
        out["answerIndex"] = 2
        out["answerKey"] = "C"
        out["answer"] = choices[2]
        _bump(
            changes,
            "mixed_choice_delimiter_override",
            before,
            json.dumps(choices, ensure_ascii=False),
        )

    if row_id == "amio-0598429729f5981161b2e465c2265c14":
        choices = list(out.get("choices", []))
        if len(choices) == 5 and choices[4] != "14":
            before = str(choices[4])
            choices[4] = "14"
            out["choices"] = choices
            _bump(changes, "source_attribution_noise", before, "14")

    if row_id == "amio-240d176802561ac514df753ff829a8bc":
        choices = [
            r"$\{x\mid x\ne 0\}$",
            r"$\{x\mid x<0\}$",
            r"$\{x\mid x>0\}$",
            r"$\{x\mid x\ne -1,\ x\ne 0,\ x\ne 1\}$",
            r"$\{-1,1\}$",
        ]
        before = json.dumps(out.get("choices"), ensure_ascii=False)
        out["choices"] = choices
        out["answerIndex"] = 4
        out["answerKey"] = "E"
        out["answer"] = choices[4]
        _bump(
            changes,
            "malformed_set_choice_override",
            before,
            json.dumps(choices, ensure_ascii=False),
        )

    if row_id == "amio-aee82ef56f7042c3ac61d14ca9f1de2d":
        before = json.dumps(
            {
                "diagramPng": out.get("diagramPng"),
                "diagramSvg": out.get("diagramSvg"),
            },
            sort_keys=True,
        )
        out.pop("diagramPng", None)
        out["diagramSvg"] = (
            "assets/diagrams/aee82ef56f7042c3ac61d14ca9f1de2d.svg"
        )
        after = json.dumps(
            {
                "diagramPng": out.get("diagramPng"),
                "diagramSvg": out.get("diagramSvg"),
            },
            sort_keys=True,
        )
        _bump(changes, "broken_diagram_override", before, after)

    if row_id == "amio-e10df578cd4319b6293bcdd3a01b63e2":
        prompt = str(out.get("prompt", ""))
        patched = prompt.replace("written in the from ", "written in the form ")
        patched = re.sub(r"\s+_Diagram by [^_]+_\s*$", "", patched)
        out["prompt"] = patched
        _bump(changes, "source_typo_override", prompt, patched)

    prompt_replacements = VERIFIED_PROMPT_TEXT_REPLACEMENTS.get(row_id)
    if prompt_replacements:
        before = str(out.get("prompt", ""))
        patched = before
        for source_text, replacement in prompt_replacements:
            patched = patched.replace(source_text, replacement)
        out["prompt"] = patched
        _bump(changes, "verified_prompt_text_override", before, patched)

    if row_id in APPEND_CLOSING_PAREN_IDS:
        prompt = str(out.get("prompt", "")).rstrip()
        missing = prompt.count("(") - prompt.count(")")
        if missing > 0:
            patched = prompt + (")" * missing)
            out["prompt"] = patched
            _bump(changes, "truncated_parenthetical_override", prompt, patched)

    return out


def normalize_problem_row(
    row: dict[str, Any], changes: Counter[str] | None = None
) -> dict[str, Any]:
    out = apply_known_row_patches(row, changes)
    out = attach_existing_diagram_assets(out, changes)
    out["prompt"] = normalize_prompt(out.get("prompt", ""), changes)

    if isinstance(out.get("choices"), list):
        out["choices"] = [normalize_choice(choice, changes) for choice in out["choices"]]

    if out.get("type") == "mcq":
        answer_index = out.get("answerIndex")
        choices = out.get("choices")
        if (
            isinstance(answer_index, int)
            and isinstance(choices, list)
            and 0 <= answer_index < len(choices)
        ):
            before_answer = str(out.get("answer", ""))
            before_key = str(out.get("answerKey", ""))
            out["answer"] = choices[answer_index]
            out["answerKey"] = "ABCDE"[answer_index] if answer_index < 5 else before_key
            _bump(changes, "answer_sync", before_answer, str(out["answer"]))
            _bump(changes, "answer_key_sync", before_key, str(out["answerKey"]))
    elif isinstance(out.get("answer"), str):
        out["answer"] = normalize_basic_text(out["answer"], changes)

    return out


def normalize_problem_rows(
    rows: Iterable[dict[str, Any]], changes: Counter[str] | None = None
) -> list[dict[str, Any]]:
    return [normalize_problem_row(row, changes) for row in rows]


def normalized_prompt_key(text: Any) -> str:
    out = str(text or "").casefold()
    out = re.sub(r"\\(?:left|right|,|;|:|!|quad|qquad)", " ", out)
    out = re.sub(r"\\(?:d?frac|tfrac)", " frac ", out)
    out = re.sub(r"\\[A-Za-z]+", " ", out)
    out = re.sub(r"[^a-z0-9]+", " ", out)
    return " ".join(out.split())


def _png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        header = path.read_bytes()[:24]
    except OSError:
        return None
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", header[16:24])


def audit_rows(
    datasets: dict[str, list[dict[str, Any]]],
    root: Path = ROOT,
) -> dict[str, Any]:
    issue_counts: Counter[str] = Counter()
    examples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    prompt_groups: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    near_blocks: dict[str, list[tuple[str, dict[str, Any], str]]] = defaultdict(list)
    all_ids: dict[str, str] = {}

    def issue(kind: str, filename: str, row: dict[str, Any], detail: str) -> None:
        issue_counts[kind] += 1
        if len(examples[kind]) < 20:
            examples[kind].append(
                {
                    "file": f"data/{filename}",
                    "id": row.get("id"),
                    "detail": detail[:300],
                }
            )

    for filename, rows in datasets.items():
        if not isinstance(rows, list):
            issue_counts["dataset_not_array"] += 1
            continue
        file_ids: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                issue("row_not_object", filename, {}, repr(row))
                continue
            row_id = str(row.get("id", ""))
            if not row_id:
                issue("missing_id", filename, row, "")
            elif row_id in file_ids:
                issue("duplicate_id_in_file", filename, row, row_id)
            elif row_id in all_ids:
                issue(
                    "duplicate_id_cross_file",
                    filename,
                    row,
                    f"also in data/{all_ids[row_id]}",
                )
            file_ids.add(row_id)
            all_ids[row_id] = filename

            prompt = str(row.get("prompt", ""))
            if not prompt:
                issue("empty_prompt", filename, row, "")
            elif TRUNCATED_PROMPT_RE.search(prompt):
                issue("truncated_prompt", filename, row, prompt)
            key = normalized_prompt_key(prompt)
            if key:
                prompt_groups[key].append((filename, row))
                words = key.split()
                if len(words) >= 8:
                    near_blocks[" ".join(words[:5])].append((filename, row, key))

            if row.get("type") == "mcq":
                choices = row.get("choices")
                answer_index = row.get("answerIndex")
                if not isinstance(choices, list) or len(choices) != 5:
                    issue("choices_shape", filename, row, repr(choices))
                elif any(not isinstance(choice, str) or not choice.strip() for choice in choices):
                    issue("empty_choice", filename, row, repr(choices))
                elif len(set(choice.strip() for choice in choices)) != 5:
                    issue("duplicate_choices", filename, row, repr(choices))
                if not isinstance(answer_index, int) or not (0 <= answer_index < 5):
                    issue("answer_index", filename, row, repr(answer_index))
                elif isinstance(choices, list) and len(choices) == 5:
                    if row.get("answer") != choices[answer_index]:
                        issue("answer_mismatch", filename, row, str(row.get("answer")))
                    if row.get("answerKey") != "ABCDE"[answer_index]:
                        issue("answer_key_mismatch", filename, row, str(row.get("answerKey")))

            strings: list[tuple[str, str]] = [("prompt", prompt)]
            if isinstance(row.get("choices"), list):
                strings.extend(
                    (f"choices[{index}]", str(choice))
                    for index, choice in enumerate(row["choices"])
                )
            if isinstance(row.get("answer"), str):
                strings.append(("answer", row["answer"]))

            for field, text in strings:
                if count_unescaped_dollars(text) % 2:
                    issue("odd_dollar_count", filename, row, f"{field}: {text}")
                if CONTROL_CHAR_RE.search(text):
                    issue("control_character", filename, row, f"{field}: {text}")
                if MOJIBAKE_RE.search(text):
                    issue("mojibake", filename, row, f"{field}: {text}")
                if HTML_TAG_RE.search(text):
                    issue("html_tag", filename, row, f"{field}: {text}")
                if HTML_ENTITY_RE.search(text):
                    issue("html_entity", filename, row, f"{field}: {text}")
                if MARKER_RE.search(text):
                    issue("source_marker", filename, row, f"{field}: {text}")
                if MEDIA_FILENAME_RE.search(text):
                    issue("media_filename_in_text", filename, row, f"{field}: {text}")
                if BARE_COMMAND_RE.search(text):
                    issue("bare_leading_tex_command", filename, row, f"{field}: {text}")

            for field in ("diagramPng", "diagramSvg"):
                if not row.get(field):
                    continue
                rel = str(row[field])
                asset = root / rel
                if not asset.is_file():
                    issue("missing_diagram", filename, row, f"{field}: {rel}")
                elif field == "diagramPng":
                    dims = _png_dimensions(asset)
                    if dims is None:
                        issue("invalid_png", filename, row, rel)
                    elif dims[0] < 16 or dims[1] < 16:
                        issue("tiny_png", filename, row, f"{rel}: {dims[0]}x{dims[1]}")

            for field in ("diagramPngs", "diagramSvgs"):
                if row.get(field) is None:
                    continue
                if not isinstance(row[field], list):
                    issue("diagram_list_shape", filename, row, f"{field}: {row[field]!r}")
                    continue
                for rel_value in row[field]:
                    rel = str(rel_value)
                    asset = root / rel
                    if not asset.is_file():
                        issue("missing_diagram", filename, row, f"{field}: {rel}")
                    elif field == "diagramPngs":
                        dims = _png_dimensions(asset)
                        if dims is None:
                            issue("invalid_png", filename, row, rel)
                        elif dims[0] < 16 or dims[1] < 16:
                            issue(
                                "tiny_png",
                                filename,
                                row,
                                f"{rel}: {dims[0]}x{dims[1]}",
                            )

    exact_duplicate_groups = []
    for key, members in prompt_groups.items():
        if len(members) < 2:
            continue
        exact_duplicate_groups.append(
            {
                "normalizedPrompt": key[:240],
                "members": [
                    {"file": f"data/{filename}", "id": row.get("id")}
                    for filename, row in members
                ],
            }
        )

    near_duplicate_pairs = []
    seen_pairs: set[tuple[str, str, str, str]] = set()
    for members in near_blocks.values():
        if len(members) < 2 or len(members) > 80:
            continue
        for i, (file_a, row_a, key_a) in enumerate(members):
            for file_b, row_b, key_b in members[i + 1 :]:
                if key_a == key_b:
                    continue
                length_ratio = min(len(key_a), len(key_b)) / max(len(key_a), len(key_b))
                if length_ratio < 0.9:
                    continue
                ratio = difflib.SequenceMatcher(None, key_a, key_b, autojunk=False).ratio()
                if ratio < 0.965:
                    continue
                pair_key = (
                    file_a,
                    str(row_a.get("id")),
                    file_b,
                    str(row_b.get("id")),
                )
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)
                near_duplicate_pairs.append(
                    {
                        "similarity": round(ratio, 4),
                        "left": {"file": f"data/{file_a}", "id": row_a.get("id")},
                        "right": {"file": f"data/{file_b}", "id": row_b.get("id")},
                    }
                )

    exact_duplicate_groups.sort(
        key=lambda group: (
            -len(group["members"]),
            str(group["members"][0].get("id", "")),
        )
    )
    near_duplicate_pairs.sort(
        key=lambda pair: (
            -pair["similarity"],
            str(pair["left"].get("id", "")),
            str(pair["right"].get("id", "")),
        )
    )
    return {
        "datasetCounts": {f"data/{name}": len(rows) for name, rows in datasets.items()},
        "issueCounts": dict(sorted(issue_counts.items())),
        "issueExamples": dict(sorted(examples.items())),
        "exactDuplicateGroupCount": len(exact_duplicate_groups),
        "exactDuplicateGroups": exact_duplicate_groups[:100],
        "nearDuplicatePairCount": len(near_duplicate_pairs),
        "nearDuplicatePairs": near_duplicate_pairs[:100],
    }


def _serialize(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def load_datasets(root: Path = ROOT) -> dict[str, list[dict[str, Any]]]:
    datasets = {}
    for filename in DATA_FILES:
        path = root / "data" / filename
        datasets[filename] = json.loads(path.read_text(encoding="utf-8"))
    return datasets


def load_baseline_datasets(
    root: Path = ROOT,
) -> dict[str, list[dict[str, Any]]] | None:
    """Read the pinned pre-cleanup banks when running inside the git checkout."""

    datasets: dict[str, list[dict[str, Any]]] = {}
    try:
        for filename in DATA_FILES:
            result = subprocess.run(
                ["git", "show", f"{BASELINE_REF}:data/{filename}"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            )
            datasets[filename] = json.loads(result.stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError):
        return None
    return datasets


def normalize_datasets(
    datasets: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, list[dict[str, Any]]], Counter[str]]:
    changes: Counter[str] = Counter()
    normalized = {
        filename: normalize_problem_rows(rows, changes)
        for filename, rows in datasets.items()
    }
    return normalized, changes


def refresh_quality_report_metadata(root: Path = ROOT) -> list[str]:
    changed: list[str] = []
    calculus_path = root / "data" / "calculus_mcq_quality_report.json"
    upper_path = root / "data" / "upper_level_mcq_quality_report.json"

    if calculus_path.exists():
        payload = json.loads(calculus_path.read_text(encoding="utf-8"))
        payload["source"] = "data/calculus_mcq.json"
        text = _serialize(payload)
        if text != calculus_path.read_text(encoding="utf-8"):
            calculus_path.write_text(text, encoding="utf-8")
            changed.append("data/calculus_mcq_quality_report.json")

    if upper_path.exists():
        payload = json.loads(upper_path.read_text(encoding="utf-8"))
        payload["source"] = "data/upper_level_mcq.json"
        payload["pipeline_stage"] = "pre_rewrite_quality_filter"
        text = _serialize(payload)
        if text != upper_path.read_text(encoding="utf-8"):
            upper_path.write_text(text, encoding="utf-8")
            changed.append("data/upper_level_mcq_quality_report.json")

    return changed


def merge_cleanup_provenance(
    current: dict[str, Any],
    previous: dict[str, Any] | None,
    baseline_changes: Counter[str] | None = None,
    baseline_changed_files: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Retain cumulative cleanup provenance without double-counting checks."""

    latest_changes = Counter(current.get("normalizationChanges", {}))
    latest_files = sorted(set(current.get("changedFiles", [])))
    latest_metadata = sorted(set(current.get("metadataFilesChanged", [])))

    cumulative_changes: Counter[str] = Counter(baseline_changes or {})
    cumulative_files: set[str] = set(baseline_changed_files or ())
    cumulative_metadata: set[str] = set()
    has_baseline_snapshot = (
        baseline_changes is not None and baseline_changed_files is not None
    )
    if (
        not has_baseline_snapshot
        and previous
        and previous.get("baselineRef") == BASELINE_REF
    ):
        cumulative_changes.update(previous.get("normalizationChanges", {}))
        cumulative_files.update(previous.get("changedFiles", []))
    if previous and previous.get("baselineRef") == BASELINE_REF:
        cumulative_metadata.update(previous.get("metadataFilesChanged", []))

    if not has_baseline_snapshot:
        cumulative_changes.update(latest_changes)
        cumulative_files.update(latest_files)
    cumulative_metadata.update(latest_metadata)

    return {
        "baselineRef": BASELINE_REF,
        "normalizationChanges": dict(sorted(cumulative_changes.items())),
        "changedFiles": sorted(cumulative_files),
        "latestNormalizationChanges": dict(sorted(latest_changes.items())),
        "latestChangedFiles": latest_files,
        **{
            key: value
            for key, value in current.items()
            if key
            not in {
                "normalizationChanges",
                "changedFiles",
                "metadataFilesChanged",
            }
        },
        "metadataFilesChanged": sorted(cumulative_metadata),
        "latestMetadataFilesChanged": latest_metadata,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="Write normalized datasets.")
    mode.add_argument(
        "--check",
        action="store_true",
        help="Fail when normalization changes are pending or blocking issues remain.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help="Audit report path (written with --write).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    original = load_datasets()
    normalized, changes = normalize_datasets(original)
    changed_files = [
        f"data/{filename}"
        for filename in DATA_FILES
        if _serialize(original[filename]) != _serialize(normalized[filename])
    ]
    audit = audit_rows(normalized)
    current_report = {
        "normalizationChanges": dict(sorted(changes.items())),
        "changedFiles": changed_files,
        **audit,
    }
    previous_report = None
    if args.report.exists():
        try:
            previous_report = json.loads(args.report.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous_report = None

    baseline = load_baseline_datasets()
    baseline_changes = None
    baseline_changed_files = None
    if baseline is not None:
        _, baseline_changes = normalize_datasets(baseline)
        baseline_changed_files = [
            f"data/{filename}"
            for filename in DATA_FILES
            if _serialize(baseline[filename]) != _serialize(normalized[filename])
        ]

    if args.write:
        for filename in DATA_FILES:
            path = ROOT / "data" / filename
            text = _serialize(normalized[filename])
            if text != path.read_text(encoding="utf-8"):
                path.write_text(text, encoding="utf-8")
        current_report["metadataFilesChanged"] = refresh_quality_report_metadata()
    else:
        current_report["metadataFilesChanged"] = []

    report = merge_cleanup_provenance(
        current_report,
        previous_report,
        baseline_changes,
        baseline_changed_files,
    )
    if args.write:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(_serialize(report), encoding="utf-8")

    print(_serialize(report), end="")
    if args.check:
        blocking = {
            "dataset_not_array",
            "row_not_object",
            "missing_id",
            "duplicate_id_in_file",
            "duplicate_id_cross_file",
            "empty_prompt",
            "truncated_prompt",
            "choices_shape",
            "empty_choice",
            "duplicate_choices",
            "answer_index",
            "answer_mismatch",
            "answer_key_mismatch",
            "odd_dollar_count",
            "control_character",
            "mojibake",
            "html_tag",
            "html_entity",
            "source_marker",
            "media_filename_in_text",
            "bare_leading_tex_command",
            "missing_diagram",
            "invalid_png",
            "tiny_png",
            "diagram_list_shape",
        }
        blocking_count = sum(
            count
            for kind, count in audit["issueCounts"].items()
            if kind in blocking
        )
        return 1 if changed_files or blocking_count else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
