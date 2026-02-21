# rotblocker++

`rotblocker++` is a Chrome MV3 extension that blocks distracting sites until you earn enough points by solving contest-style math problems.

Default blocked domains:
- `twitter.com`
- `x.com`
- `linkedin.com`

You can also add/remove custom blocked domains from:
- popup `Settings` tab
- challenge-page `Settings` modal

## Core Behavior
- Locked mode redirects blocked domains to `rotblocker++/index.html`.
- You earn score by solving problems (AMC8/10/12 + AIME pools).
- Unlock threshold is `30` points.
- Unlock cooldown defaults to `2 hours` and is configurable in settings.
- On unlock, score resets to `0`.
- On manual relock, score resets to `0`.
- XP + prestige progression is tracked separately from score.

## Scoring Model
- Base weights:
  - `AMC8`: `5`
  - `AMC10`: `8`
  - `AMC12`: `12`
  - `AIME`: `30`
- Time decay:
  - `AMC8`: 6 min linear decay to `0`
  - `AMC10`: 8 min linear decay to `0`
  - `AMC12`: 10 min linear decay to `0`
  - `AIME`: no decay
- MCQ guess multipliers: `1.0`, `0.1`, `0.02`, `0`, `0`
- Wrong-guess penalties:
  - 2nd wrong: `-1.00`
  - 3rd wrong: `-3.00`
  - 4th wrong: `-6.00`

## AI Tutor (Optional)
- Built-in tutor panel (`PoBot`) supports:
  - OpenAI (`https://api.openai.com`)
  - OpenRouter (`https://openrouter.ai`)
- User-provided provider/model/token.
- AI config is stored locally and synced through Chrome profile storage when available.
- Model lists are cached for 6 hours.

## Sync Model
- Uses `chrome.storage.sync` (Chrome profile sync).
- Sync state includes:
  - score/xp/prestige
  - unlocked timer state
  - lockout cooldown
  - custom blocked domains
- Conflict resolution is timestamp-based (`stateUpdatedAt` and domain-specific timestamps).

## Repository Layout
- `manifest.json`: extension metadata and permissions
- `background.js`: lock/unlock state machine, sync reconciliation, custom domain dynamic rules
- `rules.json`: static redirect rules for default blocked domains
- `rotblocker++/index.html`: primary challenge UI entry
- `challenge.js`, `challenge.css`, `scoring.js`: challenge engine, UI, scoring API
- `popup.html`, `popup.js`, `popup.css`: extension popup UI
- `data/*.json`: bundled problem banks and reports
- `scripts/*`: dataset import/rewrite/generation and packaging utilities
- `tests/*.test.js`: unit/integration/property/smoke tests
- `.github/workflows/*`: CI + release automation

## Local Development
### Prerequisites
- Node.js (project CI uses Node `20`)
- Python 3 (for preview server and data scripts)

### Install
```bash
npm install
```

### Run Tests
```bash
npm test
```

### Local Preview
```bash
npm run preview
```
Open:
- `http://localhost:4173/rotblocker++/index.html`

## NPM Scripts
- `npm test`
  - Runs all Node-based tests.
- `npm run preview`
  - Starts local static server on port `4173`.
- `npm run audit:problems`
  - Audits dataset/problem markup quality.
- `npm run rewrite:gre`
  - Rewrites GRE upper-level MCQ data offline.
- `npm run generate:calculus`
  - Generates synthetic calculus dataset.
- `npm run build:artifacts`
  - Runs calculus generation + artifact packaging pipeline.

## Build And Release
### Local Release Zip
```bash
bash scripts/build-release.sh
```
Produces:
- `dist/rotblocker-plusplus-v<version>.zip`

### GitHub Actions
- CI workflow: `.github/workflows/ci.yml`
  - Runs full tests
  - Builds zip artifact
  - Uploads zip artifact to workflow run
  - Runs Playwright browser smoke test
- Release workflow: `.github/workflows/release.yml`
  - Triggered by tag push `v*` (and manual dispatch)
  - Runs tests
  - Builds zip
  - Publishes GitHub Release with attached zip

## Browser Smoke Test Notes
The smoke test file is:
- `tests/browser-smoke.test.js`

Locally it may skip unless Playwright + Chromium are installed:
```bash
npm install --no-save playwright
npx playwright install chromium
node --test tests/browser-smoke.test.js
```

## Data/Artifact Pipeline Notes
`npm run build:artifacts` currently writes generated outputs such as:
- `data/calculus_mcq_synthetic.json`
- `artifacts/calculus_mcq_v3.json`
- `artifacts/gre_math_mcq_v3.json`
- `artifacts/manifest_v3.json`
- `artifacts/rejects_v3.json`

Example strict GRE source policy:
```bash
python3 scripts/generate_artifacts.py --version v3 --gre-source-policy grepractice_only
```

## Git Tracking Conventions
Recommended:
- ignore `node_modules/`
- ignore `dist/`
- usually ignore `artifacts/` (generated outputs)

Keep tracked:
- `package.json`
- `package-lock.json`
- extension/runtime source
- shipped dataset files under `data/`

## Load In Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository root

## Notes
- Canonical project name is `rotblocker++`.
- Keep folder/path references synchronized with `rules.json`, `manifest.json`, and entrypoint URLs when renaming.
