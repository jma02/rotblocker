#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DIAGRAM_FIELDS = Object.freeze([
  ["diagramPng", false],
  ["diagramSvg", false],
  ["diagramPngs", true],
  ["diagramSvgs", true]
]);

function validateDiagramPath(value, sourceLabel = "problem data") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid diagram path in ${sourceLabel}: ${JSON.stringify(value)}`);
  }

  const rel = value.trim();
  const pathParts = rel.split("/");
  if (
    path.isAbsolute(rel)
    || path.win32.isAbsolute(rel)
    || rel.includes("\\")
    || pathParts.includes(".")
    || pathParts.includes("..")
  ) {
    throw new Error(`Unsafe diagram path in ${sourceLabel}: ${JSON.stringify(value)}`);
  }

  if (!rel.startsWith("assets/diagrams/")) {
    throw new Error(
      `Diagram path in ${sourceLabel} must be under assets/diagrams/: ${JSON.stringify(value)}`
    );
  }
  return rel;
}

function collectReferencedDiagrams(rows, sourceLabel = "problem data") {
  const referenced = new Set();
  if (!Array.isArray(rows)) return [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [field, isPlural] of DIAGRAM_FIELDS) {
      const raw = row[field];
      if (raw == null) continue;

      const values = isPlural ? raw : [raw];
      if (!Array.isArray(values)) {
        throw new Error(`${field} must be an array in ${sourceLabel}`);
      }
      for (const value of values) {
        const rel = validateDiagramPath(value, `${sourceLabel} field ${field}`);
        if (rel) referenced.add(rel);
      }
    }
  }

  return Array.from(referenced).sort();
}

function collectFromFiles(root, dataFiles) {
  const referenced = new Set();
  for (const rel of dataFiles) {
    const full = path.join(root, rel);
    const rows = JSON.parse(fs.readFileSync(full, "utf8"));
    for (const diagram of collectReferencedDiagrams(rows, rel)) {
      referenced.add(diagram);
    }
  }
  return Array.from(referenced).sort();
}

if (require.main === module) {
  const [root, ...dataFiles] = process.argv.slice(2);
  if (!root || dataFiles.length === 0) {
    console.error("Usage: node scripts/list_referenced_diagrams.js ROOT DATA_FILE...");
    process.exit(2);
  }

  try {
    for (const rel of collectFromFiles(root, dataFiles)) {
      process.stdout.write(`${rel}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  collectFromFiles,
  collectReferencedDiagrams,
  validateDiagramPath
};
