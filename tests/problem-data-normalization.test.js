const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("shipped problem banks are in deterministic normalized form", () => {
  const root = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.env.PYTHON || "python3",
    ["scripts/normalize_problem_data.py", "--check"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1"
      },
      maxBuffer: 4 * 1024 * 1024
    }
  );

  assert.equal(
    result.status,
    0,
    [
      "problem-data normalization check failed",
      result.error ? String(result.error) : "",
      result.stderr || "",
      (result.stdout || "").slice(-8000)
    ].filter(Boolean).join("\n")
  );

  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.latestNormalizationChanges, {});
  assert.deepEqual(report.latestChangedFiles, []);
  assert.deepEqual(report.issueCounts, {});
});

test("normalizer write reaches a stable, checkable fixed point", (t) => {
  const root = path.resolve(__dirname, "..");
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "rotblocker-normalizer-")
  );
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  fs.mkdirSync(path.join(fixtureRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "data"), { recursive: true });
  fs.copyFileSync(
    path.join(root, "scripts", "normalize_problem_data.py"),
    path.join(fixtureRoot, "scripts", "normalize_problem_data.py")
  );

  const filenames = [
    "aime.json",
    "amc8.json",
    "amc10.json",
    "amc12.json",
    "calculus_mcq.json",
    "calculus_mcq_synthetic.json",
    "olympiad.json",
    "upper_level_mcq.json"
  ];
  for (const filename of filenames) {
    const rows = filename === "amc10.json"
      ? [{
          id: "fixture-normalization",
          type: "mcq",
          prompt: "Choose a value.",
          choices: ["frac12", "0", "1", "2", "3"],
          answerIndex: 0,
          answerKey: "A",
          answer: "frac12"
        }]
      : [];
    fs.writeFileSync(
      path.join(fixtureRoot, "data", filename),
      `${JSON.stringify(rows, null, 2)}\n`
    );
  }

  const runNormalizer = (mode) => spawnSync(
    process.env.PYTHON || "python3",
    ["scripts/normalize_problem_data.py", mode],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1"
      },
      maxBuffer: 4 * 1024 * 1024
    }
  );

  const firstWrite = runNormalizer("--write");
  assert.equal(firstWrite.status, 0, firstWrite.stderr);
  const firstReport = JSON.parse(firstWrite.stdout);
  assert.ok(firstReport.latestNormalizationChanges.fraction_commands > 0);
  const firstBanks = filenames.map((filename) =>
    fs.readFileSync(path.join(fixtureRoot, "data", filename), "utf8")
  );

  const secondWrite = runNormalizer("--write");
  assert.equal(secondWrite.status, 0, secondWrite.stderr);
  const secondReport = JSON.parse(secondWrite.stdout);
  assert.deepEqual(secondReport.latestNormalizationChanges, {});
  assert.deepEqual(secondReport.latestChangedFiles, []);
  assert.deepEqual(
    filenames.map((filename) =>
      fs.readFileSync(path.join(fixtureRoot, "data", filename), "utf8")
    ),
    firstBanks
  );

  const check = runNormalizer("--check");
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(JSON.parse(check.stdout), secondReport);
});

test("generated parabola labels use sign-aware vertex form", () => {
  const root = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.env.PYTHON || "python3",
    [
      "-c",
      [
        "import random, sys",
        "sys.path.insert(0, 'scripts')",
        "from generate_calculus_synthetic import gen_plot_parabola_fact",
        "svgs = [gen_plot_parabola_fact(i, random.Random(i))['_diagramSvgContent'] for i in range(100)]",
        "assert all('(x--' not in svg for svg in svgs)",
        "assert any('(x+' in svg for svg in svgs)"
      ].join("; ")
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1"
      }
    }
  );

  assert.equal(
    result.status,
    0,
    result.error ? String(result.error) : result.stderr
  );
});
