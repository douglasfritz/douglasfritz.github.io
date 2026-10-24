// Failure and empty states (spec 4.5, 19) as one matrix. Each row is checked
// here, or by the test named beside it in another spec (not repeated here):
//
//   State                                   Where
//   No matches (both archives): message,    here (keyboard, focus, live region);
//     real reset button, live region          publications.spec.mjs and
//                                             talks-archive.spec.mjs: "no
//                                             matches shows the empty state ..."
//   talks.geojson: HTTP 503, network        here (reason, one message, confined
//     failure, invalid JSON, not a            to the map region, archive usable);
//     FeatureCollection                       talks-map.spec.mjs: "a GeoJSON
//                                             error (503) ...", "GeoJSON with ..."
//   Leaflet or markercluster not loaded     here; talks-map.spec.mjs: "a missing
//                                             map library ..."
//   OpenStreetMap tiles blocked             here (reason); talks-map.spec.mjs:
//                                             "failed tiles keep the map ..."
//   An error inside the map's own code      here
//   js/talks-map.js not loaded              here
//   js/archive-filters.js not loaded        here (publications);
//                                             talks-map.spec.mjs (talks): "if the
//                                             archive script fails ..."
//   js/pillars.js not loaded                here (Home and Research)
//   Script errors and failed requests       support.mjs fails every test on any
//     anywhere                                it did not declare; here: a control
//                                             that the rule is enforced
//   Records without coordinates             talks-map.spec.mjs: "talks without
//                                             coordinates never get a marker ..."
//   Empty generated data                    the build fails (R, spec 19)
//
// Data-driven: every expectation comes from data/generated/ at test time.
import { load as loadYaml } from "js-yaml";
import { expectVisibleFocus, focusedElement } from "./helpers.mjs";
import { TILE_URL_PATTERN, expect, liveData, readGenerated, test } from "./support.mjs";

const publications = loadYaml(readGenerated("publications.yml"));
const talks = loadYaml(readGenerated("talks.yml"));
const geojson = JSON.parse(readGenerated("talks.geojson"));
const MAP_MESSAGES = {
  unavailable: "The map could not be loaded. Every talk is still listed below.",
  tiles: "Some background map tiles could not be loaded. The markers and the list below still work."
};
const shownByDefault = (records) => records.filter((record) => record.foundational_work !== "Y").map((record) => record.key);
const visibleKeys = (page, container) => page.locator(`${container} > article:visible`).evaluateAll((nodes) => nodes.map((node) => node.dataset.key));
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// ---- No matches ------------------------------------------------------------------

const ARCHIVES = {
  publications: { route: "/publications/", records: publications, container: "#publication-records", search: "Search publications", nouns: ["publication", "publications"] },
  talks: { route: "/talks/", records: talks, container: "#talk-records", search: "Search talks", nouns: ["talk", "talks"] }
};

for (const [kind, archive] of Object.entries(ARCHIVES)) {
  test(`${kind}: no matches gives a message, a live count and a reset button that works from the keyboard`, { tag: "@js" }, async ({ page }) => {
    await page.goto(archive.route);
    const search = page.getByLabel(archive.search);
    const count = page.locator("[data-archive-count]");
    const empty = page.locator(`${archive.container} [data-archive-empty]`);
    // The result count is a polite, atomic live region.
    await expect(count).toHaveAttribute("role", "status");
    await expect(count).toHaveAttribute("aria-live", "polite");
    await expect(count).toHaveAttribute("aria-atomic", "true");
    await expect(count).toHaveText(new RegExp(`^Showing ${shownByDefault(archive.records).length} of ${archive.records.length} `));
    await expect(empty).toBeHidden();

    // Typing a search with no match: the cards go, the message and its
    // button show, the live region says so, and focus stays in the box.
    await search.focus();
    await page.keyboard.type("zz-no-such-record-qq");
    await expect(page.locator(`${archive.container} > article:visible`)).toHaveCount(0);
    await expect(count).toHaveText(new RegExp(`^Showing 0 of ${archive.records.length} ${archive.nouns[archive.records.length === 1 ? 0 : 1]}`));
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText(`No ${archive.nouns[1]} match these filters. Reset filters`);
    await expect(search).toBeFocused();

    // The reset button in the message is a real button, reached by Tab.
    const reset = empty.getByRole("button", { name: "Reset filters" });
    await expect(reset).toHaveAttribute("type", "button");
    for (let i = 0; i < 200 && !(await reset.evaluate((node) => node === document.activeElement)); i += 1) await page.keyboard.press("Tab");
    await expect(reset).toBeFocused();
    await expect.poll(async () => (await focusedElement(page)).visible, { message: "the focused reset button is in view" }).toBe(true);
    expectVisibleFocus(await focusedElement(page), `${kind} empty-state reset`);
    await page.keyboard.press("Enter");
    // Everything is back, and focus moves to the first filter (the button
    // itself has gone with the message).
    expect(await visibleKeys(page, archive.container)).toEqual(shownByDefault(archive.records));
    await expect(empty).toBeHidden();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(count).toHaveText(new RegExp(`^Showing ${shownByDefault(archive.records).length} of `));
  });
}

// ---- The talk map ------------------------------------------------------------------

const region = (page) => page.locator("#talk-map");

// The map shows one short message in its own region and nothing else of
// itself; the archive below is complete and still filters.
async function expectMapUnavailable(page, reason) {
  await expect(region(page)).toHaveAttribute("data-map-state", "unavailable");
  await expect(region(page)).toHaveAttribute("data-map-reason", reason);
  const message = page.getByText(MAP_MESSAGES.unavailable, { exact: true });
  await expect(message).toHaveCount(1);
  await expect(region(page).locator("[data-talk-map-message]")).toHaveText(MAP_MESSAGES.unavailable);
  await expect(region(page).locator("[data-talk-map-message]")).toHaveAttribute("role", "status");
  // The region shows its heading and the message only: no map, legend,
  // introduction or links.
  expect((await region(page).innerText()).replace(/\s+/g, " ").trim()).toBe(`Talk locations ${MAP_MESSAGES.unavailable}`);
  await expect(page.getByRole("button", { name: /^Show on map/ })).toHaveCount(0);
  expect(await visibleKeys(page, "#talk-records")).toEqual(shownByDefault(talks));
  await page.getByLabel("Include foundational work").check();
  expect(await visibleKeys(page, "#talk-records")).toEqual(talks.map((record) => record.key));
}

const GEOJSON = "**/data/generated/talks.geojson";
const MAP_FAILURES = [
  {
    name: "talks.geojson answers HTTP 503",
    reason: "data-fetch",
    block: (route) => route.fulfill({ status: 503, contentType: "application/geo+json", body: JSON.stringify(geojson) }),
    url: GEOJSON,
    pageErrors: [/^console\.error: Failed to load resource: the server responded with a status of 503 .*\/data\/generated\/talks\.geojson\)$/],
    requestFailures: [/^503 .*\/data\/generated\/talks\.geojson$/]
  },
  {
    name: "talks.geojson does not load",
    reason: "data-fetch",
    block: (route) => route.abort(),
    url: GEOJSON,
    pageErrors: [/^console\.error: Failed to load resource: net::ERR_FAILED \(.*\/data\/generated\/talks\.geojson\)$/],
    requestFailures: [/^net::ERR_FAILED .*\/data\/generated\/talks\.geojson$/]
  },
  {
    name: "talks.geojson is not JSON",
    reason: "data-invalid",
    block: (route) => route.fulfill({ status: 200, contentType: "application/geo+json", body: "{ not json" }),
    url: GEOJSON
  },
  {
    name: "talks.geojson is not a FeatureCollection",
    reason: "data-invalid",
    block: (route) => route.fulfill({ status: 200, contentType: "application/geo+json", body: '{"type":"Feature"}' }),
    url: GEOJSON
  },
  ...["leaflet/leaflet.js", "leaflet.markercluster/leaflet.markercluster.js"].map((file) => ({
    name: `${file} does not load`,
    reason: "library",
    block: (route) => route.abort(),
    url: `**/assets/vendor/${file}`,
    pageErrors: [new RegExp(`^console\\.error: Failed to load resource: net::ERR_FAILED \\(.*${escapeRegExp(`/assets/vendor/${file}`)}\\)$`)],
    requestFailures: [new RegExp(`^net::ERR_FAILED .*${escapeRegExp(`/assets/vendor/${file}`)}$`)]
  }))
];

for (const failure of MAP_FAILURES) {
  test(`map: when ${failure.name}, one message in the map region says why the map is missing; the archive works`, { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
    expectedPageErrors.push(...(failure.pageErrors ?? []));
    expectedRequestFailures.push(...(failure.requestFailures ?? []));
    await page.route(failure.url, failure.block);
    await page.goto("/talks/");
    await expectMapUnavailable(page, failure.reason);
  });
}

test("map: an error in the map's own code replaces the map with the message, raises no page error, and the archive works", { tag: "@js" }, async ({ page }) => {
  expect(geojson.features.length, "a talk with a map location").toBeGreaterThan(0);
  await page.goto("/talks/");
  await expect(region(page)).toHaveAttribute("data-map-state", "ready");
  await expect(region(page)).not.toHaveAttribute("data-map-reason");
  // A filter change that changes the markers makes the map close any popup
  // first; here that throws.
  const before = JSON.parse(await page.locator("#talk-map-canvas").getAttribute("data-marker-keys"));
  await page.evaluate(() => {
    window.L.Map.prototype.closePopup = () => {
      throw new Error("injected by the test");
    };
  });
  if (before.length > 0) await page.getByLabel("Search talks").fill("zz-no-such-talk-qq");
  else await page.getByLabel("Include foundational work").check();
  await expect(region(page)).toHaveAttribute("data-map-state", "unavailable");
  await page.getByRole("button", { name: "Reset filters" }).first().click();
  await expectMapUnavailable(page, "script");
});

test("map: blocked tiles leave the map working with a note in its region", { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
  expectedPageErrors.push(/^console\.error: Failed to load resource: net::ERR_FAILED \(https:\/\/tile\.openstreetmap\.org\/.*\)$/);
  expectedRequestFailures.push(/^net::ERR_FAILED https:\/\/tile\.openstreetmap\.org\//);
  await page.route(TILE_URL_PATTERN, (route) => route.abort());
  await page.goto("/talks/");
  await expect(region(page)).toHaveAttribute("data-map-state", "ready");
  await expect(region(page)).toHaveAttribute("data-map-reason", "tiles");
  await expect(region(page).locator("[data-talk-map-message]")).toHaveText(MAP_MESSAGES.tiles);
  await expect(page.getByText(MAP_MESSAGES.tiles, { exact: true })).toHaveCount(1);
  await expect(region(page).locator("[data-talk-map-body]")).toBeVisible();
  await expect(region(page).locator(".talk-map-intro")).toBeVisible();
});

test("map: when js/talks-map.js does not load, no empty map box shows and every talk is listed", { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
  expectedPageErrors.push(/^console\.error: Failed to load resource: net::ERR_FAILED \(.*\/js\/talks-map\.js\)$/);
  expectedRequestFailures.push(/^net::ERR_FAILED .*\/js\/talks-map\.js$/);
  await page.route("**/js/talks-map.js", (route) => route.abort());
  await page.goto("/talks/");
  await expect(page.locator("form[data-archive-filters]")).toBeVisible();
  await expect(region(page)).toBeHidden();
  await expect(region(page)).not.toHaveAttribute("data-map-state");
  await expect(page.getByRole("button", { name: /^Show on map/ })).toHaveCount(0);
  expect(await visibleKeys(page, "#talk-records")).toEqual(shownByDefault(talks));
});

// ---- Scripts that do not load --------------------------------------------------

test("publications: when js/archive-filters.js does not load, every card shows and no control is left without its script", { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
  expectedPageErrors.push(/^console\.error: Failed to load resource: net::ERR_FAILED \(.*\/js\/archive-filters\.js\)$/);
  expectedRequestFailures.push(/^net::ERR_FAILED .*\/js\/archive-filters\.js$/);
  await page.route("**/js/archive-filters.js", (route) => route.abort());
  await page.goto("/publications/?pillar=none&text=zz");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("form[data-archive-filters]")).toBeHidden();
  await expect(page.locator("[data-archive-empty]")).toBeHidden();
  expect(await visibleKeys(page, "#publication-records")).toEqual(publications.map((record) => record.key));
  const controls = await page.locator("main").locator("button, input, select").evaluateAll((nodes) => nodes.filter((node) => node.checkVisibility()).length);
  expect(controls).toBe(0);
});

for (const route of ["/", "/research/"]) {
  test(`${route}: when js/pillars.js does not load, all four pillars are shown in full`, { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
    expectedPageErrors.push(/^console\.error: Failed to load resource: net::ERR_FAILED \(.*\/js\/pillars\.js\)$/);
    expectedRequestFailures.push(/^net::ERR_FAILED .*\/js\/pillars\.js$/);
    await page.route("**/js/pillars.js", (route) => route.abort());
    await page.goto(route);
    const component = page.locator("[data-pillar-component]");
    await expect(component).toHaveCount(1);
    // Other scripts ran (the skip link's target is focusable) ...
    await expect(page.locator("#quarto-document-content")).toHaveAttribute("tabindex", "-1");
    // ... but the component was never enhanced: every panel is open.
    await expect(component).not.toHaveClass(/\bjs-enhanced\b/);
    await expect(component.locator(".pillar-hint")).toBeHidden();
    for (let n = 1; n <= 4; n += 1) {
      await expect(page.locator(`#pillar-${n}-panel`)).toBeVisible();
      await expect(page.locator(`#pillar-${n}-toggle`)).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(`#pillar-${n} .pillar-toggle-state`)).toBeHidden();
      for (const kind of ["publications", "talks"]) await expect(page.locator(`#pillar-${n} [data-pillar-kind="${kind}"] a`)).toBeVisible();
    }
  });
}

// ---- The page-error rule is enforced ---------------------------------------------

test("control: an undeclared script error fails the test", { tag: "@js" }, async ({ page }) => {
  test.fail(true, "support.mjs must fail a test whose page throws an error it did not declare");
  await page.goto("/about/");
  await page.evaluate(() => setTimeout(() => {
    throw new Error("undeclared error injected by the test");
  }));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
});

test("control: a declared error that never happens fails the test", { tag: "@js" }, async ({ page, expectedPageErrors }) => {
  test.fail(true, "support.mjs must fail a test whose declared error does not occur");
  expectedPageErrors.push(/^pageerror: an error that never happens$/);
  await page.goto("/about/");
});

test("the data exercise these states", () => {
  expect(talks.length).toBeGreaterThan(0);
  expect(publications.length).toBeGreaterThan(0);
  expect(geojson.type).toBe("FeatureCollection");
  if (!liveData) {
    expect(geojson.features.length).toBeGreaterThan(0);
    expect(talks.some((record) => record.foundational_work === "Y"), "a foundational talk (hidden by default)").toBe(true);
  }
});
