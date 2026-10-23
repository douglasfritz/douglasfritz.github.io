// Browser tests for the publication archive. They are data-driven: every
// expectation is derived from data/generated/ at test time, so the same suite
// runs on the synthetic fixtures (locally) and on the live sheet (CI).
// Set E2E_DATA=live when the data comes from the live sheet: it relaxes only the
// coverage checks that depend on the sheet's content (an In Review record, a
// secondary pillar); every per-record assertion still runs.
import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));

function readGenerated(file) {
  const target = path.join(root, "data", "generated", file);
  if (!existsSync(target)) {
    throw new Error(`Missing data/generated/${file}. Run \`npm run data:fixture\` (or the live data build) and \`quarto render\` first.`);
  }
  return readFileSync(target, "utf8");
}

const publications = loadYaml(readGenerated("publications.yml"));
const metadata = JSON.parse(readGenerated("build-metadata.json"));
const pillars = JSON.parse(readGenerated("pillars.json"));
const liveData = process.env.E2E_DATA === "live";
const PAGE = "/publications/";

// Fails any test whose page reports a script error or a console error (for
// example a module that did not load).
const test = base.extend({
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

// ---- Reference model, written independently of js/filter-core.js ----------

const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim().normalize("NFKC").toLowerCase();
const isLinkable = (url) => typeof url === "string" && /^(https:\/\/|mailto:)\S+$/.test(url);

function preprintHref(doi) {
  if (typeof doi !== "string") return undefined;
  if (/^https:\/\/\S+$/.test(doi)) return doi;
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
  return undefined;
}

// Hrefs as the browser resolves them: Quarto percent-encodes characters such
// as '"' in rendered links, which leaves the URL itself unchanged.
const asUrl = (href) => new URL(href).href;

function expectedHrefs(record) {
  return [isLinkable(record.doi_url) ? record.doi_url : undefined, preprintHref(record.preprint_doi)].filter(Boolean).map(asUrl);
}

function referenceMatches(record, state) {
  const text = norm([record.title, record.author, record.journal, ...record.topic_tags].join(" "));
  const terms = norm(state.text).split(" ").filter(Boolean);
  return terms.every((term) => text.includes(term))
    && (!state.pillar || record.primary_pillar === state.pillar || record.secondary_pillar === state.pillar)
    && (!state.status || record.status === state.status)
    && (!state.year || String(record.year) === state.year);
}

const expectedKeys = (records, state) => records.filter((record) => referenceMatches(record, state)).map((record) => record.key);

// ---- Page helpers -----------------------------------------------------------

const cssString = (value) => `"${String(value).replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ")}"`;
const cards = (page) => page.locator("article.publication-card");
const card = (page, key) => page.locator(`article.publication-card[data-key=${cssString(key)}]`);
const detail = (scope, label) => scope.locator(".record-detail").filter({ has: scope.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) });
const visibleKeys = (page) => page.locator("article.publication-card:visible").evaluateAll((nodes) => nodes.map((node) => node.dataset.key));
const countText = (shown, total) => `Showing ${shown} of ${total} ${total === 1 ? "publication" : "publications"}`;

const controls = (page) => ({
  text: page.getByLabel("Search publications"),
  pillar: page.getByLabel("Research pillar"),
  status: page.getByLabel("Status", { exact: true }),
  year: page.getByLabel("Year", { exact: true })
});

async function applyFilters(page, state) {
  const c = controls(page);
  await c.text.fill(state.text ?? "");
  await c.pillar.selectOption({ value: state.pillar ?? "" });
  await c.status.selectOption({ value: state.status ?? "" });
  await c.year.selectOption({ value: state.year ?? "" });
}

async function expectShown(page, keys, total = publications.length) {
  await expect(page.locator("article.publication-card:visible")).toHaveCount(keys.length);
  expect(await visibleKeys(page)).toEqual(keys);
  await expect(page.locator("[data-archive-count]")).toHaveText(countText(keys.length, total));
  if (keys.length === 0) await expect(page.locator("[data-archive-empty]")).toBeVisible();
  else await expect(page.locator("[data-archive-empty]")).toBeHidden();
}

async function expectControls(page, state) {
  const c = controls(page);
  await expect(c.text).toHaveValue(state.text ?? "");
  await expect(c.pillar).toHaveValue(state.pillar ?? "");
  await expect(c.status).toHaveValue(state.status ?? "");
  await expect(c.year).toHaveValue(state.year ?? "");
}

const queryOf = (page) => Object.fromEntries(new URL(page.url()).searchParams);

// A word from the title, typed in a different case with stray spaces.
function searchTerm(record) {
  const words = norm(record.title).split(" ");
  const word = [...words].sort((a, b) => b.length - a.length)[0];
  const upper = word.toUpperCase();
  return upper.toLowerCase() === word ? `  ${upper}  ` : word;
}

// ---- Tests on the static HTML (both projects) ------------------------------

test("the generated data exercises the cases these tests check", () => {
  const keys = publications.map((record) => record.key);
  expect(keys.length).toBeGreaterThan(0);
  expect(new Set(keys).size, "publication keys are unique").toBe(keys.length);
  expect(keys.length).toBe(metadata.public_rows.publications);
  const statuses = new Set(publications.map((record) => record.status));
  expect(statuses.has("Published"), "data has a Published record").toBe(true);
  expect(new Set(publications.map((record) => record.year)).size, "data spans two or more years").toBeGreaterThanOrEqual(2);
  expect(new Set(publications.map((record) => record.primary_pillar)).size, "data spans two or more pillars").toBeGreaterThanOrEqual(2);
  if (!liveData) {
    expect(statuses.has("In Review"), "fixture data has an In Review record").toBe(true);
    expect(publications.some((record) => record.secondary_pillar), "fixture data has a secondary pillar").toBe(true);
  }
});

test("every public publication is rendered exactly once, in archive order", async ({ page }) => {
  await page.goto(PAGE);
  await expect(cards(page)).toHaveCount(metadata.public_rows.publications);
  const keys = await cards(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.key));
  expect(keys).toEqual(publications.map((record) => record.key));
});

test("cards show each record's metadata and only its available links", async ({ page }) => {
  await page.goto(PAGE);
  for (const record of publications) {
    const c = card(page, record.key);
    await expect(c).toHaveCount(1);
    await expect(c).toHaveAttribute("data-primary-pillar", record.primary_pillar);
    await expect(c).toHaveAttribute("data-secondary-pillar", record.secondary_pillar ?? "");
    await expect(c).toHaveAttribute("data-status", record.status);
    await expect(c).toHaveAttribute("data-year", String(record.year));
    await expect(c).toHaveAttribute("data-foundational", record.foundational_work);

    await expect(c.locator(".record-title")).toHaveText(record.title);
    await expect(c.locator(".record-title")).toBeVisible();
    await expect(c.locator(".record-authors")).toHaveText(record.author);
    await expect(c.locator(".record-year")).toHaveText(String(record.year));
    await expect(c.locator(".record-venue cite")).toHaveText(record.journal);
    await expect(c.locator(".status-badge")).toHaveText(record.status);

    const primary = detail(c, "Primary pillar");
    await expect(primary.locator(".pillar-badge")).toHaveText(`Pillar ${pillars[record.primary_pillar].number}`);
    await expect(primary.locator(".pillar-name")).toHaveText(record.primary_pillar);
    const secondary = detail(c, "Secondary pillar");
    if (record.secondary_pillar) {
      await expect(secondary.locator(".pillar-badge")).toHaveText(`Pillar ${pillars[record.secondary_pillar].number}`);
      await expect(secondary.locator(".pillar-name")).toHaveText(record.secondary_pillar);
    } else {
      await expect(secondary).toHaveCount(0);
    }

    if (record.topic_tags.length > 0) await expect(c.locator(".record-tags li")).toHaveText(record.topic_tags);
    else await expect(c.locator(".record-tags")).toHaveCount(0);

    const links = c.locator("a");
    const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.href));
    expect(hrefs, `links of ${record.key}`).toEqual(expectedHrefs(record));
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      await expect(link).not.toHaveText(/^\s*$/);
      await expect(link).not.toHaveAttribute("target");
    }
  }
});

test("In Review records carry the exact status and never look published", async ({ page }) => {
  await page.goto(PAGE);
  const inReview = publications.filter((record) => record.status === "In Review");
  await expect(page.locator('article.publication-card[data-status="In Review"]')).toHaveCount(inReview.length);
  await expect(page.locator(".status-badge.status-not-published")).toHaveCount(inReview.length);
  for (const record of inReview) {
    const c = card(page, record.key);
    const badge = c.locator(".status-badge");
    await expect(c.getByText("In Review", { exact: true })).toBeVisible();
    await expect(badge).toHaveText("In Review");
    await expect(badge).toHaveCSS("border-top-style", "dashed");
    // The record's own text could, in principle, contain the word.
    const ownText = [record.title, record.author, record.journal, record.preprint_journal, ...record.topic_tags].join(" ");
    if (!ownText.includes("Published")) await expect(c).not.toContainText("Published");
  }
  for (const record of publications.filter((r) => r.status === "Published")) {
    await expect(card(page, record.key).locator(".status-badge")).toHaveCSS("border-top-style", "solid");
  }
});

test("ScholarlyArticle JSON-LD is emitted for Published records only", async ({ page }) => {
  await page.goto(PAGE);
  const published = publications.filter((record) => record.status === "Published");
  for (const record of publications) {
    const scripts = card(page, record.key).locator('script[type="application/ld+json"]');
    if (record.status !== "Published") {
      await expect(scripts).toHaveCount(0);
      continue;
    }
    await expect(scripts).toHaveCount(1);
    const data = JSON.parse(await scripts.textContent());
    const expected = {
      "@context": "https://schema.org",
      "@type": "ScholarlyArticle",
      headline: record.title,
      name: record.title,
      datePublished: String(record.year),
      isPartOf: { "@type": "Periodical", name: record.journal }
    };
    if (isLinkable(record.doi_url) && record.doi_url.startsWith("https://")) {
      expected.url = record.doi_url;
      expected.sameAs = record.doi_url;
    }
    expect(data).toEqual(expected);
  }
  const allArticles = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) =>
    nodes.map((node) => JSON.parse(node.textContent)).filter((data) => data["@type"] === "ScholarlyArticle"));
  expect(allArticles).toHaveLength(published.length);
});

// ---- Without JavaScript ------------------------------------------------------

test("without JavaScript every publication is readable and linked, and no dead controls show", { tag: "@no-js" }, async ({ page }) => {
  // A filter query cannot hide anything without the script.
  await page.goto(`${PAGE}?status=Published&year=1900`);
  await expect(page.locator("form[data-archive-filters]")).toBeHidden();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.locator("[data-archive-empty]")).toBeHidden();
  await expect(cards(page)).toHaveCount(publications.length);
  for (const record of publications) {
    const c = card(page, record.key);
    await expect(c).toBeVisible();
    await expect(c.getByRole("heading", { level: 2 })).toHaveText(record.title);
    const links = c.locator("a");
    await expect(links).toHaveCount(expectedHrefs(record).length);
    expect(await links.evaluateAll((nodes) => nodes.map((node) => node.href))).toEqual(expectedHrefs(record));
    for (const link of await links.all()) await expect(link).toBeVisible();
  }
});

// ---- With JavaScript -------------------------------------------------------

test("the script reveals labelled filters and a polite result count", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator("form[data-archive-filters]")).toBeVisible();
  const c = controls(page);
  await expect(c.text).toHaveAttribute("type", "search");
  await expect(c.pillar.locator("option")).toHaveText(["All pillars", ...Object.entries(pillars).map(([name, p]) => `Pillar ${p.number}: ${name}`)]);
  await expect(c.status.locator("option")).toHaveText(["All statuses", ...[...new Set(publications.map((r) => r.status))].sort()]);
  const years = [...new Set(publications.map((r) => String(r.year)))].sort((a, b) => Number(b) - Number(a));
  await expect(c.year.locator("option")).toHaveText(["All years", ...years]);
  const count = page.getByRole("status");
  await expect(count).toHaveAttribute("aria-live", "polite");
  await expect(count).toHaveAttribute("aria-atomic", "true");
  await expectShown(page, publications.map((record) => record.key));
  await expect(page.getByRole("button", { name: "Reset filters" })).toBeVisible();
});

test("combined filters match the reference, survive a reload and reset", { tag: "@js" }, async ({ page }) => {
  const indexes = [...new Set([0, Math.floor((publications.length - 1) / 2), publications.length - 1])];
  for (const record of indexes.map((index) => publications[index])) {
    const state = {
      text: searchTerm(record),
      pillar: record.secondary_pillar ?? record.primary_pillar,
      status: record.status,
      year: String(record.year)
    };
    const expected = expectedKeys(publications, state);
    expect(expected, "the sampled record matches its own filters").toContain(record.key);

    await page.goto(PAGE);
    await applyFilters(page, state);
    await expectShown(page, expected);
    const canonical = { ...state, text: state.text.trim() };
    expect(queryOf(page)).toEqual(canonical);

    await page.reload();
    await expectControls(page, canonical);
    await expectShown(page, expected);

    await page.getByRole("button", { name: "Reset filters" }).click();
    await expectControls(page, {});
    await expectShown(page, publications.map((r) => r.key));
    expect(new URL(page.url()).search).toBe("");
  }
});

test("each filter alone matches the reference", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  const states = [
    ...Object.keys(pillars).map((pillar) => ({ pillar })),
    ...[...new Set(publications.map((r) => r.status))].map((status) => ({ status })),
    ...[...new Set(publications.map((r) => String(r.year)))].slice(0, 3).map((year) => ({ year })),
    { text: searchTerm(publications[0]) },
    { text: publications[0].author.split(/[;,]/)[0] },
    // Every term must match, possibly in different fields.
    { text: `${publications[0].author.split(/[;,]/)[0]} ${searchTerm(publications[0])}` },
    { text: `${searchTerm(publications[0])} zz-absent-term` }
  ];
  for (const state of states) {
    await applyFilters(page, state);
    await expectShown(page, expectedKeys(publications, state));
  }
  // The pillar filter finds records through their secondary pillar.
  const multi = publications.find((r) => r.secondary_pillar);
  if (multi) {
    await applyFilters(page, { pillar: multi.secondary_pillar });
    expect(await visibleKeys(page)).toContain(multi.key);
  }
});

test("no matches shows the empty state, whose reset restores every record", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  const state = { text: "zz-no-such-publication-qq" };
  expect(expectedKeys(publications, state)).toEqual([]);
  await applyFilters(page, state);
  await expectShown(page, []);
  const empty = page.locator("[data-archive-empty]");
  await expect(empty).toContainText("No publications match");
  await empty.getByRole("button", { name: "Reset filters" }).click();
  await expectShown(page, publications.map((r) => r.key));
  await expect(controls(page).text).toBeFocused();
  expect(new URL(page.url()).search).toBe("");
});

test("query parameters set the filters; unknown keys and values are ignored", { tag: "@js" }, async ({ page }) => {
  const year = String(publications[0].year);
  await page.goto(`${PAGE}?utm_source=x&year=${year}&pillar=Not%20a%20pillar&status=Bogus&foo=bar#publication-records`);
  await expectControls(page, { year });
  await expectShown(page, expectedKeys(publications, { year }));
  expect(new URL(page.url()).search).toBe(`?year=${year}`);
  expect(new URL(page.url()).hash).toBe("#publication-records");

  // Arriving from the site search (?q=...) leaves the archive unfiltered;
  // Quarto highlights the term and removes q from the URL.
  await page.goto(`${PAGE}?q=${encodeURIComponent(searchTerm(publications[0]).trim())}&year=${year}`);
  await expectControls(page, { year });
  await expectShown(page, expectedKeys(publications, { year }));
  expect(new URL(page.url()).search).toBe(`?year=${year}`);

  await page.goto(`${PAGE}?unknown=1&text=`);
  await expectControls(page, {});
  await expectShown(page, publications.map((r) => r.key));
  expect(new URL(page.url()).search).toBe("");
});

test("filters work from the keyboard with a visible focus ring", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  const c = controls(page);
  await c.text.focus();
  const term = searchTerm(publications[0]);
  await page.keyboard.type(term);
  await expectShown(page, expectedKeys(publications, { text: term }));
  for (const control of [c.text, c.pillar, c.status, c.year]) {
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style", "solid");
    await expect(control).toHaveCSS("outline-width", "3px");
    await page.keyboard.press("Tab");
  }
  const reset = page.getByRole("button", { name: "Reset filters" });
  await expect(reset).toBeFocused();
  await expect(reset).toHaveCSS("outline-width", "3px");
  await page.keyboard.press("Enter");
  await expectShown(page, publications.map((r) => r.key));
});

// ---- Template escaping (a synthetic hostile record, rendered separately) ----

test.describe("template escaping", { tag: "@js" }, () => {
  const origin = "http://hostile.test";
  const names = Object.keys(pillars);
  const hostile = [
    {
      key: `x"><img src=x onerror="window.__pwned=1">'`,
      status: "Published",
      author: `Mallory, M.; O'Brien, "Q."; <img src=x onerror="window.__pwned=2">`,
      year: 2025,
      title: "Bad </script><script>window.__pwned=3</script> *emph* [link](javascript:window.__pwned=4) & 'q' \"qq\"\n```\n<b>after fence</b> [x](javascript:window.__pwned=5) ${window.__pwned=6}",
      journal: `Journal "of" <i>Things</i> & 'Stuff' </script>`,
      volume: "<b>1</b>",
      page_number: "\"2\"",
      doi_url: "https://doi.org/10.1/x\"onmouseover=\"window.__pwned=7",
      primary_pillar: names[0],
      secondary_pillar: names[1],
      topic_tags: ["<svg onload=\"window.__pwned=8\">", "```", "<%= 'template' %>"],
      foundational_work: "N",
      slug: "hostile-published"
    },
    {
      key: "hostile-review",
      status: "In Review",
      author: "Eve <script>window.__pwned=9</script>",
      year: 2024,
      title: "Review </script><img src=x onerror=window.__pwned=10>",
      preprint_journal: "<i>Rxiv</i>",
      preprint_doi: "10.1234/abc\"><script>window.__pwned=11</script>",
      journal: "Plain Journal",
      doi_url: "javascript:window.__pwned=12",
      primary_pillar: names[2],
      topic_tags: [],
      foundational_work: "Y",
      slug: "hostile-review"
    }
  ];
  let scratch;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    scratch = mkdtempSync(path.join(tmpdir(), "publication-template-"));
    for (const dir of ["publications", "templates", "js", path.join("data", "generated")]) mkdirSync(path.join(scratch, dir), { recursive: true });
    writeFileSync(path.join(scratch, "_quarto.yml"), [
      "project:", "  type: website", "  render:", '    - "*.qmd"', "  resources:", '    - "js/*.js"',
      "format:", "  html:", "    html-math-method: plain", ""
    ].join("\n"));
    for (const file of ["publications/index.qmd", "templates/publication.ejs.md", "js/archive-filters.js", "js/filter-core.js"]) {
      copyFileSync(path.join(root, file), path.join(scratch, file));
    }
    writeFileSync(path.join(scratch, "data", "generated", "publications.yml"), dumpYaml(hostile, { forceQuotes: true, quotingType: '"' }));
    execFileSync(process.env.QUARTO ?? "quarto", ["render", "--quiet"], { cwd: scratch, stdio: "pipe" });
  });

  test.afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("hostile text renders as text, never as markup, script or a link", async ({ page }) => {
    const site = path.join(scratch, "_site");
    await page.route(`${origin}/**`, (route) => {
      const { pathname } = new URL(route.request().url());
      const file = path.join(site, decodeURIComponent(pathname), pathname.endsWith("/") ? "index.html" : "");
      if (!file.startsWith(site) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: file });
    });
    await page.goto(`${origin}${PAGE}`);
    await expect(page.locator("form[data-archive-filters]")).toBeVisible();

    const listing = page.locator("#listing-publications");
    await expect(listing.locator("img, svg, b, i, em, strong, iframe, object, embed")).toHaveCount(0);
    await expect(listing.locator('script:not([type="application/ld+json"])')).toHaveCount(0);
    const handlers = await listing.locator("*").evaluateAll((nodes) =>
      nodes.flatMap((node) => [...node.attributes].map((attr) => attr.name)).filter((name) => name.startsWith("on")));
    expect(handlers).toEqual([]);
    const hrefs = await listing.locator("a").evaluateAll((nodes) => nodes.map((node) => node.href));
    expect(hrefs).toEqual(hostile.flatMap(expectedHrefs));
    expect(hrefs.every((href) => /^(https:|mailto:)/.test(href))).toBe(true);

    for (const record of hostile) {
      const c = card(page, record.key);
      await expect(c).toHaveCount(1);
      expect(await c.locator(".record-title").evaluate((node) => node.textContent)).toBe(record.title);
      expect(await c.locator(".record-authors").evaluate((node) => node.textContent)).toBe(record.author);
      expect(await c.locator(".record-venue cite").evaluate((node) => node.textContent)).toBe(record.journal);
      expect(await c.locator(".record-tags li").evaluateAll((nodes) => nodes.map((node) => node.textContent))).toEqual(record.topic_tags);
      const scripts = c.locator('script[type="application/ld+json"]');
      if (record.status === "Published") {
        const data = JSON.parse(await scripts.textContent());
        expect(data.headline).toBe(record.title);
        expect(data.isPartOf.name).toBe(record.journal);
      } else {
        await expect(scripts).toHaveCount(0);
      }
    }

    // The enhancement script reads the same text without turning it into markup.
    await controls(page).text.fill("after fence");
    await expectShown(page, [hostile[0].key], hostile.length);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});
