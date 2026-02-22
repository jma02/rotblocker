const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function readAppSource() {
  return [
    "challenge-modules/constants.js",
    "challenge-modules/dom.js",
    "challenge-modules/math.js",
    "challenge-modules/sync.js",
    "challenge-modules/tutor.js",
    "challenge.js",
    "challenge-modules/gameplay.js",
    "challenge-modules/bootstrap.js"
  ].map(readText).join("\n");
}

test("dataset loading avoids forced no-store cache busting", () => {
  const source = readAppSource();
  assert.doesNotMatch(source, /fetch\(p,\s*\{\s*cache:\s*"no-store"\s*\}\)/);
  assert.match(source, /const res = await fetch\(p\)/);
});

test("tick UI interval is reduced to 1 second", () => {
  const source = readAppSource();
  assert.match(source, /UI_TICK_INTERVAL_MS\s*=\s*1000/);
  assert.match(source, /uiTickIntervalId = setInterval\(tickUi,\s*UI_TICK_INTERVAL_MS\)/);
  assert.match(source, /function stopUiTickLoop\(\)/);
});

test("problem banks are loaded lazily from enabled pools first", () => {
  const source = readAppSource();
  assert.match(source, /\bfunction prepareProblemForBank\(problem\)/);
  assert.match(source, /\bfunction loadPoolBank\(poolKey\)/);
  assert.match(source, /const initialKeys = Object\.keys\(poolEnabled\)\.filter\(\(key\) => poolEnabled\[key\]\)/);
  assert.match(source, /await Promise\.all\(initialKeys\.map\(async \(poolKey\) =>/);
  assert.match(source, /const prepared = prepareProblemForBank\(row\)/);
  assert.match(source, /const dedupeKey = String\(prepared\.id \|\| prepared\.__sanitizedPrompt\.toLowerCase\(\)\)/);
});

test("enabling a disabled pool lazy-loads its dataset", () => {
  const source = readAppSource();
  assert.match(source, /if \(!poolLoaded\[key\]\) {/);
  assert.match(source, /const available = await loadPoolBank\(key\)/);
});

test("rendering reuses precomputed prompt and choice text", () => {
  const source = readAppSource();
  assert.match(source, /renderMathText\(problemEl, getSanitizedPrompt\(currentProblem\)\)/);
  assert.match(source, /const normalizedChoices = getNormalizedChoices\(currentProblem\)/);
  assert.match(source, /const choices = getSanitizedChoices\(currentProblem\)/);
});

test("non-critical startup work is deferred until after first render", () => {
  const source = readAppSource();
  assert.match(source, /\bfunction runWhenIdle\(task,\s*timeout = 1200\)/);
  assert.match(source, /(?:runWhenIdle\(async \(\) => {\s*await initCloudSync\(\);|tutorApi\.runWhenIdle\(async \(\) => {\s*await syncApi\.initCloudSync\?\.\(\);)/);
  assert.match(source, /(?:if \(tutorVisibleOnInit\) {\s*runWhenIdle\(async \(\) => {\s*await ensureTutorUiInitialized\(\);|if \(tutorVisibleOnInit\) {\s*tutorApi\.runWhenIdle\(async \(\) => {\s*await tutorApi\.ensureTutorUiInitialized\?\.\(\);)/);
  assert.doesNotMatch(source, /await initCloudSync\(\);\s*nextProblem\(\);/);
});

test("sync diagnostics polling is adaptive and visibility-aware", () => {
  const source = readAppSource();
  assert.match(source, /SYNC_DIAGNOSTICS_FAST_MS\s*=\s*5000/);
  assert.match(source, /SYNC_DIAGNOSTICS_SLOW_MS\s*=\s*30000/);
  assert.match(source, /\bfunction desiredSyncDiagnosticsIntervalMs\(status\)/);
  assert.match(source, /\bfunction restartSyncDiagnosticsPolling\(\)/);
  assert.match(source, /\bfunction handleVisibilityPerformanceMode\(\)/);
  assert.match(source, /if \(isDocumentVisible\(\)\) {/);
  assert.match(source, /stopSyncDiagnosticsPolling\(\);/);
});

test("tutor ui initialization is lazy and one-time", () => {
  const source = readAppSource();
  assert.match(source, /let tutorUiInitialized = false;/);
  assert.match(source, /\bfunction initTutorUi\(\)\s*{\s*if \(tutorUiInitialized\) return;/);
  assert.match(source, /\basync function ensureTutorUiInitialized\(\)\s*{\s*if \(tutorUiInitialized\) return;/);
});

test("performance telemetry marks startup and tutor initialization", () => {
  const source = readAppSource();
  assert.match(source, /\bfunction perfMark\(name\)/);
  assert.match(source, /\bfunction perfMeasure\(name,\s*startMark,\s*endMark = undefined\)/);
  assert.match(source, /perfMeasure\("init:first_problem_render_ms", "init:first_problem_start", "init:first_problem_end"\)/);
  assert.match(source, /perfMeasure\("tutor:init_ms", "tutor:init_start", "tutor:init_end"\)/);
});

test("diagram image uses lazy loading and async decoding", () => {
  const html = readText("rotblocker++/index.html");
  assert.match(html, /id="diagram-img"[^>]*loading="lazy"/);
  assert.match(html, /id="diagram-img"[^>]*decoding="async"/);
});

test("release packaging excludes legacy entry html and asy sources", () => {
  const script = readText("scripts/build-release.sh");
  assert.doesNotMatch(script, /\schallenge\.html\s/);
  assert.match(script, /-x "\*\.DS_Store" "assets\/diagrams\/\*\.asy"/);
  assert.doesNotMatch(script, /katex/i);
});

test("release packaging whitelists only runtime data banks", () => {
  const script = readText("scripts/build-release.sh");
  assert.match(script, /DATA_FILES=\(/);
  assert.match(script, /"data\/amc8\.json"/);
  assert.match(script, /"data\/amc10\.json"/);
  assert.match(script, /"data\/amc12\.json"/);
  assert.match(script, /"data\/aime\.json"/);
  assert.match(script, /"data\/upper_level_mcq\.json"/);
  assert.match(script, /"data\/calculus_mcq_synthetic\.json"/);
  assert.doesNotMatch(script, /"data"\s*$/m);
});

test("background sync reconciliation avoids JSON stringify comparisons", () => {
  const source = readText("background.js");
  assert.match(source, /\bfunction syncPayloadEquals\(leftPayload,\s*rightPayload\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(localPayload\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(remotePayload\)/);
});
