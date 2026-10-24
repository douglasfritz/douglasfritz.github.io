// The site's own browser code never turns strings into markup or code
// (spec 16): no innerHTML, outerHTML, insertAdjacentHTML, document.write,
// eval or new Function in js/*.js. Text goes in with textContent and
// elements are built with createElement. The vendored libraries in
// assets/vendor/ are not the site's code and are not scanned.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const FORBIDDEN = [
  ["innerHTML", /\binnerHTML\b/],
  ["outerHTML", /\bouterHTML\b/],
  ["insertAdjacentHTML", /\binsertAdjacentHTML\b/],
  ["document.write", /\bdocument\s*\.\s*write(ln)?\b/],
  ["eval(", /\beval\s*\(/],
  ["new Function", /\bnew\s+Function\b/],
  ["string timer", /\bset(Timeout|Interval)\s*\(\s*["'`]/]
];
// Allowed occurrences, each with its reason: "<file>:<line>" -> reason.
// (None: an entry here must say why the use is safe.)
const ALLOWED = new Map();

// The first-party scripts: every .js file in js/ (none are generated).
function firstPartyScripts(directory = path.join(root, "js")) {
  return readdirSync(directory).filter((name) => name.endsWith(".js")).sort().map((name) => path.join(directory, name));
}

// Each forbidden use in `source`, with its line number.
function findForbidden(source) {
  const findings = [];
  source.split("\n").forEach((line, index) => {
    for (const [name, pattern] of FORBIDDEN) if (pattern.test(line)) findings.push({ line: index + 1, name });
  });
  return findings;
}

test("the site's scripts are found", () => {
  const names = firstPartyScripts().map((file) => path.basename(file));
  for (const expected of ["archive-filters.js", "filter-core.js", "map-state.js", "pillars.js", "site.js", "talks-map.js"]) {
    assert.ok(names.includes(expected), `${expected} is scanned`);
  }
});

test("no first-party script inserts markup or runs strings as code", () => {
  const findings = firstPartyScripts().flatMap((file) => findForbidden(readFileSync(file, "utf8"))
    .map(({ line, name }) => ({ where: `${path.relative(root, file)}:${line}`, name }))
    .filter(({ where }) => !ALLOWED.has(where)));
  assert.deepEqual(findings, []);
});

test("the scan finds each forbidden use (control)", () => {
  const sample = [
    "node.innerHTML = value;",
    "node.outerHTML = value;",
    "node.insertAdjacentHTML('beforeend', value);",
    "document.write(value);",
    "eval(value);",
    "const f = new Function('return 1');",
    "setTimeout('alert(1)', 0);",
    "node.textContent = value; // innerText is fine"
  ].join("\n");
  assert.deepEqual(findForbidden(sample).map(({ name }) => name), ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "string timer"]);
});
