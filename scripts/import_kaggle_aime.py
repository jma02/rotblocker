#!/usr/bin/env python3
import csv
import json
import re
from pathlib import Path

SRC = Path('third_party/kaggle_aime/AIME_Dataset_1983_2024.csv')
DST = Path('data/aime.json')

def make_hint(question: str) -> str:
    q = question.lower()
    if 'probability' in q:
        return 'Count favorable outcomes and total outcomes separately before simplifying the ratio.'
    if 'remainder' in q or 'mod' in q:
        return 'Use modular arithmetic to reduce large expressions before computing.'
    if 'gcd' in q or 'lcm' in q:
        return 'Prime-factorize each number first, then compare prime powers carefully.'
    if 'triangle' in q or 'circle' in q or 'perimeter' in q or 'area' in q:
        return 'Draw a diagram and label known quantities before writing equations.'
    if 'root' in q or 'equation' in q:
        return 'Rewrite the condition into a standard algebraic form, then solve systematically.'
    if 'sequence' in q or 'series' in q:
        return 'Look for a pattern in the first few terms and express it algebraically.'
    if 'digit' in q or 'integer' in q:
        return 'Use place value constraints and parity/divisibility to narrow possibilities.'
    return 'Identify the target quantity, define variables clearly, and break the problem into smaller claims.'

rows = []
with SRC.open(newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for i, r in enumerate(reader, start=1):
        year = (r.get('Year') or '').strip()
        part = (r.get('Part') or '').strip()
        num = (r.get('Problem Number') or '').strip()
        q = (r.get('Question') or '').strip()
        ans_raw = (r.get('Answer') or '').strip()
        rid = (r.get('ID') or f'kaggle-aime-{i}').strip()

        accepted = []
        if ans_raw == '080 or 081 (both were accepted)':
            accepted = [80, 81]
            answer = 80
        else:
            m = re.fullmatch(r'-?\d+', ans_raw)
            if not m:
                continue
            answer = int(ans_raw)

        label = 'AIME'
        if year and part:
            label = f'AIME {year} {part}'

        prompt = q
        if year or part or num:
            meta = ' '.join(x for x in [year, part, f'#{num}' if num else ''] if x)
            prompt = f'[{meta}] {q}'

        item = {
            'id': f'kaggle-{rid}',
            'type': 'input',
            'label': label,
            'weight': 60,
            'prompt': prompt,
            'answer': answer,
            'hint': make_hint(q)
        }
        if accepted:
            item['acceptableAnswers'] = accepted

        rows.append(item)

DST.write_text(json.dumps(rows, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {len(rows)} AIME problems to {DST}')
