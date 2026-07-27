#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function expectedReleaseTag(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Extension manifest must be a JSON object.");
  }
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    throw new Error("Extension manifest version must be a nonempty string.");
  }
  return `v${manifest.version.trim()}`;
}

function validateReleaseTag(tag, manifest) {
  const expected = expectedReleaseTag(manifest);
  const actual = String(tag || "").trim();
  if (actual !== expected) {
    throw new Error(
      `Release tag ${JSON.stringify(actual)} does not match manifest.json version; `
        + `expected ${JSON.stringify(expected)}. Update manifest.json or choose the matching tag.`
    );
  }
  return expected;
}

function main(argv) {
  const [tag, manifestArg = "manifest.json"] = argv;
  if (!tag) {
    console.error("Usage: node scripts/validate_release_tag.js TAG [MANIFEST_PATH]");
    return 2;
  }

  try {
    const manifestPath = path.resolve(manifestArg);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const validatedTag = validateReleaseTag(tag, manifest);
    console.log(`Release tag ${validatedTag} matches ${manifestArg}.`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

module.exports = {
  expectedReleaseTag,
  validateReleaseTag
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
