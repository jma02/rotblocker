#!/usr/bin/env python3
import csv
import html
import json
import os
import re
import subprocess
import struct
from pathlib import Path

SRC = Path('third_party/amio_aops/parsed_ArtOfProblemSolving.csv')
OUT = Path('data')
DIAGRAMS_DIR = Path('assets/diagrams')
ASYMPTOTE_HOME = Path('.asy_home')
RENDER_ASY = os.environ.get('RENDER_ASY', '0') == '1'
CURRENCY_WORDS = {
    'dollar', 'dollars', 'cent', 'cents', 'usd',
    'price', 'cost', 'costs', 'pay', 'paid', 'more', 'less',
    'each', 'per', 'for', 'total', 'worth', 'charge', 'charges',
    'spent', 'spend', 'earned', 'income', 'fare', 'fares'
}
LEADING_ARTICLE_WORDS = {
    'regular', 'palindrome', 'circle', 'parabola', 'subset', 'sphere', 'sequence',
    'fair', 'positive', 'hexagon', 'function', 'point', 'convex', 'triangle'
}
UNESCAPED_DOLLAR_RE = re.compile(r'(?<!\\)\$')
MATHML_TAG_RE = re.compile(
    r'</?(?:math|mrow|mi|mo|mn|msup|msub|msubsup|mfrac|msqrt|mroot|mstyle|mtext|semantics|annotation(?:-xml)?)\b[^>]*>',
    flags=re.I
)


def contest_from_link(link: str):
    if 'AMC_8_Problems' in link:
        return 'amc8', 'AoPS (AMIO) - AMC 8', 3
    if 'AMC_10A_Problems' in link or 'AMC_10B_Problems' in link or 'AMC_10_Problems' in link:
        return 'amc10', 'AoPS (AMIO) - AMC 10', 10
    if 'AMC_12A_Problems' in link or 'AMC_12B_Problems' in link or 'AMC_12_Problems' in link:
        return 'amc12', 'AoPS (AMIO) - AMC 12', 12
    if 'AIME_Problems' in link:
        return 'aime', 'AoPS (AMIO) - AIME', 60
    return None


def clean_text(s: str) -> str:
    s = (s or '').strip()
    s = s.replace('\r', ' ').replace('\n', ' ')
    s = re.sub(r'\s+', ' ', s)
    return s


def restore_likely_missing_leading_article(s: str) -> str:
    t = clean_text(s)
    m = re.match(r'^([a-z]+)\b', t)
    if not m:
        return t
    first = m.group(1)
    if first not in LEADING_ARTICLE_WORDS:
        return t
    article = 'An' if first[0] in 'aeiou' else 'A'
    return f'{article} {t}'


def strip_mathml_markup(s: str) -> str:
    s = s or ''
    s = html.unescape(s)
    return MATHML_TAG_RE.sub(' ', s)


def strip_math_wrappers(s: str) -> str:
    s = strip_mathml_markup(s)
    s = re.sub(r'\[/?\s*(mathjax|tex)\s*\]', ' ', s, flags=re.I)
    return s


def normalize_latex_fragment(s: str) -> str:
    def strip_empty_script_markers(text: str) -> str:
        out = text or ''
        prev = None
        while out != prev:
            prev = out
            # Drop empty script markers attached to symbols, e.g. x_{}^{}.
            out = re.sub(r'(?<=\S)\s*(?:\^\s*\{\s*\}|_\s*\{\s*\})+', '', out)
            # Drop any remaining standalone empty script markers.
            out = re.sub(r'(?:\^\s*\{\s*\}|_\s*\{\s*\})+', '', out)
        return out

    s = clean_text(s)
    # MathJax support for \multicolumn in imported array/table fragments is spotty.
    # Keep only the cell payload.
    s = re.sub(
        r'\\multicolumn\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}',
        r'\1',
        s
    )
    # Normalize unsupported arc macro to a MathJax-safe form.
    s = re.sub(r'\\overarc\s*\{([^{}]+)\}', r'\\overset{\\frown}{\1}', s)
    # Normalize text-style commands that are not consistently supported.
    s = re.sub(r'\\emph\s*\{', r'\\text{', s)
    # Strip LaTeX grouping/layout directives that MathJax doesn't support well.
    s = re.sub(r'\\begingroup\b', ' ', s)
    s = re.sub(r'\\endgroup\b', ' ', s)
    s = re.sub(r'\\setlength\s*\{\\tabcolsep\}\s*\{[^{}]*\}', ' ', s)
    s = re.sub(r'\\renewcommand\s*\{\\arraystretch\}\s*\{[^{}]*\}', ' ', s)
    # MathJax doesn't support tabular; map it to array in math mode.
    s = re.sub(r'\\begin\{tabular\*\}\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*\{([^{}]*)\}', r'\\begin{array}{\1}', s)
    s = re.sub(r'\\begin\{tabular\}\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}', r'\\begin{array}{\1}', s)
    s = s.replace(r'\end{tabular*}', r'\end{array}')
    s = s.replace(r'\end{tabular}', r'\end{array}')
    # Normalize currency macros and malformed currency wrappers.
    s = re.sub(r'\\textdollars?', r'\\$', s)
    def normalize_inner_escaped_currency(m):
        seg = (m.group(1) or '').strip()
        # Keep math wrappers when the payload contains LaTeX commands
        # (e.g., $\$\underline{1}\underline{A}\underline{2}$).
        if '\\' in seg:
            return m.group(0)
        return f'\\${seg}'
    s = re.sub(
        r'(?<!\S)\$\s*\\\$\s*([^$]+?)\s*\$',
        normalize_inner_escaped_currency,
        s
    )
    s = re.sub(r'(?<!\S)\$\$(\d+(?:,\d{3})*(?:\.\d+)?)(?=[\s,.;:!?)]|$)', r'\\$\1', s)
    s = re.sub(r'(?<!\S)\$\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)\$', r'\\$\1', s)
    s = re.sub(r'(?<!\S)\$\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\$', r'\\$\1', s)
    s = re.sub(r'\$\$\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)\$', r'\\$\1', s)
    s = re.sub(r'\\\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\\\$', r'\\$\1', s)
    s = re.sub(r'(?<=[A-Za-z])\\\$', r' \\$', s)
    s = re.sub(r'([,.;:])\\\$', r'\1 \\$', s)
    s = re.sub(r'(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])', r' $', s)
    # Replace thin horizontal-rule blanks with a safer placeholder for MathJax.
    s = re.sub(
        r'\\rule\s*\{[^{}]*\}\s*\{(?:0?\.\d+|[0-1](?:\.\d+)?)mm\}',
        r'\\underline{\\phantom{00}}',
        s
    )
    # Drop spacing directives that frequently break imported MathJax content.
    s = re.sub(r'@\{\\hspace\*?\{[^{}]*\}\}', '', s)
    s = re.sub(r'\\(?:hspace|vspace)\*?\{[^{}]*\}', ' ', s)
    # Normalize command spacing like "\text {x}" -> "\text{x}".
    s = re.sub(r'\\([A-Za-z]+)\s+\{', r'\\\1{', s)
    # Normalize punctuation spacing.
    s = re.sub(r'\s+([,;:.!?])', r'\1', s)
    return strip_empty_script_markers(s)


def count_unescaped_dollars(s: str) -> int:
    return len(UNESCAPED_DOLLAR_RE.findall(s or ''))


def escape_last_unescaped_dollar(s: str) -> str:
    s = s or ''
    for i in range(len(s) - 1, -1, -1):
        if s[i] == '$' and (i == 0 or s[i - 1] != '\\'):
            return s[:i] + r'\$' + s[i + 1:]
    return s


def remove_first_unescaped_dollar(s: str) -> str:
    return re.sub(r'(?<!\\)\$', '', s or '', count=1)


def remove_last_unescaped_dollar(s: str) -> str:
    s = s or ''
    for i in range(len(s) - 1, -1, -1):
        if s[i] == '$' and (i == 0 or s[i - 1] != '\\'):
            return s[:i] + s[i + 1:]
    return s


def looks_mathish_segment(seg: str) -> bool:
    t = (seg or '').strip()
    if not t:
        return True
    if not re.search(r'[A-Za-z]', t):
        return True
    if re.search(r'\\[A-Za-z]+|[=+\-*/^_{}()]', t):
        return True
    if re.fullmatch(r'\d+(?:,\d{3})*(?:\.\d+)?', t):
        return True
    if re.fullmatch(r'[A-Za-z](?:\d+)?', t):
        return True
    return False


def escape_likely_currency_dollars(s: str) -> str:
    text = s or ''
    number_re = re.compile(r'(?<!\\)\$(\d+(?:,\d{3})*(?:\.\d+)?)')

    def repl(m):
        amount = m.group(1)
        start = m.start()
        after = m.end()

        next_dollar = UNESCAPED_DOLLAR_RE.search(text, after)
        if next_dollar and (next_dollar.start() - after) <= 180:
            between = text[after:next_dollar.start()]
            if looks_mathish_segment(between):
                return m.group(0)
            if re.search(r'\s+[A-Za-z]{3,}', between):
                return f'\\${amount}'
            return m.group(0)

        tail = text[after:]
        next_char = re.search(r'\S', tail)
        if not next_char:
            return f'\\${amount}'

        ch = tail[next_char.start()]
        if ch in r'\^_{}=+-*/()[]':
            return m.group(0)
        if ch in '.,;:!?)':
            return f'\\${amount}'

        word = re.match(r'\s*([A-Za-z]+)', tail)
        if word:
            w = word.group(1).lower()
            if w in CURRENCY_WORDS or len(w) >= 2:
                return f'\\${amount}'
        return m.group(0)

    return number_re.sub(repl, text)


def repair_broken_dollar_escapes(s: str) -> str:
    s = s or ''

    def classify(seg: str) -> bool:
        text = (seg or '').strip()
        if not text:
            return False
        strong_math = re.search(r'\\[A-Za-z]+|[\\^_{}=+\-*/()<>!:]|(?:\d\.[A-Za-z])|(?:\d\s*:\s*\d)', text) is not None
        long_wordy = re.search(r'\s+[A-Za-z]{4,}', text) is not None
        if long_wordy and not strong_math:
            return False
        if strong_math:
            return True
        # Support short symbolic fragments like "3, 5, 7, a,".
        if re.search(r'\d', text) and re.search(r'(?:^|[\s,;])([A-Za-z])(?:$|[\s,;])', text):
            return True
        return False

    def repl_left(m):
        seg = (m.group(1) or '').strip()
        # If there is another unescaped '$' inside the span, this match crossed
        # multiple math regions and should be left unchanged.
        if re.search(r'(?<!\\)\$', seg):
            return m.group(0)
        if classify(seg):
            return f'${seg}$'
        # If this span includes prose, the consumed trailing '$' is likely
        # the start of the next math fragment (e.g., "... gave Sammy $t$ ...").
        if re.search(r'\s+[A-Za-z]{3,}', seg):
            return f'\\${seg}$'
        return f'\\${seg}'

    def repl_right(m):
        seg = (m.group(1) or '').strip()
        # If there is another unescaped '$' inside the span, this match crossed
        # multiple math regions and should be left unchanged.
        if re.search(r'(?<!\\)\$', seg):
            return m.group(0)
        if classify(seg):
            return f'${seg}$'
        return f'\\${seg}\\$'

    # Convert malformed escaped-open + closing-dollar spans.
    s = re.sub(r'(?<!\$)\\\$(.+?)(?<!\\)\$', repl_left, s)
    # Convert malformed opening-dollar + escaped-close spans.
    s = re.sub(r'(?<!\\)\$(.+?)\\\$', repl_right, s)
    return s


def normalize_mcq_fragment(s: str) -> str:
    s = strip_math_wrappers(s)
    s = normalize_latex_fragment(s)
    s = repair_broken_dollar_escapes(s)
    s = escape_likely_currency_dollars(s)
    s = re.sub(r'(?<=[A-Za-z])\\\$', r' \\$', s)
    s = re.sub(r'(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])', r' $', s)
    # Artifacts left from marker wrappers, e.g. "\ } 42" or "} 42".
    s = re.sub(r'^(?:\\\s*)?}\s*', '', s)
    s = re.sub(r'^(?:\\\s*)+', '', s)
    s = re.sub(r'^(\\qquad|\\quad|\\,|\s)+', '', s)
    s = re.sub(r'(\\qquad|\\quad|\s)+$', '', s)

    # Trim clearly dangling math mode markers.
    s = re.sub(r'(\\\[|\\\(|\\text\{|\\textbf\{|\\frac\{)\s*$', '', s).strip()

    # Common in AMIO rows: option block wrapped with a trailing '$' on the last choice.
    if count_unescaped_dollars(s) % 2 == 1:
        positions = [m.start() for m in UNESCAPED_DOLLAR_RE.finditer(s)]
        first_non_space = len(s) - len(s.lstrip())
        last_non_space = len(s.rstrip()) - 1
        if positions:
            if positions[-1] == last_non_space and positions[0] != first_non_space:
                s = remove_last_unescaped_dollar(s)
            elif positions[0] == first_non_space and positions[-1] != last_non_space:
                s = remove_first_unescaped_dollar(s)
            else:
                s = escape_last_unescaped_dollar(s)
    return s.strip(' .;:,')


def extract_asy_blocks(s: str):
    blocks = re.findall(r'\[asy\](.*?)\[/asy\]', s or '', flags=re.S)
    stripped = re.sub(r'\[asy\].*?\[/asy\]', ' ', s or '', flags=re.S)
    return stripped, [b.strip() for b in blocks if b.strip()]


def remove_media_noise(s: str) -> str:
    s = strip_math_wrappers(s)
    s = re.sub(r'\b\d{4}-AMC\d{1,2}[^\s]*\.png\b', ' ', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def png_dimensions(path: Path):
    try:
        with path.open('rb') as f:
            header = f.read(24)
        if len(header) < 24 or header[:8] != b'\x89PNG\r\n\x1a\n':
            return None, None
        # IHDR width/height are bytes 16..24 (big-endian uint32).
        w, h = struct.unpack('>II', header[16:24])
        return int(w), int(h)
    except Exception:
        return None, None


def has_explicit_asy_size(asy_code: str):
    return re.search(r'\b(?:size|unitsize|xsize|ysize)\s*\(', asy_code or '') is not None


def strip_asy_size_calls(asy_code: str):
    s = asy_code or ''
    # Remove explicit sizing calls so forced size() attempts can take effect.
    s = re.sub(r'\b(?:size|unitsize|xsize|ysize)\s*\([^;]*\)\s*;', '', s)
    return s


def resolve_asy_output_file(out_stem: Path, ext: str):
    direct = out_stem.with_suffix(f'.{ext}')
    doubled = out_stem.with_suffix(f'.{ext}.{ext}')
    if direct.exists():
        return direct
    if doubled.exists():
        doubled.replace(direct)
        return direct
    return None


def existing_diagram_assets(problem_id: str):
    assets = {}
    png = DIAGRAMS_DIR / f'{problem_id}.png'
    svg = DIAGRAMS_DIR / f'{problem_id}.svg'
    if png.exists():
        assets['png'] = f'assets/diagrams/{problem_id}.png'
    if svg.exists():
        assets['svg'] = f'assets/diagrams/{problem_id}.svg'
    return assets


def render_asy_assets(problem_id: str, asy_code: str):
    existing = existing_diagram_assets(problem_id)
    if not asy_code:
        return existing
    if not RENDER_ASY:
        return existing

    DIAGRAMS_DIR.mkdir(parents=True, exist_ok=True)
    ASYMPTOTE_HOME.mkdir(parents=True, exist_ok=True)

    asy_file = DIAGRAMS_DIR / f'{problem_id}.asy'
    out_stem = DIAGRAMS_DIR / f'{problem_id}'

    env = os.environ.copy()
    env['ASYMPTOTE_HOME'] = str(ASYMPTOTE_HOME.resolve())

    stripped_sizes = strip_asy_size_calls(asy_code)
    attempts = [
        asy_code,
        "size(14cm);\n" + stripped_sizes,
        "size(12cm);\n" + stripped_sizes,
        "size(10cm);\n" + stripped_sizes,
        asy_code
    ]
    # Deduplicate while preserving order.
    attempts = list(dict.fromkeys(attempts))

    best_png = None
    best_area = -1
    best_code = None

    for candidate in attempts:
        asy_file.write_text(candidate, encoding='utf-8')
        # clean stale output before each attempt
        for suffix in ['.png', '.png.png', '.svg', '.svg.svg']:
            (DIAGRAMS_DIR / f'{problem_id}{suffix}').unlink(missing_ok=True)

        try:
            proc_png = subprocess.run(
                ['asy', '-f', 'png', '-render', '4', '-antialias', '4', '-o', str(out_stem), str(asy_file)],
                env=env,
                capture_output=True,
                text=True,
                timeout=12
            )
        except subprocess.TimeoutExpired:
            continue
        except Exception:
            continue
        if proc_png.returncode != 0:
            continue

        png_file = resolve_asy_output_file(out_stem, 'png')
        if not png_file:
            continue

        w, h = png_dimensions(png_file)
        area = (w or 0) * (h or 0)
        if area > best_area:
            best_area = area
            best_png = png_file
            best_code = candidate

        # Prefer first non-tiny render and stop early.
        if (w and h) and (w >= 120 and h >= 80 and area >= 10000):
            break

    if not best_png:
        return {}

    # If we have a good render candidate, also emit SVG for crisp scaling.
    if best_code:
        asy_file.write_text(best_code, encoding='utf-8')
        try:
            subprocess.run(
                ['asy', '-f', 'svg', '-o', str(out_stem), str(asy_file)],
                env=env,
                capture_output=True,
                text=True,
                timeout=12
            )
        except subprocess.TimeoutExpired:
            pass
        except Exception:
            pass

    svg_file = resolve_asy_output_file(out_stem, 'svg')
    assets = {
        'png': f'assets/diagrams/{problem_id}.png'
    }
    if svg_file and svg_file.exists():
        assets['svg'] = f'assets/diagrams/{problem_id}.svg'

    # Keep .asy files only for failed outputs.
    if best_png.exists():
        asy_file.unlink(missing_ok=True)
    return assets


def parse_mcq(problem_text: str):
    text = remove_media_noise(problem_text)
    marker_re = re.compile(
        r'(?:\$?\s*\\[A-Za-z]+\s*\{\s*)?\(([A-E])\)\s*(?:\}\s*\$?)?'
    )
    matches = list(marker_re.finditer(text))
    if len(matches) < 5:
        return None, None

    target = None
    for i in range(len(matches) - 4):
        seq = ''.join(m.group(1) for m in matches[i:i+5])
        if seq == 'ABCDE':
            target = i
    if target is None:
        return None, None

    chosen = matches[target:target+5]
    prompt = text[:chosen[0].start()].strip()
    # Trim marker prelude fragments occasionally left before (A).
    prompt = re.sub(r'(?:\$?\s*\\[A-Za-z]+\s*\{\s*)+$', '', prompt).strip()
    prompt = normalize_mcq_fragment(prompt)
    prompt = restore_likely_missing_leading_article(prompt)
    choices = []
    for j, m in enumerate(chosen):
        start = m.end()
        end = chosen[j+1].start() if j < 4 else len(text)
        choice = text[start:end].strip()
        choice = normalize_mcq_fragment(choice)
        choices.append(choice)

    if not prompt or len(choices) != 5 or any(not c for c in choices):
        return None, None
    if not is_latex_balanced(prompt) or any(not is_latex_balanced(c) for c in choices):
        return None, None
    if prompt.endswith('\\[') or prompt.endswith('\\(') or prompt.endswith('\\text{') or prompt.endswith('\\textbf{'):
        return None, None
    if any(c.endswith('\\[') or c.endswith('\\(') or c.endswith('\\text{') or c.endswith('\\textbf{') for c in choices):
        return None, None
    # Reject clearly mangled fragments where "\" was dropped before text{}.
    if re.search(r'(^|[^\\])text\{', prompt) or re.search(r'(^|[^\\])textbf\{', prompt):
        return None, None
    if any(re.search(r'(^|[^\\])text\{', c) or re.search(r'(^|[^\\])textbf\{', c) for c in choices):
        return None, None
    return prompt, choices


def is_latex_balanced(s: str) -> bool:
    s = s or ''
    if s.count('{') != s.count('}'):
        return False
    if count_unescaped_dollars(s) % 2 != 0:
        return False
    if len(re.findall(r'\\\[', s)) != len(re.findall(r'\\\]', s)):
        return False
    if len(re.findall(r'\\\(', s)) != len(re.findall(r'\\\)', s)):
        return False
    return True


def parse_answer_for_mcq(ans: str, letter: str, choices):
    if letter and letter in ['A', 'B', 'C', 'D', 'E']:
        return ord(letter) - ord('A')

    a = clean_text(ans)
    normalized = [clean_text(c) for c in choices]
    if a in normalized:
        return normalized.index(a)

    a_num = a.replace(',', '')
    for i, c in enumerate(normalized):
        if c.replace(',', '') == a_num:
            return i
    return None


def parse_aime_answer(ans: str):
    a = clean_text(ans)
    if re.fullmatch(r'-?\d+', a):
        return int(a), None
    # handles cases like "080 or 081 (both were accepted)"
    alts = re.findall(r'\d+', a)
    if alts:
        vals = [int(x) for x in alts]
        return vals[0], vals
    return None, None


def amc8_weight(_link: str) -> int:
    return 5


# Group rows by problem id and keep first non-empty values
by_pid = {}
with SRC.open(newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        pid = row.get('problem_id', '').strip()
        if not pid:
            continue
        item = by_pid.setdefault(pid, {
            'problem_id': pid,
            'link': '',
            'problem': '',
            'answer': '',
            'letter': '',
            'solution': ''
        })
        for k in ['link', 'problem', 'answer', 'letter', 'solution']:
            v = (row.get(k) or '').strip()
            if v and not item[k]:
                item[k] = v

out = {'amc8': [], 'amc10': [], 'amc12': [], 'aime': []}

for pid, row in by_pid.items():
    c = contest_from_link(row['link'])
    if c is None:
        continue
    key, label, weight = c
    no_asy_problem, asy_blocks = extract_asy_blocks(row['problem'])
    clean_problem = remove_media_noise(no_asy_problem)
    diagram_assets = render_asy_assets(pid, asy_blocks[0]) if asy_blocks else {}

    if key in ['amc8', 'amc10', 'amc12']:
        prompt, choices = parse_mcq(clean_problem)
        if not prompt:
            continue
        answer_index = parse_answer_for_mcq(row['answer'], row['letter'], choices)
        if answer_index is None:
            continue
        obj = {
            'id': f'amio-{pid}',
            'type': 'mcq',
            'contest': key,
            'label': label,
            'weight': amc8_weight(row['link']) if key == 'amc8' else weight,
            'prompt': prompt,
            'choices': choices,
            'answerIndex': answer_index,
            'answerKey': 'ABCDE'[answer_index],
            'answer': choices[answer_index]
        }
        if diagram_assets.get('png'):
            obj['diagramPng'] = diagram_assets['png']
        if diagram_assets.get('svg'):
            obj['diagramSvg'] = diagram_assets['svg']
        out[key].append(obj)
    else:
        prompt = clean_problem
        if not prompt:
            continue
        prompt = repair_broken_dollar_escapes(prompt)
        prompt = escape_likely_currency_dollars(normalize_latex_fragment(prompt))
        prompt = re.sub(r'(?<=[A-Za-z])\\\$', r' \\$', prompt)
        prompt = re.sub(r'(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])', r' $', prompt)
        prompt = restore_likely_missing_leading_article(prompt)
        answer, accepted = parse_aime_answer(row['answer'])
        if answer is None:
            continue
        obj = {
            'id': f'amio-{pid}',
            'type': 'input',
            'contest': key,
            'label': label,
            'weight': weight,
            'prompt': prompt,
            'answer': answer
        }
        if diagram_assets.get('png'):
            obj['diagramPng'] = diagram_assets['png']
        if diagram_assets.get('svg'):
            obj['diagramSvg'] = diagram_assets['svg']
        if accepted and len(accepted) > 1:
            obj['acceptableAnswers'] = accepted
        out[key].append(obj)

OUT.mkdir(parents=True, exist_ok=True)
for k in ['amc8', 'amc10', 'amc12', 'aime']:
    # stable deterministic order
    out[k].sort(key=lambda x: x['id'])
    (OUT / f'{k}.json').write_text(json.dumps(out[k], indent=2) + '\n', encoding='utf-8')

print({k: len(v) for k, v in out.items()})
