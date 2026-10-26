// Browser tests for the talk archive (talks/index.qmd, templates/talk.ejs.md,
// js/archive-filters.js). They are data-driven: every expectation is derived
// from data/generated/ at test time, so the same suite runs on the synthetic
// fixtures (locally) and on the live sheet (CI, with E2E_DATA=live).
import { rmSync } from "node:fs";
import { load as loadYaml } from "js-yaml";
import {
  asUrl,
  cssString,
  expect,
  fold,
  isLinkable,
  liveData,
  queryOf,
  readGenerated,
  renderScratchSite,
  routeScratchSite,
  searchTerm,
  test
} from "./support.mjs";

const talks = loadYaml(readGenerated("talks.yml"));
const metadata = JSON.parse(readGenerated("build-metadata.json"));
const pillars = JSON.parse(readGenerated("pillars.json"));
const PAGE = "/talks/";
const SCOPES = ["local", "regional", "national", "international"];
const INCLUDE = "include";

// ---- Reference model, written independently of js/filter-core.js ----------

const LINK_FIELDS = [["event_url", "Event page"], ["slides_url", "Slides"], ["poster_url", "Poster"], ["recording_url", "Recording"]];
const expectedLinks = (record) => LINK_FIELDS
  .filter(([field]) => isLinkable(record[field]))
  .map(([field, label]) => ({ href: asUrl(record[field]), text: record[field].startsWith("mailto:") ? `${label} (email)` : label }));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ukDate = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const formatLabel = (virtual) => (virtual === "Y" ? "Virtual" : "In person");
const isVirtual = (record) => record.virtual_status === "Y";
const isFoundational = (record) => record.foundational_work === "Y";
const isUnmapped = (record) => typeof record.latitude !== "number" || typeof record.longitude !== "number";
const virtualWording = (record) => `Virtual — hosted by ${record.organization}${record.location_display ? `, ${record.location_display}` : ""}`;

function referenceMatches(record, state) {
  const text = fold([record.title, record.author, record.organization, record.location_display, record.type, ...record.topic_tags].join(" "));
  return fold(state.text).split(" ").filter(Boolean).every((term) => text.includes(term))
    && (!state.pillar || record.primary_pillar === state.pillar || record.secondary_pillar === state.pillar)
    && (!state.year || String(record.year) === state.year)
    && (!state.type || record.type === state.type)
    && (!state.scope || record.event_scope === state.scope)
    && (!state.virtual || record.virtual_status === state.virtual)
    && (state.foundational === INCLUDE || !isFoundational(record));
}

const expectedRecords = (state, records = talks) => records.filter((record) => referenceMatches(record, state));
const expectedKeys = (state, records = talks) => expectedRecords(state, records).map((record) => record.key);
const hiddenFoundational = (state, records = talks) => (state.foundational === INCLUDE ? 0
  : records.filter((record) => isFoundational(record) && referenceMatches(record, { ...state, foundational: INCLUDE })).length);

function countText(state, records = talks) {
  const noun = (n) => (n === 1 ? "talk" : "talks");
  const shown = expectedKeys(state, records).length;
  const hidden = hiddenFoundational(state, records);
  return `Showing ${shown} of ${records.length} ${noun(records.length)}${hidden > 0 ? ` (${hidden} foundational ${noun(hidden)} hidden)` : ""}`;
}

// The permitted reach figures (spec 8.3) for a set of talks.
function expectedReach(records) {
  const distinct = (field) => new Set(records.map((record) => record[field]).filter((value) => typeof value === "string" && value !== "")).size;
  const years = records.map((record) => record.year);
  const first = Math.min(...years);
  const last = Math.max(...years);
  return {
    presentations: String(records.length),
    countries: String(distinct("location_country")),
    cities: String(distinct("location_city")),
    hosts: String(distinct("organization")),
    links: String(records.reduce((sum, record) => sum + expectedLinks(record).length, 0)),
    years: records.length === 0 ? "None" : first === last ? String(first) : `${first}–${last}`
  };
}

const DEFAULT = {};
// Every card visible, foundational work included (a no-op without JavaScript).
const ALL = `${PAGE}?foundational=include`;

// ---- Page helpers -----------------------------------------------------------

const cards = (page) => page.locator("article.talk-card");
const card = (page, key) => page.locator(`article.talk-card[data-key=${cssString(key)}]`);
const fact = (scope, label) => scope.locator(".record-detail").filter({ has: scope.page().locator("dt", { hasText: new RegExp(`^${label}$`) }) });
const visibleKeys = (page) => page.locator("article.talk-card:visible").evaluateAll((nodes) => nodes.map((node) => node.dataset.key));
const readReach = (page) => page.locator("#talk-reach [data-reach]").evaluateAll((nodes) =>
  Object.fromEntries(nodes.map((node) => [node.dataset.reach, node.textContent])));

// The reach figures recomputed from the visible cards' own attributes.
const reachFromCards = (page) => page.locator("article.talk-card:visible").evaluateAll((nodes) => {
  const distinct = (name) => new Set(nodes.map((node) => node.dataset[name]).filter(Boolean)).size;
  const years = nodes.map((node) => Number(node.dataset.year));
  return {
    presentations: nodes.length,
    countries: distinct("country"),
    cities: distinct("city"),
    hosts: distinct("host"),
    links: nodes.reduce((sum, node) => sum + node.querySelectorAll(".record-links a").length, 0),
    years: nodes.length === 0 ? [] : [Math.min(...years), Math.max(...years)]
  };
});

const controls = (page) => ({
  text: page.getByLabel("Search talks"),
  pillar: page.getByLabel("Research pillar"),
  year: page.getByLabel("Year", { exact: true }),
  type: page.getByLabel("Presentation type"),
  scope: page.getByLabel("Event scope"),
  virtual: page.getByLabel("Format", { exact: true }),
  foundational: page.getByLabel("Include foundational work")
});

async function applyFilters(page, state) {
  const c = controls(page);
  await c.text.fill(state.text ?? "");
  await c.pillar.selectOption({ value: state.pillar ?? "" });
  await c.year.selectOption({ value: state.year ?? "" });
  await c.type.selectOption({ value: state.type ?? "" });
  await c.scope.selectOption({ value: state.scope ?? "" });
  await c.virtual.selectOption({ value: state.virtual ?? "" });
  await c.foundational.setChecked(state.foundational === INCLUDE);
}

async function expectControls(page, state) {
  const c = controls(page);
  await expect(c.text).toHaveValue(state.text ?? "");
  await expect(c.pillar).toHaveValue(state.pillar ?? "");
  await expect(c.year).toHaveValue(state.year ?? "");
  await expect(c.type).toHaveValue(state.type ?? "");
  await expect(c.scope).toHaveValue(state.scope ?? "");
  await expect(c.virtual).toHaveValue(state.virtual ?? "");
  if (state.foundational === INCLUDE) await expect(c.foundational).toBeChecked();
  else await expect(c.foundational).not.toBeChecked();
}

// Cards, result count, empty state and reach figures all match the reference.
async function expectView(page, state, records = talks) {
  const keys = expectedKeys(state, records);
  await expect(page.locator("article.talk-card:visible")).toHaveCount(keys.length);
  expect(await visibleKeys(page)).toEqual(keys);
  await expect(page.locator("[data-archive-count]")).toHaveText(countText(state, records));
  if (keys.length === 0) await expect(page.locator("[data-archive-empty]")).toBeVisible();
  else await expect(page.locator("[data-archive-empty]")).toBeHidden();
  const reach = expectedReach(expectedRecords(state, records));
  expect(await readReach(page), "reach figures").toEqual(reach);
  const fromCards = await reachFromCards(page);
  expect({
    presentations: String(fromCards.presentations),
    countries: String(fromCards.countries),
    cities: String(fromCards.cities),
    hosts: String(fromCards.hosts),
    links: String(fromCards.links),
    years: fromCards.years.length === 0 ? "None" : fromCards.years[0] === fromCards.years[1] ? String(fromCards.years[0]) : fromCards.years.join("–")
  }, "reach figures agree with the visible cards").toEqual(reach);
}

const canonical = (state) => Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value !== ""));

// Every facet of one record (its secondary pillar when it has one).
const stateFor = (record) => ({
  text: searchTerm(record),
  pillar: record.secondary_pillar ?? record.primary_pillar,
  year: String(record.year),
  type: record.type,
  scope: record.event_scope,
  virtual: record.virtual_status,
  ...(isFoundational(record) ? { foundational: INCLUDE } : {})
});

// First, middle and last records plus one of each special case.
const sampled = [...new Set([
  talks[0],
  talks[Math.floor((talks.length - 1) / 2)],
  talks[talks.length - 1],
  talks.find(isVirtual),
  talks.find(isUnmapped),
  talks.find(isFoundational),
  talks.find((record) => record.secondary_pillar)
].filter(Boolean))];

// ---- Tests on the static HTML (both projects) ------------------------------

test("the generated data exercises the cases these tests check", () => {
  const keys = talks.map((record) => record.key);
  expect(keys.length).toBeGreaterThan(0);
  expect(new Set(keys).size, "talk keys are unique").toBe(keys.length);
  expect(keys.length).toBe(metadata.public_rows.talks);
  expect(new Set(talks.map((record) => record.year)).size, "data spans two or more years").toBeGreaterThanOrEqual(2);
  expect(new Set(talks.map((record) => record.primary_pillar)).size, "data spans two or more pillars").toBeGreaterThanOrEqual(2);
  expect(talks.some((record) => !isFoundational(record)), "some talks are shown by default").toBe(true);
  for (const record of talks) {
    expect(record.date, `${record.key} has an ISO date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SCOPES, `${record.key} has a known scope`).toContain(record.event_scope);
  }
  if (!liveData) {
    expect(talks.some(isVirtual), "fixture data has a virtual talk").toBe(true);
    expect(talks.some((record) => isVirtual(record) && !isUnmapped(record)), "fixture data has a virtual talk with host coordinates").toBe(true);
    expect(talks.some((record) => !isVirtual(record)), "fixture data has an in-person talk").toBe(true);
    expect(talks.some(isUnmapped), "fixture data has a talk without coordinates").toBe(true);
    expect(talks.some(isFoundational), "fixture data has a foundational talk").toBe(true);
    expect(talks.some((record) => record.secondary_pillar), "fixture data has a secondary pillar").toBe(true);
    expect(talks.some((record) => expectedLinks(record).length === 0), "fixture data has a talk without links").toBe(true);
    expect(talks.some((record) => !record.location_city), "fixture data has a talk without a city").toBe(true);
    expect(new Set(talks.map((record) => record.type)).size, "fixture data has two or more types").toBeGreaterThanOrEqual(2);
    expect(new Set(talks.map((record) => record.event_scope)).size, "fixture data has two or more scopes").toBeGreaterThanOrEqual(2);
  }
});

test("every public talk is rendered exactly once, in archive order", async ({ page }) => {
  await page.goto(PAGE);
  await expect(cards(page)).toHaveCount(metadata.public_rows.talks);
  const keys = await cards(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.key));
  expect(keys).toEqual(talks.map((record) => record.key));
});

test("cards show each talk's details and only its available links", async ({ page }) => {
  // Every card is checked in full: the default 30s plus a share per talk, so
  // that the live sheet's larger data never times out.
  test.setTimeout(30_000 + 1_000 * talks.length);
  await page.goto(ALL);
  for (const record of talks) {
    const c = card(page, record.key);
    await expect(c).toHaveCount(1);
    await expect(c).toHaveAttribute("id", `talk-${record.slug}`);
    await expect(c).toHaveAttribute("aria-labelledby", `talk-${record.slug}-title`);
    const attributes = {
      "data-date": record.date,
      "data-year": String(record.year),
      "data-type": record.type,
      "data-scope": record.event_scope,
      "data-virtual": record.virtual_status,
      "data-host": record.organization,
      "data-city": record.location_city ?? "",
      "data-country": record.location_country ?? "",
      "data-primary-pillar": record.primary_pillar,
      "data-secondary-pillar": record.secondary_pillar ?? "",
      "data-foundational": record.foundational_work,
      "data-links": String(expectedLinks(record).length)
    };
    for (const [name, value] of Object.entries(attributes)) await expect(c, `${record.key} ${name}`).toHaveAttribute(name, value);

    const title = c.getByRole("heading", { level: 3 });
    await expect(title).toHaveText(record.title);
    await expect(title).toHaveAttribute("id", `talk-${record.slug}-title`);
    await expect(c.locator(".record-authors")).toHaveText(record.author);
    const time = c.locator("time");
    await expect(time).toHaveAttribute("datetime", record.date);
    await expect(time).toHaveText(ukDate(record.date));
    await expect(c.locator(".talk-host")).toHaveText(record.organization);
    await expect(fact(c, "Type").locator("dd")).toHaveText(record.type);
    await expect(fact(c, "Event scope").locator("dd")).toHaveText(capitalized(record.event_scope));
    await expect(fact(c, "Format").locator("dd")).toHaveText(formatLabel(record.virtual_status));

    const primary = fact(c, "Primary pillar");
    await expect(primary.locator(".pillar-badge")).toHaveText(`Pillar ${pillars[record.primary_pillar].number}`);
    await expect(primary.locator(".pillar-name")).toHaveText(record.primary_pillar);
    const secondary = fact(c, "Secondary pillar");
    if (record.secondary_pillar) {
      await expect(secondary.locator(".pillar-badge")).toHaveText(`Pillar ${pillars[record.secondary_pillar].number}`);
      await expect(secondary.locator(".pillar-name")).toHaveText(record.secondary_pillar);
    } else {
      await expect(secondary).toHaveCount(0);
    }
    if (record.topic_tags.length > 0) await expect(c.locator(".record-tags li")).toHaveText(record.topic_tags);
    else await expect(c.locator(".record-tags")).toHaveCount(0);

    const links = c.locator("a");
    const actual = await links.evaluateAll((nodes) => nodes.map((node) => ({ href: node.href, text: node.textContent })));
    expect(actual, `links of ${record.key}`).toEqual(expectedLinks(record));
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      await expect(link).not.toHaveAttribute("target");
    }
  }
});

test("virtual talks say 'Virtual — hosted by' with a badge; in-person talks show only their location", async ({ page }) => {
  // One check per talk: the default 30s plus a share per talk.
  test.setTimeout(30_000 + 500 * talks.length);
  await page.goto(ALL);
  await expect(page.locator("article.talk-card .virtual-badge")).toHaveCount(talks.filter(isVirtual).length);
  for (const record of talks) {
    const c = card(page, record.key);
    const location = c.locator(".talk-location");
    if (isVirtual(record)) {
      expect(await location.evaluate((node) => node.textContent), record.key).toBe(virtualWording(record));
      const badge = location.locator(".virtual-badge");
      await expect(badge).toHaveText("Virtual");
      await expect(badge).toBeVisible();
      // Distinct by shape and outline, not colour: square, double border.
      await expect(badge).toHaveCSS("border-top-style", "double");
      await expect(badge).toHaveCSS("border-top-left-radius", "0px");
    } else {
      await expect(c.locator(".virtual-badge")).toHaveCount(0);
      await expect(c.locator(".talk-location")).toHaveCount(record.location_display ? 1 : 0);
      if (record.location_display) expect(await location.evaluate((node) => node.textContent), record.key).toBe(record.location_display);
      const ownText = [record.title, record.author, record.organization, record.location_display, record.type, ...record.topic_tags].join(" ");
      if (!/hosted by/i.test(ownText)) await expect(c).not.toContainText("hosted by");
      if (!/virtual/i.test(ownText)) await expect(c).not.toContainText(/virtual/i);
    }
  }
});

test("talks without coordinates stay in the archive", async ({ page }) => {
  await page.goto(PAGE);
  const unmapped = talks.filter(isUnmapped);
  if (!liveData) expect(unmapped.length).toBeGreaterThan(0);
  for (const record of unmapped.filter((r) => !isFoundational(r))) await expect(card(page, record.key)).toBeVisible();
  for (const record of unmapped) await expect(card(page, record.key)).toHaveCount(1);
});

test("the archive keeps the ids and attributes the map will use", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator("#talk-archive-heading")).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#talk-archive-heading")).toHaveText("Talk archive");
  await expect(page.locator("#talk-records > article.talk-card")).toHaveCount(talks.length);
  await expect(page.locator("#talk-reach")).toHaveCount(1);
  await expect(page.locator("#talk-filters")).toHaveCount(1);
});

// ---- Without JavaScript ------------------------------------------------------

test("without JavaScript every talk is readable, foundational work included, with figures for all talks", { tag: "@no-js" }, async ({ page }) => {
  // One check per talk: the default 30s plus a share per talk.
  test.setTimeout(30_000 + 500 * talks.length);
  // A filter query cannot hide anything without the script.
  await page.goto(`${PAGE}?virtual=Y&year=1900`);
  await expect(page.locator("form[data-archive-filters]")).toBeHidden();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator("[data-archive-empty]")).toBeHidden();
  await expect(cards(page)).toHaveCount(talks.length);
  for (const record of talks) {
    const c = card(page, record.key);
    await expect(c).toBeVisible();
    await expect(c.getByRole("heading", { level: 3 })).toHaveText(record.title);
    await expect(c.locator("a")).toHaveCount(expectedLinks(record).length);
  }
  await expect(page.locator("#talk-reach")).toBeVisible();
  expect(await readReach(page)).toEqual(expectedReach(talks));
  await expect(page.getByRole("heading", { name: "Reach", exact: true })).toBeVisible();
});

// ---- With JavaScript -------------------------------------------------------

test("the script reveals labelled filters with options from the data and a polite result count", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator("form[data-archive-filters]")).toBeVisible();
  const c = controls(page);
  await expect(c.text).toHaveAttribute("type", "search");
  await expect(c.pillar.locator("option")).toHaveText(["All pillars", ...Object.entries(pillars).map(([name, p]) => `Pillar ${p.number}: ${name}`)]);
  const years = [...new Set(talks.map((r) => String(r.year)))].sort((a, b) => Number(b) - Number(a));
  await expect(c.year.locator("option")).toHaveText(["All years", ...years]);
  await expect(c.type.locator("option")).toHaveText(["All types", ...[...new Set(talks.map((r) => r.type))].sort()]);
  const scopes = SCOPES.filter((scope) => talks.some((r) => r.event_scope === scope));
  await expect(c.scope.locator("option")).toHaveText(["All scopes", ...scopes.map(capitalized)]);
  expect(await c.scope.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value))).toEqual(["", ...scopes]);
  const formats = ["N", "Y"].filter((value) => talks.some((r) => r.virtual_status === value));
  await expect(c.virtual.locator("option")).toHaveText(["All formats", ...formats.map(formatLabel)]);
  await expect(c.foundational).toHaveAttribute("type", "checkbox");
  await expect(c.foundational).not.toBeChecked();
  const count = page.locator("#talk-filters").getByRole("status");
  await expect(count).toHaveAttribute("aria-live", "polite");
  await expect(count).toHaveAttribute("aria-atomic", "true");
  await expectView(page, DEFAULT);
  await expect(page.getByRole("button", { name: "Reset filters" })).toBeVisible();
});

test("foundational work is hidden by default and revealed by its labelled checkbox", { tag: "@js" }, async ({ page }) => {
  const foundational = talks.filter(isFoundational);
  if (!liveData) expect(foundational.length, "fixture data has a foundational talk").toBeGreaterThan(0);
  await page.goto(PAGE);
  await expectView(page, DEFAULT);
  for (const record of foundational) await expect(card(page, record.key)).toBeHidden();
  if (foundational.length > 0) await expect(page.locator("[data-archive-count]")).toContainText(`(${foundational.length} foundational`);

  await controls(page).foundational.check();
  await expectView(page, { foundational: INCLUDE });
  for (const record of foundational) await expect(card(page, record.key)).toBeVisible();
  expect(queryOf(page)).toEqual({ foundational: INCLUDE });
  await expect(page.locator("[data-archive-count]")).toHaveText(`Showing ${talks.length} of ${talks.length} ${talks.length === 1 ? "talk" : "talks"}`);

  await page.reload();
  await expectControls(page, { foundational: INCLUDE });
  await expectView(page, { foundational: INCLUDE });

  await controls(page).foundational.uncheck();
  await expectView(page, DEFAULT);
  expect(new URL(page.url()).search).toBe("");
});

test("combined filters match the reference, survive a reload and reset", { tag: "@js" }, async ({ page }) => {
  // Each sampled talk is filtered, reloaded and reset: the default 30s plus a
  // share per talk.
  test.setTimeout(30_000 + 5_000 * sampled.length);
  for (const record of sampled) {
    const state = stateFor(record);
    expect(expectedKeys(state), `${record.key} matches its own filters`).toContain(record.key);

    await page.goto(PAGE);
    await applyFilters(page, state);
    await expectView(page, state);
    expect(queryOf(page)).toEqual(canonical(state));

    await page.reload();
    await expectControls(page, canonical(state));
    await expectView(page, state);

    await page.getByRole("button", { name: "Reset filters" }).click();
    await expectControls(page, DEFAULT);
    await expectView(page, DEFAULT);
    expect(new URL(page.url()).search).toBe("");
  }
  // Two facets that exclude each other give nothing, not the union.
  const virtualTalk = talks.find(isVirtual);
  const inPerson = talks.find((r) => !isVirtual(r) && r.year !== virtualTalk?.year);
  if (virtualTalk && inPerson) {
    const state = { virtual: "Y", year: String(inPerson.year), type: inPerson.type };
    await page.goto(PAGE);
    await applyFilters(page, state);
    await expectView(page, state);
  }
});

test("each filter alone matches the reference", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  const first = talks[0];
  const states = [
    ...Object.keys(pillars).map((pillar) => ({ pillar })),
    ...[...new Set(talks.map((r) => String(r.year)))].slice(0, 3).map((year) => ({ year })),
    ...[...new Set(talks.map((r) => r.type))].map((type) => ({ type })),
    ...[...new Set(talks.map((r) => r.event_scope))].map((scope) => ({ scope })),
    { virtual: "Y" },
    { virtual: "N" },
    { foundational: INCLUDE },
    { text: searchTerm(first) },
    { text: first.author.split(/[;,]/)[0] },
    { text: first.organization.split(" ").slice(-1)[0] },
    ...(first.location_display ? [{ text: first.location_display.split(",")[0] }] : []),
    { text: first.type },
    ...(first.topic_tags.length > 0 ? [{ text: first.topic_tags[0] }] : []),
    // Every term must match, possibly in different fields.
    { text: `${first.author.split(/[;,]/)[0]} ${searchTerm(first)}` },
    { text: `${searchTerm(first)} zz-absent-term` }
  ];
  // As many states as the data has years, types and scopes: the default 30s
  // plus a share per state.
  test.setTimeout(30_000 + 1_500 * states.length);
  for (const state of states) {
    await applyFilters(page, state);
    await expectView(page, state);
  }
  // The pillar filter finds records through their secondary pillar.
  const multi = talks.find((r) => r.secondary_pillar && !isFoundational(r));
  if (!liveData) expect(multi).toBeTruthy();
  if (multi) {
    await applyFilters(page, { pillar: multi.secondary_pillar });
    expect(await visibleKeys(page)).toContain(multi.key);
  }
});

test("pillar links reconstruct the filter on load and agree with pillars.json", { tag: "@js" }, async ({ page }) => {
  // One archive load per pillar, each listing every talk: the default 30s
  // plus a share per talk.
  test.setTimeout(30_000 + 500 * talks.length);
  for (const [name, pillar] of Object.entries(pillars)) {
    await page.goto(`${PAGE}?pillar=${encodeURIComponent(name)}`);
    await expectControls(page, { pillar: name });
    await expectView(page, { pillar: name });
    const shownByDefault = pillar.talks.keys.filter((key) => !isFoundational(talks.find((r) => r.key === key)));
    expect(await visibleKeys(page), name).toEqual(shownByDefault);

    await page.goto(`${PAGE}?pillar=${encodeURIComponent(name)}&foundational=include`);
    await expectControls(page, { pillar: name, foundational: INCLUDE });
    expect(await visibleKeys(page), `${name} with foundational work`).toEqual(pillar.talks.keys);
    await expectView(page, { pillar: name, foundational: INCLUDE });
  }
  // A link with different case and spacing is read and rewritten canonically.
  const [name] = Object.keys(pillars);
  await page.goto(`${PAGE}?pillar=${encodeURIComponent(`  ${name.toUpperCase()} `)}`);
  await expectControls(page, { pillar: name });
  expect(queryOf(page)).toEqual({ pillar: name });
});

test("a talk without coordinates can be found with every filter", { tag: "@js" }, async ({ page }) => {
  const unmapped = talks.filter(isUnmapped);
  if (!liveData) expect(unmapped.length, "fixture data has a talk without coordinates").toBeGreaterThan(0);
  for (const record of unmapped.slice(0, 3)) {
    const state = stateFor(record);
    await page.goto(PAGE);
    await applyFilters(page, state);
    await expectView(page, state);
    await expect(card(page, record.key)).toBeVisible();
  }
});

test("no matches shows the empty state, whose reset restores the default view", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  const state = { text: "zz-no-such-talk-qq" };
  expect(expectedKeys(state)).toEqual([]);
  await applyFilters(page, state);
  await expectView(page, state);
  const empty = page.locator("[data-archive-empty]");
  await expect(empty).toHaveText(/^No talks match these filters\./);
  await empty.getByRole("button", { name: "Reset filters" }).click();
  await expectView(page, DEFAULT);
  await expect(controls(page).text).toBeFocused();
  expect(new URL(page.url()).search).toBe("");
});

test("query parameters set the filters; unknown keys and values are ignored", { tag: "@js" }, async ({ page }) => {
  const record = talks.find((r) => !isFoundational(r));
  const year = String(record.year);
  await page.goto(`${PAGE}?utm_source=x&year=${year}&type=Not%20a%20type&scope=global&virtual=maybe&foundational=yes&status=Published&pillar=Typo#talk-records`);
  await expectControls(page, { year });
  await expectView(page, { year });
  expect(new URL(page.url()).search).toBe(`?year=${year}`);
  expect(new URL(page.url()).hash).toBe("#talk-records");

  // Arriving from the site search (?q=...) leaves the archive unfiltered.
  await page.goto(`${PAGE}?q=${encodeURIComponent(searchTerm(record).trim())}&scope=${record.event_scope}`);
  await expectControls(page, { scope: record.event_scope });
  await expectView(page, { scope: record.event_scope });
  expect(new URL(page.url()).search).toBe(`?scope=${record.event_scope}`);

  await page.goto(`${PAGE}?unknown=1&text=&virtual=`);
  await expectControls(page, DEFAULT);
  await expectView(page, DEFAULT);
  expect(new URL(page.url()).search).toBe("");
});

test("filters and reset still work when the browser refuses to rewrite the URL", { tag: "@js" }, async ({ page }) => {
  await page.addInitScript(() => {
    History.prototype.replaceState = () => {
      throw new DOMException("replaceState blocked by the test", "SecurityError");
    };
  });
  const record = talks.find((r) => !isFoundational(r));
  const year = String(record.year);
  // The unknown key makes the first sync try to rewrite the URL.
  await page.goto(`${PAGE}?year=${year}&utm_source=x`);
  await expect(page.locator("form[data-archive-filters]")).toBeVisible();
  await expectControls(page, { year });
  await expectView(page, { year });
  await applyFilters(page, { type: record.type, virtual: record.virtual_status });
  await expectView(page, { type: record.type, virtual: record.virtual_status });
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expectView(page, DEFAULT);
  expect(new URL(page.url()).search).toBe(`?year=${year}&utm_source=x`);
});

test("in-page links to the archive raise no script errors", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  // A hash change (for example a "view talks as a list" link) re-runs
  // Quarto's listing script; the test fixture fails on any page error.
  await page.evaluate(() => { window.location.hash = "talk-archive-heading"; });
  await expect(page).toHaveURL(/#talk-archive-heading$/);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  await expectView(page, DEFAULT);
});

test("filters work from the keyboard with a visible focus ring", { tag: "@js" }, async ({ page }) => {
  await page.goto(PAGE);
  const c = controls(page);
  await c.text.focus();
  const term = searchTerm(talks[0]);
  await page.keyboard.type(term);
  await expectView(page, { text: term });
  for (const control of [c.text, c.pillar, c.year, c.type, c.scope, c.virtual, c.foundational]) {
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style", "solid");
    await expect(control).toHaveCSS("outline-width", "3px");
    await page.keyboard.press("Tab");
  }
  const reset = page.getByRole("button", { name: "Reset filters" });
  await expect(reset).toBeFocused();
  await expect(reset).toHaveCSS("outline-width", "3px");
  // Space toggles the checkbox from the keyboard.
  await c.foundational.focus();
  await page.keyboard.press("Space");
  await expectView(page, { text: term, foundational: INCLUDE });
  await reset.focus();
  await page.keyboard.press("Enter");
  await expectView(page, DEFAULT);
  // Every control is at least 24 by 24 CSS pixels.
  for (const control of [c.text, c.pillar, c.year, c.type, c.scope, c.virtual, c.foundational, reset]) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

// ---- Template escaping (synthetic hostile records, rendered separately) -----

test.describe("talk template escaping", { tag: "@js" }, () => {
  const origin = "http://hostile.test";
  const names = Object.keys(pillars);
  const city = `City" onmouseover="window.__pwned=7`;
  const region = "<b>Region</b>";
  const country = "Country ``` <i>x</i>";
  const hostile = [
    {
      key: `x"><img src=x onerror="window.__pwned=1">'`,
      author: `Mallory, M.; O'Brien, "Q."; <img src=x onerror="window.__pwned=2">`,
      title: "Bad </script><script>window.__pwned=3</script> *emph* [link](javascript:window.__pwned=4) & 'q' \"qq\"\n```\n<b>after fence</b> ${window.__pwned=5}",
      date: "2025-03-04",
      year: 2025,
      organization: `Org <i>"quoted"</i> & 'co' </script><svg onload="window.__pwned=6">`,
      type: `Talk"><svg onload="window.__pwned=13">`,
      location_city: city,
      location_region: region,
      location_country: country,
      presented_by_me: "Y",
      primary_pillar: names[0],
      secondary_pillar: names[1],
      topic_tags: ["<svg onload=\"window.__pwned=8\">", "```", "<%= 'template' %>"],
      foundational_work: "N",
      virtual_status: "Y",
      event_scope: `international"><img src=x onerror="window.__pwned=9">`,
      event_url: "javascript:window.__pwned=10",
      slides_url: "https://example.org/s\"onmouseover=\"window.__pwned=11",
      poster_url: "mailto:someone@example.org",
      recording_url: "http://example.org/insecure",
      slug: `bad"slug><img src=x onerror=window.__pwned=12>`,
      location_display: [city, region, country].join(", ")
    },
    {
      key: "hostile-plain",
      author: "García, M.; Müller, K.",
      title: "Plain in-person poster",
      date: "2024-01-31",
      year: 2024,
      organization: "Plain Host",
      type: "Poster",
      location_country: "Testonia",
      presented_by_me: "Y",
      primary_pillar: names[3],
      topic_tags: [],
      foundational_work: "Y",
      virtual_status: "N",
      event_scope: "local",
      slug: "hostile-plain",
      location_display: "Testonia"
    }
  ];
  // The first record is mapped (at its host: it is virtual), with the same
  // hostile text in its GeoJSON properties.
  const hostileGeojson = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [151.1111, -33.3333] },
      properties: {
        key: hostile[0].key,
        title: hostile[0].title,
        organization: hostile[0].organization,
        location: hostile[0].location_display,
        virtual_status: "Y",
        primary_pillar: hostile[0].primary_pillar,
        year: hostile[0].year
      }
    }]
  };
  let scratch;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    scratch = renderScratchSite(
      "talk-template-",
      ["talks/index.qmd", "templates/talk.ejs.md", "js/archive-filters.js", "js/filter-core.js", "js/talks-map.js", "js/map-state.js", "assets/vendor", "styles"],
      { "talks.yml": hostile, "talks.geojson": hostileGeojson },
      // The site's styles give the map its height.
      { resources: ["js/*.js", "assets/vendor/**", "data/generated/talks.geojson"], theme: "styles/styles.scss" }
    );
  });

  test.afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("hostile text renders as text, never as markup, script or a link", async ({ page }) => {
    await routeScratchSite(page, scratch, origin);
    await page.goto(`${origin}${PAGE}`);
    await expect(page.locator("form[data-archive-filters]")).toBeVisible();
    await expect(page.locator("#talk-map")).toHaveAttribute("data-map-state", "ready");

    // Outside the Leaflet container (tiles are images there; its own test is
    // below), nothing in the listing is an element the data could inject.
    const listing = page.locator("#listing-talks");
    await expect(listing.locator(":is(img, svg, b, i, em, strong, iframe, object, embed, script):not(#talk-map-canvas *)")).toHaveCount(0);
    const handlers = await listing.locator("*").evaluateAll((nodes) =>
      nodes.flatMap((node) => [...node.attributes].map((attr) => attr.name)).filter((name) => name.startsWith("on")));
    expect(handlers).toEqual([]);
    // The map region's own links are static.
    expect(await listing.locator("#talk-map a:not(#talk-map-canvas *)").evaluateAll((nodes) => nodes.map((node) => [node.hash, node.textContent])))
      .toEqual([["#talk-archive-heading", "Skip map and view talks"], ["#talk-archive-heading", "View talks as a list"]]);
    const links = await listing.locator("a:not(#talk-map *)").evaluateAll((nodes) => nodes.map((node) => ({ href: node.href, text: node.textContent })));
    expect(links).toEqual(hostile.flatMap(expectedLinks));
    expect(links.map((link) => link.href)).toEqual([asUrl(hostile[0].slides_url), "mailto:someone@example.org"]);

    const textOf = (locator) => locator.evaluate((node) => node.textContent);
    for (const record of hostile) {
      const c = card(page, record.key);
      await expect(c).toHaveCount(1);
      expect(await c.evaluate((node) => node.id)).toBe(`talk-${record.slug}`);
      expect(await c.evaluate((node) => node.getAttribute("aria-labelledby"))).toBe(`talk-${record.slug}-title`);
      expect(await c.locator(".record-title").evaluate((node) => node.id)).toBe(`talk-${record.slug}-title`);
      expect(await c.evaluate((node) => ({ ...node.dataset }))).toEqual({
        key: record.key,
        date: record.date,
        year: String(record.year),
        type: record.type,
        scope: record.event_scope,
        virtual: record.virtual_status,
        host: record.organization,
        city: record.location_city ?? "",
        country: record.location_country ?? "",
        primaryPillar: record.primary_pillar,
        secondaryPillar: record.secondary_pillar ?? "",
        foundational: record.foundational_work,
        links: String(expectedLinks(record).length)
      });
      expect(await textOf(c.locator(".record-title"))).toBe(record.title);
      expect(await textOf(c.locator(".record-authors"))).toBe(record.author);
      expect(await textOf(c.locator(".talk-host"))).toBe(record.organization);
      expect(await textOf(c.locator(".talk-location"))).toBe(isVirtual(record) ? virtualWording(record) : record.location_display);
      expect(await textOf(c.locator(".talk-type"))).toBe(record.type);
      expect(await textOf(c.locator(".talk-scope"))).toBe(capitalized(record.event_scope));
      expect(await c.locator(".record-tags li").evaluateAll((nodes) => nodes.map((node) => node.textContent))).toEqual(record.topic_tags);
    }
    const c = controls(page);
    expect(await c.type.locator("option").evaluateAll((nodes) => nodes.map((node) => [node.value, node.textContent])))
      .toEqual([["", "All types"], ...[...new Set(hostile.map((r) => r.type))].sort().map((type) => [type, type])]);
    expect(await c.scope.locator("option").evaluateAll((nodes) => nodes.map((node) => node.value)))
      .toEqual(["", "local", hostile[0].event_scope]);

    // The script reads the same text without turning it into markup, and the
    // search ignores accents.
    await expectView(page, DEFAULT, hostile);
    await c.text.fill("garcia muller");
    await expectView(page, { text: "garcia muller" }, hostile);
    await expect(page.locator("[data-archive-count]")).toHaveText("Showing 0 of 2 talks (1 foundational talk hidden)");
    await c.foundational.check();
    await expectView(page, { text: "garcia muller", foundational: INCLUDE }, hostile);
    await c.text.fill("after fence");
    await expectView(page, { text: "after fence", foundational: INCLUDE }, hostile);
    expect(await visibleKeys(page)).toEqual([hostile[0].key]);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("hostile text in the map's markers and popups stays text", async ({ page }) => {
    await routeScratchSite(page, scratch, origin);
    await page.goto(`${origin}${PAGE}`);
    const map = page.locator("#talk-map");
    await expect(map).toHaveAttribute("data-map-state", "ready");
    const record = hostile[0];
    expect(JSON.parse(await page.locator("#talk-map-canvas").getAttribute("data-marker-keys"))).toEqual([record.key]);
    const marker = page.locator(`#talk-map-canvas .talk-marker[data-key=${cssString(record.key)}]`);
    await expect(marker).toHaveCount(1);
    const label = `${record.title}. Virtual, hosted by ${record.organization}, ${record.location_display}. Pillar 1.`;
    await expect(marker).toHaveAttribute("aria-label", label);
    await expect(marker).toHaveAttribute("title", label);

    await card(page, record.key).getByRole("button", { name: /^Show on map/ }).click();
    const popup = page.locator("#talk-map-canvas .talk-popup");
    await expect(popup).toBeVisible();
    const textOf = (locator) => locator.evaluate((node) => node.textContent);
    expect(await textOf(popup.locator(".talk-popup-place"))).toBe(`Host location: ${record.location_display}`);
    expect(await textOf(popup.locator(".talk-popup-title"))).toBe(record.title);
    expect(await textOf(popup.locator(".talk-popup-meta"))).toBe(`Virtual Hosted by ${record.organization} · ${record.year}`);
    expect(await popup.locator(".talk-popup-title").getAttribute("href")).toBe(`#talk-${record.slug}`);
    // Only the popup's own elements, without handlers or other attributes
    // carrying data.
    const tags = await popup.locator("*").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.tagName.toLowerCase()))].sort());
    expect(tags).toEqual(["a", "li", "p", "span", "ul"]);
    const attributes = await popup.locator("*").evaluateAll((nodes) => [...new Set(nodes.flatMap((node) => [...node.attributes].map((attr) => attr.name)))].sort());
    expect(attributes).toEqual(["class", "data-key", "href"]);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});
