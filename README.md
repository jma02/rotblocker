# rotblocker++

`rotblocker++` is a Chrome extension that blocks distracting sites until you earn points by solving contest-style math problems.

Blocked domains:
- `twitter.com`
- `x.com`
- `linkedin.com`

You can also add custom domains from the popup **Settings** tab or the challenge page **Settings** gear button.

## How It Works
- While locked, visits to blocked domains are redirected to the challenge page.
- Solve problems to earn score.
- Reach `30` score to unlock blocked domains.
- Unlock duration defaults to `2 hours` and can be changed in challenge-page `Settings`.
- When unlock expires, sites are locked again automatically.

Score is reset to `0` when you unlock (and also on manual relock).

## Challenge + Progression
Problem pools:
- `AMC8` (base `5`)
- `AMC10` (base `8`)
- `AMC12` (base `12`)
- `AIME` (base `30`)

Scoring behavior:
- Linear time decay to `0`:
  - `AMC8`: 6 minutes
  - `AMC10`: 8 minutes
  - `AMC12`: 10 minutes
  - `AIME`: no decay
- MCQ guess multipliers: `1.0`, `0.1`, `0.02`, `0`, `0`
- Wrong-guess penalties:
  - 2nd wrong guess: `-1.00`
  - 3rd wrong guess: `-3.00`
  - 4th wrong guess: `-6.00`

XP + prestige:
- Positive score gains award XP.
- Level formula: `floor(sqrt(xp / 25)) + 1`
- Prestige unlocks at level `10`.
- Prestiging resets score + XP and increases future XP gain by `+5%` per prestige.

## AI Tutor (Optional)
The challenge page includes an in-app tutor panel (`PoBot`) that can use:
- OpenAI (`https://api.openai.com`)
- OpenRouter (`https://openrouter.ai`)

Notes:
- You provide your own API token in the UI.
- Provider/model/token are stored in `chrome.storage.local`.
- Model list responses are cached for 6 hours.

## Cloud Sync (Automatic)
Cloud save uses `chrome.storage.sync` (tied to the user’s signed-in Chrome profile) for:
- `score`
- `xp`
- `prestige`
- `unlockedUntil`
- custom blocked domains

Sync is timestamp-based (`stateUpdatedAt`) to resolve local/cloud conflicts.

## Project Structure
- `manifest.json`: Chrome MV3 manifest + permissions
- `background.js`: lock/unlock state machine, alarms, score/xp/prestige state
- `rules.json`: declarativeNetRequest redirect rules
- `rotblocker++/index.html`: full challenge UI entry
- `challenge.js`, `challenge.css`, `scoring.js`: challenge logic + scoring + UI
- `popup.html`, `popup.js`, `popup.css`: browser action popup
- `data/*.json`: bundled contest datasets
- `tests/*.test.js`: Node test suite

## Local Development
1. Install deps:
```bash
npm install
```
2. Run tests:
```bash
npm test
```
3. Run local preview server:
```bash
npm run preview
```
4. Open:
- `http://localhost:4173/rotblocker++/index.html`

The challenge UI has an in-browser fallback mode for local preview (without extension APIs).

## Offline Dataset Artifacts
Generate a clean synthetic Calculus set + versioned artifacts:
```bash
npm run build:artifacts
```

Outputs:
- `data/calculus_mcq_synthetic.json`
- `artifacts/calculus_mcq_v3.json`
- `artifacts/gre_math_mcq_v3.json`
- `artifacts/manifest_v3.json`
- `artifacts/rejects_v3.json`

Stricter GRE source mode (keep only `GREpractice` rows):
```bash
python3 scripts/generate_artifacts.py --version v3 --gre-source-policy grepractice_only
```

## Load In Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Notes
- Project naming is normalized to `rotblocker++`; keep `rules.json`, build scripts, and redirect paths in sync if you rename folders.
