const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readViewBox(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const match = source.match(/\bviewBox="([^"]+)"/);
  assert.ok(match, `${file} must declare a viewBox`);
  const values = match[1].trim().split(/\s+/).map(Number);
  assert.equal(values.length, 4, `${file} must have four viewBox values`);
  assert.ok(values.every(Number.isFinite), `${file} viewBox must be numeric`);
  return values;
}

function assertBoundsInsideViewBox(file, bounds) {
  const [x, y, width, height] = readViewBox(file);
  assert.ok(x <= bounds.minX, `${file} clips its left edge`);
  assert.ok(y <= bounds.minY, `${file} clips its top edge`);
  assert.ok(x + width >= bounds.maxX, `${file} clips its right edge`);
  assert.ok(y + height >= bounds.maxY, `${file} clips its bottom edge`);
}

test("manual SVG viewBoxes include their stroked geometry", () => {
  assertBoundsInsideViewBox(
    "assets/diagrams/341d345fdda6d30ac8049a7ddb094bdf.svg",
    {
      // The outer circle is centered at (145, 105), radius 132, with a 2px stroke.
      minX: 12,
      minY: -28,
      maxX: 278,
      maxY: 238
    }
  );

  assertBoundsInsideViewBox(
    "assets/diagrams/cad911729b80c8add923db40434bca12.svg",
    {
      // The three grids span x=20..550 and y=-10..170 with a 3px stroke.
      minX: 18.5,
      minY: -11.5,
      maxX: 551.5,
      maxY: 171.5
    }
  );
});
