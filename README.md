# rotblocker++

`rotblocker++` is a Chrome MV3 extension that blocks distracting sites until you earn enough points by solving contest-style math problems.
<img width="1728" height="1083" alt="image" src="https://github.com/user-attachments/assets/d95e0fcf-6032-449e-88cf-151f8faa7968" />

Default blocked domains:
- `twitter.com`
- `x.com`
- `linkedin.com`

You can also add/remove custom blocked domains from:
- popup `Settings` tab
- challenge-page `Settings` modal

## Installation Instructions
I don't plan to add this to the web store as the problems are technically licensed, but the installation is more or less painless.

### 1. Download the [latest release](https://github.com/jma02/rotblocker/releases).
There is a Firefox version of this app that I had Codex build but I think you need to use the Developer distribution of Firefox, which honestly isn't ideal.

### 2. After unzipping the project, press this button in Chrome:
<img width="436" height="437" alt="image" src="https://github.com/user-attachments/assets/fa481aca-0744-440c-bbcb-9de32b91f134" />

### 3. Now you should be in this menu:
<img width="1914" height="530" alt="image" src="https://github.com/user-attachments/assets/d330a074-659d-4ab5-97ea-eb0dbdae0364" />
Be sure to *enable Developer Mode*.

### 4. Click **Load unpacked**, you'll be prompted to use your OS's file explorer to select a folder. Select the project we just unzipped.
### 5. Done!

## Core Behavior
- Locked mode redirects blocked domains to `rotblocker++/index.html`.
- You earn score by solving problems (AMC8/10/12, AIME, and optional Olympiad pools).
- The Olympiad pool contains three sourced, translation-reviewed numeric problems each from China, Poland, Russia, and the USAMO.
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
  - `Olympiad`: `30`
- Time decay:
  - `AMC8`: 6 min linear decay to `0`
  - `AMC10`: 8 min linear decay to `0`
  - `AMC12`: 10 min linear decay to `0`
  - `AIME`: no decay
  - `Olympiad`: no decay
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
python3 -m pip install -r requirements.txt
```

### Run Tests
```bash
npm test
npm run test:data-python
npm run audit:problems
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
- `npm run test:data-python`
  - Runs the Python data-normalizer regression tests.
- `npm run preview`
  - Starts local static server on port `4173`.
- `npm run audit:problems`
  - Audits dataset/problem markup quality.
- `npm run audit:problems:strict`
  - Treats non-fatal dataset audit warnings as failures.
- `npm run rewrite:gre`
  - Writes a non-production GRE cleanup preview without modifying the curated
    44-row bank.
- `npm run generate:calculus`
  - Generates synthetic calculus dataset.
- `npm run build:artifacts`
  - Regenerates calculus, normalizes all shipped banks, then packages the
    versioned artifacts.

## Build And Release
### Local Release Zip
```bash
npm run build:chrome
npm run build:firefox
```
Produces:
- `dist/rotblocker-plusplus-chrome-v<version>.zip`
- `dist/rotblocker-plusplus-firefox-v<version>.zip`

### GitHub Actions
- CI workflow: `.github/workflows/ci.yml`
  - Runs Node and Python tests plus the problem-data audit
  - Builds Chrome and Firefox zip artifacts
  - Uploads both zip artifacts to the workflow run
  - Runs Playwright browser smoke test
- Release workflow: `.github/workflows/release.yml`
  - Triggered by tag push `v*` (and manual dispatch)
  - Requires the resolved `v*` tag to match the version in `manifest.json`
  - Runs Node and Python tests plus the problem-data audit
  - Builds reproducible Chrome and Firefox zips
  - Publishes a GitHub Release with both zips attached

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
Normalize imported or generated problem banks before committing them:
```bash
python3 scripts/normalize_problem_data.py --check
python3 scripts/normalize_problem_data.py --write
```
`--check` is the non-mutating CI check. `--write` applies deterministic
normalization and refreshes the cleanup report.

`npm run build:artifacts` currently writes generated outputs such as:
- `data/calculus_mcq_synthetic.json`
- `artifacts/calculus_mcq_v3.json`
- `artifacts/gre_math_mcq_v3.json`
- `artifacts/manifest_v3.json`
- `artifacts/rejects_v3.json`

Only the validated current v3 artifact set is kept in the repository. Obsolete
v1/v2/v99/v100 snapshots were removed because they duplicated pre-verification
GRE rows or the retired untrusted calculus extraction.

### Calculus data integrity

`data/calculus_mcq.json` is an intentionally empty retirement placeholder. Its
former importer read a solved-problem book that contains no multiple-choice
options, synthesized every distractor, and could mistake OCR intermediate
values for final answers. The old 144-row extraction is therefore quarantined
rather than shipped. `scripts/import_calculus_pdf_mcq.py` now writes only
explicitly unverified research output and cannot overwrite the active bank.

The supported 320-row calculus bank is
`data/calculus_mcq_synthetic.json`; the release pipeline publishes its validated
v3 artifact.

Example strict GRE source policy:
```bash
python3 scripts/generate_artifacts.py --version v3 --gre-source-policy grepractice_only
```

## Git Tracking Conventions
Recommended:
- ignore `node_modules/`
- ignore `dist/`
- ignore Python bytecode and `__pycache__/`

Keep tracked:
- `package.json`
- `package-lock.json`
- extension/runtime source
- shipped dataset files under `data/`
- versioned outputs under `artifacts/` and their generated diagram assets; review
  these diffs whenever the artifact pipeline is intentionally regenerated

## Notes
- Canonical project name is `rotblocker++`.
- Keep folder/path references synchronized with `rules.json`, `manifest.json`, and entrypoint URLs when renaming.
