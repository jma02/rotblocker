const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  expectedReleaseTag,
  validateReleaseTag
} = require("../scripts/validate_release_tag");

const SCRIPT = path.resolve(__dirname, "..", "scripts", "validate_release_tag.js");
const TARGET_SCRIPT = path.resolve(
  __dirname,
  "..",
  "scripts",
  "verify_release_tag_target.sh"
);
const WORKFLOW = path.resolve(__dirname, "..", ".github", "workflows", "release.yml");

function extractWorkflowRunSources(workflow) {
  const lines = String(workflow || "").split(/\r?\n/);
  const sources = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const inline = match[2].trim();
    if (inline && inline !== "|" && inline !== ">") {
      sources.push(inline);
      continue;
    }
    const body = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      const nextIndent = next.match(/^\s*/)?.[0].length || 0;
      if (next.trim() && nextIndent <= indent) break;
      index += 1;
      body.push(next);
    }
    sources.push(body.join("\n"));
  }
  return sources;
}

function extractBlockRun(stepSource) {
  const match = String(stepSource || "").match(/(?:^|\n)(\s*)run:\s*\|\n([\s\S]*)$/);
  assert.ok(match, "expected a block run script");
  const bodyIndent = " ".repeat(match[1].length + 2);
  return match[2]
    .split(/\r?\n/)
    .map((line) => line.startsWith(bodyIndent) ? line.slice(bodyIndent.length) : line)
    .join("\n")
    .trimEnd();
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`
  );
  return result.stdout.trim();
}

test("release tag validator derives and accepts the manifest version", () => {
  const manifest = { version: "1.2.3" };
  assert.equal(expectedReleaseTag(manifest), "v1.2.3");
  assert.equal(validateReleaseTag("v1.2.3", manifest), "v1.2.3");
});

test("release tag validator rejects a tag/version mismatch through its CLI", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-release-tag-"));
  const manifestPath = path.join(tempDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ version: "1.2.3" })}\n`);

  const result = spawnSync(
    process.execPath,
    [SCRIPT, "v1.2.4", manifestPath],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match manifest\.json version/);
  assert.match(result.stderr, /v1\.2\.3/);
});

test("manual release defaults to manifest version and validates an explicit tag", () => {
  const workflow = fs.readFileSync(WORKFLOW, "utf8");
  const resolveStart = workflow.indexOf("- name: Resolve release metadata");
  const validateStart = workflow.indexOf("- name: Verify release tag matches extension version");
  const createTagStart = workflow.indexOf("- name: Create and push release tag");

  assert.ok(resolveStart >= 0, "release metadata step must exist");
  assert.ok(validateStart > resolveStart, "tag validation must follow metadata resolution");
  assert.ok(createTagStart > validateStart, "tag validation must precede tag creation");
  assert.doesNotMatch(workflow, /^\s+bump:/m);
  assert.match(workflow, /Defaults to the version in manifest\.json\./);
  assert.doesNotMatch(
    extractWorkflowRunSources(workflow).join("\n"),
    /\$\{\{/,
    "GitHub expression values must enter shell steps through env, never source interpolation"
  );

  const resolveStep = workflow.slice(resolveStart, validateStart);
  assert.match(resolveStep, /EVENT_NAME:\s*\$\{\{ github\.event_name \}\}/);
  assert.match(resolveStep, /DISPATCH_TAG_NAME:\s*\$\{\{ github\.event\.inputs\.tag_name \}\}/);
  assert.match(resolveStep, /DISPATCH_PRERELEASE:\s*\$\{\{ github\.event\.inputs\.prerelease \}\}/);
  assert.match(resolveStep, /DISPATCH_GENERATE_NOTES:\s*\$\{\{ github\.event\.inputs\.generate_notes \}\}/);
  assert.match(resolveStep, /TAG="\$\{DISPATCH_TAG_NAME\}"/);
  assert.match(
    resolveStep,
    /MANIFEST_VERSION="\$\(node -p "require\('\.\/manifest\.json'\)\.version"\)"/
  );
  assert.match(resolveStep, /TAG="v\$\{MANIFEST_VERSION\}"/);
  assert.match(resolveStep, /printf 'tag_name=%s\\n' "\$\{TAG\}"/);

  const validateStep = workflow.slice(validateStart, createTagStart);
  assert.match(validateStep, /RELEASE_TAG:\s*\$\{\{ steps\.release_meta\.outputs\.tag_name \}\}/);
  assert.match(validateStep, /"\$\{RELEASE_TAG\}"/);
  assert.match(validateStep, /scripts\/validate_release_tag\.js/);

  const createTagStep = workflow.slice(createTagStart);
  assert.match(createTagStep, /TAG="\$\{RELEASE_TAG\}"/);
  assert.match(
    createTagStep,
    /bash scripts\/verify_release_tag_target\.sh "\$\{TAG\}" "\$\{GITHUB_SHA\}"/
  );
});

test("release metadata treats hostile dispatch input as inert data", () => {
  const workflow = fs.readFileSync(WORKFLOW, "utf8");
  const resolveStart = workflow.indexOf("- name: Resolve release metadata");
  const validateStart = workflow.indexOf("- name: Verify release tag matches extension version");
  const resolveScript = extractBlockRun(workflow.slice(resolveStart, validateStart));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-release-env-"));
  const outputPath = path.join(tempDir, "github-output.txt");
  const markerPath = path.join(tempDir, "must-not-exist");
  const hostileTag = `v1.2.3"; touch "${markerPath}"; printf '%s' "$(id)" #`;

  const result = spawnSync(
    "bash",
    ["-eu", "-o", "pipefail", "-c", resolveScript],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        EVENT_NAME: "workflow_dispatch",
        DISPATCH_TAG_NAME: hostileTag,
        DISPATCH_PRERELEASE: "true",
        DISPATCH_GENERATE_NOTES: "false",
        GITHUB_REF_NAME: "",
        GITHUB_OUTPUT: outputPath
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(markerPath), false, "hostile tag text must never execute");
  assert.deepEqual(
    fs.readFileSync(outputPath, "utf8").trimEnd().split("\n"),
    [
      `tag_name=${hostileTag}`,
      "create_tag=true",
      "prerelease=true",
      "generate_notes=false"
    ]
  );

  const newlineOutputPath = path.join(tempDir, "newline-output.txt");
  const newlineResult = spawnSync(
    "bash",
    ["-eu", "-o", "pipefail", "-c", resolveScript],
    {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        EVENT_NAME: "workflow_dispatch",
        DISPATCH_TAG_NAME: "v1.2.3\ncreate_tag=false",
        DISPATCH_PRERELEASE: "false",
        DISPATCH_GENERATE_NOTES: "true",
        GITHUB_REF_NAME: "",
        GITHUB_OUTPUT: newlineOutputPath
      }
    }
  );
  assert.equal(newlineResult.status, 1);
  assert.match(newlineResult.stdout, /cannot contain line breaks/);
  assert.equal(fs.existsSync(newlineOutputPath), false);
});

test("existing release tags must dereference to the current commit", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-release-target-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Release Test");
  git(repo, "config", "user.email", "release-test@example.invalid");
  git(repo, "commit", "--allow-empty", "-m", "first");
  const firstSha = git(repo, "rev-parse", "HEAD");
  git(repo, "tag", "v1.2.3-lightweight", firstSha);
  git(repo, "tag", "-a", "v1.2.3-annotated", "-m", "annotated", firstSha);

  for (const tag of ["v1.2.3-lightweight", "v1.2.3-annotated"]) {
    const matching = spawnSync(
      "bash",
      [TARGET_SCRIPT, tag, firstSha],
      { cwd: repo, encoding: "utf8" }
    );
    assert.equal(matching.status, 0, matching.stderr);
    assert.match(matching.stdout, /already points to current commit/);
  }

  git(repo, "commit", "--allow-empty", "-m", "second");
  const secondSha = git(repo, "rev-parse", "HEAD");

  for (const tag of ["v1.2.3-lightweight", "v1.2.3-annotated"]) {
    const mismatched = spawnSync(
      "bash",
      [TARGET_SCRIPT, tag, secondSha],
      { cwd: repo, encoding: "utf8" }
    );
    assert.equal(mismatched.status, 1);
    assert.match(mismatched.stderr, /resolves to/);
    assert.match(mismatched.stderr, new RegExp(firstSha));
    assert.match(mismatched.stderr, new RegExp(secondSha));
  }
});
