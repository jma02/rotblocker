#!/usr/bin/env python3
import csv
import json
import re
from pathlib import Path

SRC = Path('third_party/kaggle_aime/AIME_Dataset_1983_2024.csv')
DST = Path('data/aime.json')

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
            'answer': answer
        }
        if accepted:
            item['acceptableAnswers'] = accepted

        rows.append(item)

DST.write_text(json.dumps(rows, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {len(rows)} AIME problems to {DST}')
