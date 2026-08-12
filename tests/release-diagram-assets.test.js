"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  collectReferencedDiagrams,
  collectFromFiles,
  validateDiagramPath
} = require("../scripts/list_referenced_diagrams.js");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_BANKS = [
  "data/amc8.json",
  "data/amc10.json",
  "data/amc12.json",
  "data/aime.json",
  "data/olympiad.json",
  "data/upper_level_mcq.json",
  "data/calculus_mcq_synthetic.json"
];

test("diagram collector supports singular and plural PNG/SVG fields", () => {
  const rows = [
    {
      diagramPng: "assets/diagrams/a.png",
      diagramSvg: "assets/diagrams/b.svg"
    },
    {
      diagramPngs: [
        "assets/diagrams/c.png",
        "assets/diagrams/a.png"
      ],
      diagramSvgs: [
        "assets/diagrams/d.svg",
        "assets/diagrams/b.svg"
      ]
    }
  ];

  assert.deepEqual(collectReferencedDiagrams(rows), [
    "assets/diagrams/a.png",
    "assets/diagrams/b.svg",
    "assets/diagrams/c.png",
    "assets/diagrams/d.svg"
  ]);
});

test("diagram collector rejects traversal and absolute paths", () => {
  for (const unsafe of [
    "assets/diagrams/../secret.txt",
    "assets/diagrams\\..\\secret.txt",
    "/assets/diagrams/secret.png",
    "C:\\assets\\diagrams\\secret.png"
  ]) {
    assert.throws(
      () => validateDiagramPath(unsafe, "fixture"),
      /Unsafe diagram path/
    );
  }
});

test("diagram collector rejects references outside the packaged diagram directory", () => {
  assert.throws(
    () => collectReferencedDiagrams([
      { diagramPng: "assets/unpackaged-diagram.png" }
    ]),
    /must be under assets\/diagrams\//
  );
});

test("all referenced runtime diagram assets exist", () => {
  const diagrams = collectFromFiles(ROOT, RUNTIME_BANKS);
  assert.ok(diagrams.length > 200, "expected runtime banks to reference many diagrams");
  for (const rel of diagrams) {
    assert.ok(fs.statSync(path.join(ROOT, rel)).isFile(), `missing ${rel}`);
  }
});
