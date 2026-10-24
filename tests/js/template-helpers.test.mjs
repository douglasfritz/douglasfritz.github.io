// The listing templates cannot import code, so each templates/*.ejs.md
// carries its own copy of the escaping and URL helpers. This test keeps the
// copies byte-identical and checks the helpers themselves.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templatesDir = fileURLToPath(new URL("../../templates/", import.meta.url));
const BEGIN = "// ==== Shared template helpers: begin ====";
const END = "// ==== Shared template helpers: end ====";

const templates = readdirSync(templatesDir)
  .filter((name) => name.endsWith(".ejs.md"))
  .sort()
  .map((name) => ({ name, text: readFileSync(path.join(templatesDir, name), "utf8") }));

function helperBlock({ name, text }) {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(start >= 0 && end > start, `${name} has the shared helper block`);
  assert.equal(text.indexOf(BEGIN, start + 1), -1, `${name} has one begin marker`);
  assert.equal(text.indexOf(END, end + 1), -1, `${name} has one end marker`);
  return text.slice(start, end + END.length);
}

// Evaluates the block the way lodash's template does (plain JavaScript with
// templateParams in scope) and returns the helpers.
function loadHelpers(templateParams) {
  const block = helperBlock(templates[0]);
  return new Function("templateParams", `${block}\nreturn { esc, jsonForScript, isSafeUrl, pillars, pillarNumber };`)(templateParams);
}

const pillarNames = ["P one", "P two", "P three", "P four"];

test("every listing template carries the same shared helper block", () => {
  assert.deepEqual(templates.map((t) => t.name), ["publication.ejs.md", "talk.ejs.md"]);
  const [first, ...rest] = templates.map(helperBlock);
  for (const [index, block] of rest.entries()) {
    assert.equal(block, first, `${templates[index + 1].name} differs from ${templates[0].name}`);
  }
  for (const name of ["const esc =", "const jsonForScript =", "const isSafeUrl =", "const pillarNumber ="]) {
    assert.ok(first.includes(name), `the block defines ${name}`);
  }
  // A closing template tag inside the block would end the template's code.
  assert.equal(first.includes("%>"), false);
  assert.equal(/[\u2028\u2029]/.test(first), false, "no literal line or paragraph separators");
});

test("esc escapes the HTML specials and the backtick", () => {
  const { esc } = loadHelpers({ pillars: pillarNames });
  assert.equal(esc(`<a href="x" onclick='y'>&\`</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;");
  assert.equal(esc(undefined), "");
  assert.equal(esc(null), "");
  assert.equal(esc(2026), "2026");
  assert.equal(esc("García — plain"), "García — plain");
});

test("jsonForScript cannot close a script element or a fence", () => {
  const { jsonForScript } = loadHelpers({ pillars: pillarNames });
  const value = { title: "</script><script>x()</script> & ``` \u2028\u2029" };
  const json = jsonForScript(value);
  assert.equal(/[<>&`\u2028\u2029]/.test(json), false);
  assert.deepEqual(JSON.parse(json), value);
});

test("isSafeUrl allows only https:// and mailto: without whitespace", () => {
  const { isSafeUrl } = loadHelpers({ pillars: pillarNames });
  for (const url of ["https://example.org/a?b=c#d", "mailto:someone@example.org"]) assert.equal(isSafeUrl(url), true, url);
  for (const url of ["http://example.org", "javascript:alert(1)", "JAVASCRIPT:alert(1)", " https://example.org", "https://exa mple.org",
    "https://", "data:text/html,x", "//example.org", "/relative", "", undefined, null, 42, ["https://example.org"]]) {
    assert.equal(isSafeUrl(url), false, String(url));
  }
});

test("pillarNumber follows the canonical order and rejects unknown pillars", () => {
  const { pillarNumber } = loadHelpers({ pillars: pillarNames });
  assert.deepEqual(pillarNames.map(pillarNumber), [1, 2, 3, 4]);
  assert.throws(() => pillarNumber("P five"), /unknown pillar/);
  assert.throws(() => loadHelpers({ pillars: pillarNames.slice(0, 3) }), /four research pillars/);
  assert.throws(() => loadHelpers(undefined), /four research pillars/);
});
