// Shared helpers for the browser tests (not a spec file itself).
import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dump as dumpYaml } from "js-yaml";

export { expect };

export const root = fileURLToPath(new URL("../../", import.meta.url));

// E2E_DATA=live: the data comes from the live sheet, so coverage checks that
// depend on the sheet's content are relaxed; every per-record check still runs.
export const liveData = process.env.E2E_DATA === "live";

export function readGenerated(file) {
  const target = path.join(root, "data", "generated", file);
  if (!existsSync(target)) {
    throw new Error(`Missing data/generated/${file}. Run \`npm run data:fixture\` (or the live data build) and \`quarto render\` first.`);
  }
  return readFileSync(target, "utf8");
}

// Fails any test whose page reports a script error or a console error (for
// example a module that did not load).
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
    });
    await use(page);
    expect(errors, "script or console errors on the page").toEqual([]);
  }
});

// The reference text fold for search, written for the tests: compatibility
// forms folded, lowercased, accents removed, whitespace collapsed.
export const fold = (value) => String(value ?? "")
  .normalize("NFKD")
  .toLowerCase()
  .normalize("NFD")
  .replace(/\p{M}+/gu, "")
  .replace(/\s+/g, " ")
  .trim();

export const isLinkable = (url) => typeof url === "string" && /^(https:\/\/|mailto:)\S+$/.test(url);

// Hrefs as the browser resolves them: Quarto percent-encodes characters such
// as '"' in rendered links, which leaves the URL itself unchanged.
export const asUrl = (href) => new URL(href).href;

// A CSS attribute-selector string for any value.
export const cssString = (value) => `"${String(value).replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`;

// A word from the title, typed in a different case with stray spaces.
export function searchTerm(record) {
  const words = fold(record.title).split(" ");
  const word = [...words].sort((a, b) => b.length - a.length)[0];
  const upper = word.toUpperCase();
  return upper.toLowerCase() === word ? `  ${upper}  ` : word;
}

export const queryOf = (page) => Object.fromEntries(new URL(page.url()).searchParams);

// Renders a scratch Quarto site in the OS temp directory from the real page,
// template and scripts, with synthetic data files ({ "talks.yml": records }).
export function renderScratchSite(prefix, files, data) {
  const scratch = mkdtempSync(path.join(tmpdir(), prefix));
  writeFileSync(path.join(scratch, "_quarto.yml"), [
    "project:", "  type: website", "  render:", '    - "*.qmd"', "  resources:", '    - "js/*.js"',
    "format:", "  html:", "    html-math-method: plain", ""
  ].join("\n"));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    copyFileSync(path.join(root, file), path.join(scratch, file));
  }
  mkdirSync(path.join(scratch, "data", "generated"), { recursive: true });
  for (const [name, records] of Object.entries(data)) {
    writeFileSync(path.join(scratch, "data", "generated", name), dumpYaml(records, { forceQuotes: true, quotingType: '"' }));
  }
  execFileSync(process.env.QUARTO ?? "quarto", ["render", "--quiet"], { cwd: scratch, stdio: "pipe" });
  return scratch;
}

// Serves a scratch site's _site/ on a fake origin.
export async function routeScratchSite(page, scratch, origin) {
  const site = path.join(scratch, "_site");
  await page.route(`${origin}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    const file = path.join(site, decodeURIComponent(pathname), pathname.endsWith("/") ? "index.html" : "");
    if (!file.startsWith(site) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ path: file });
  });
}
