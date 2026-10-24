// Shared helpers for the browser tests (not a spec file itself).
import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// A 1x1 transparent PNG, served for every OpenStreetMap tile so that tests
// never reach the tile servers and run the same offline.
export const TILE_URL_PATTERN = "https://tile.openstreetmap.org/**";
export const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

// Every message must match one of the patterns, and every pattern must match
// at least one message.
function expectExactly(messages, patterns, what) {
  const unexpected = messages.filter((message) => !patterns.some((pattern) => pattern.test(message)));
  expect(unexpected, `unexpected ${what}`).toEqual([]);
  for (const pattern of patterns) {
    expect(messages.some((message) => pattern.test(message)), `expected ${what} matching ${pattern}; got ${JSON.stringify(messages)}`).toBe(true);
  }
}

// Fails any test whose page reports a script error, a console error (for
// example a module that did not load) or a failed request (an HTTP error or a
// request that did not complete; requests cancelled by a navigation are not
// failures). A test that breaks something on purpose lists the errors and
// failures it expects in expectedPageErrors / expectedRequestFailures (each
// pattern must then occur). Console errors are recorded with their source
// URL, failures as "<status or error> <url>".
export const test = base.extend({
  expectedPageErrors: async ({}, use) => { await use([]); },
  expectedRequestFailures: async ({}, use) => { await use([]); },
  page: async ({ page, expectedPageErrors, expectedRequestFailures }, use) => {
    const errors = [];
    const failures = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console.error: ${message.text()} (${message.location().url})`);
    });
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "failed";
      if (reason !== "net::ERR_ABORTED") failures.push(`${reason} ${request.url()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    });
    await page.route(TILE_URL_PATTERN, (route) => route.fulfill({ contentType: "image/png", body: TRANSPARENT_PNG }));
    await use(page);
    expectExactly(errors, expectedPageErrors, "script or console errors on the page");
    expectExactly(failures, expectedRequestFailures, "failed requests");
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
// template and scripts (files or whole directories), with synthetic data
// files: { "talks.yml": records } is written as YAML, a .json or .geojson
// file as JSON. `resources` are the project resources to publish; `theme`
// is a theme file among `files` (the site's styles), if any. With `renv`,
// R code chunks run with this repository's renv library (the scratch site
// gets an .Rprofile that activates it), as they do in the real site.
// `website` lines go under the scratch _quarto.yml's `website:` key (a
// navbar or footer); `write` maps scratch paths to text written after the
// files are copied (a page variant), never into the repository.
export function renderScratchSite(prefix, files, data, { resources = ["js/*.js"], theme, renv = false, website = [], write = {} } = {}) {
  const scratch = mkdtempSync(path.join(tmpdir(), prefix));
  if (renv) {
    const project = JSON.stringify(root.replace(/[\\/]+$/, ""));
    writeFileSync(path.join(scratch, ".Rprofile"), `Sys.setenv(RENV_PROJECT = ${project})\nsource(file.path(${project}, "renv", "activate.R"))\n`);
  }
  writeFileSync(path.join(scratch, "_quarto.yml"), [
    "project:", "  type: website", "  render:", '    - "*.qmd"', "  resources:",
    ...resources.map((resource) => `    - ${JSON.stringify(resource)}`),
    ...(website.length > 0 ? ["website:", ...website.map((line) => `  ${line}`)] : []),
    "format:", "  html:", "    html-math-method: plain",
    ...(theme ? [`    theme: ${JSON.stringify(theme)}`] : []), ""
  ].join("\n"));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    cpSync(path.join(root, file), path.join(scratch, file), { recursive: true });
  }
  for (const [file, text] of Object.entries(write)) {
    mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    writeFileSync(path.join(scratch, file), text);
  }
  mkdirSync(path.join(scratch, "data", "generated"), { recursive: true });
  for (const [name, records] of Object.entries(data)) {
    const text = /\.(geo)?json$/.test(name) ? JSON.stringify(records) : dumpYaml(records, { forceQuotes: true, quotingType: '"' });
    writeFileSync(path.join(scratch, "data", "generated", name), text);
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
