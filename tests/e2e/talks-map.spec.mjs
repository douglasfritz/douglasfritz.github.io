// Browser tests for the talk map (js/talks-map.js, js/map-state.js, the map
// region in templates/talk.ejs.md). Like the archive tests they are
// data-driven: expectations come from data/generated/ at test time, so the
// suite runs on the synthetic fixtures and on the live sheet (E2E_DATA=live
// relaxes only the checks that need particular content).
//
// Map tiles never leave the machine: support.mjs serves a blank tile for every
// tile.openstreetmap.org request. The marker keys come from the map's test
// hook, #talk-map-canvas[data-marker-keys] (a sorted JSON array of the keys in
// the cluster group, updated on every sync).
import { load as loadYaml } from "js-yaml";
import { TILE_URL_PATTERN, cssString, expect, liveData, readGenerated, test } from "./support.mjs";

const talks = loadYaml(readGenerated("talks.yml"));
const geojson = JSON.parse(readGenerated("talks.geojson"));
const pillars = JSON.parse(readGenerated("pillars.json"));
const features = geojson.features;
const PAGE = "/talks/";
const INCLUDE = "include";
const MESSAGES = {
  unavailable: "The map could not be loaded. Every talk is still listed below.",
  tiles: "Some background map tiles could not be loaded. The markers and the list below still work."
};

// ---- Reference model ---------------------------------------------------------

const talkByKey = new Map(talks.map((record) => [record.key, record]));
const mapped = new Set(features.map((feature) => feature.properties.key));
const featureOf = (key) => features.find((feature) => feature.properties.key === key);
const isVirtual = (feature) => feature.properties.virtual_status === "Y";
const isFoundational = (key) => talkByKey.get(key).foundational_work === "Y";
const shownByDefault = talks.filter((record) => record.foundational_work !== "Y").map((record) => record.key);
const placeOf = (feature) => JSON.stringify([...feature.geometry.coordinates, feature.properties.location ?? null]);
const sharedPlaces = [...Map.groupBy(features, placeOf).values()].filter((group) => group.length > 1);
const mappedOf = (keys) => keys.filter((key) => mapped.has(key)).sort();
// (RegExp.escape is not in Node 22, which CI uses.)
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function coverageText(mappedCount, listed) {
  if (listed === 0) return "No talks are listed, so the map shows no markers.";
  const text = `${mappedCount} of ${listed} listed ${listed === 1 ? "talk" : "talks"} ${mappedCount === 1 ? "has" : "have"} a map location.`;
  return mappedCount < listed ? `${text} Talks without one appear only in the list.` : text;
}

// ---- Page helpers ------------------------------------------------------------

const region = (page) => page.locator("#talk-map");
const canvas = (page) => page.locator("#talk-map-canvas");
const card = (page, key) => page.locator(`article.talk-card[data-key=${cssString(key)}]`);
const heading = (page, key) => card(page, key).locator(".record-title");
const markerIcon = (page, key) => page.locator(`#talk-map-canvas .talk-marker[data-key=${cssString(key)}]`);
const showButton = (page, key) => card(page, key).getByRole("button", { name: /^Show on map/ });
const popup = (page) => page.locator("#talk-map-canvas .talk-popup");
const markerKeys = async (page) => JSON.parse(await canvas(page).getAttribute("data-marker-keys"));
const visibleKeys = (page) => page.locator("article.talk-card:visible").evaluateAll((nodes) => nodes.map((node) => node.dataset.key));

// Waits until the page has stopped scrolling (a smooth scroll to a card or
// the map), so that the next step does not interrupt it.
async function settled(page) {
  await expect.poll(() => page.evaluate(() => new Promise((resolve) => {
    const y = window.scrollY;
    setTimeout(() => resolve(window.scrollY === y), 150);
  }))).toBe(true);
}

async function openMap(page, url = PAGE) {
  await page.goto(url);
  await expect(region(page)).toHaveAttribute("data-map-state", "ready");
}

// Markers drawn on the map: single icons plus the counts on cluster icons,
// each centred inside the map (the view fits every marker).
const markersDrawn = (page) => canvas(page).evaluate((node) => {
  const box = node.getBoundingClientRect();
  const icons = [...node.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")];
  const inside = icons.every((icon) => {
    const r = icon.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  });
  const singles = icons.filter((icon) => icon.classList.contains("talk-marker")).length;
  const grouped = icons.filter((icon) => icon.classList.contains("talk-cluster")).reduce((sum, icon) => sum + Number(icon.textContent), 0);
  return { total: singles + grouped, inside };
});

// The map shows exactly the listed cards that have a feature, says how many
// of the listed talks that is, and draws that many markers.
async function expectSynced(page) {
  await expect(region(page)).toHaveAttribute("data-map-state", "ready");
  const listed = await visibleKeys(page);
  const expected = mappedOf(listed);
  await expect.poll(() => markerKeys(page), { message: "marker keys = listed keys with a map location" }).toEqual(expected);
  await expect(page.locator("#talk-map-coverage")).toHaveText(coverageText(expected.length, listed.length));
  await expect.poll(() => markersDrawn(page)).toEqual({ total: expected.length, inside: true });
  await expectFitted(page, expected);
  return expected;
}

// The view fits the markers shown, not a fixed view: one location sits in
// the middle of the map; several locations spread across it (the view is
// fitted with 32px padding; clusters of up to 48px may pull the outermost
// icons inwards).
async function expectFitted(page, keys) {
  if (keys.length === 0) return;
  const places = new Set(keys.map((key) => JSON.stringify(featureOf(key).geometry.coordinates)));
  const view = await canvas(page).evaluate((node) => {
    const box = node.getBoundingClientRect();
    const centres = [...node.querySelectorAll(".leaflet-marker-pane .leaflet-marker-icon")].map((icon) => {
      const r = icon.getBoundingClientRect();
      return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
    });
    return { width: box.width, height: box.height, centres };
  });
  if (places.size === 1) {
    for (const [x, y] of view.centres) {
      expect(Math.abs(x - view.width / 2), "one location: centred across").toBeLessThan(24);
      expect(Math.abs(y - view.height / 2), "one location: centred down").toBeLessThan(24);
    }
  } else {
    const span = (axis) => Math.max(...view.centres.map((c) => c[axis])) - Math.min(...view.centres.map((c) => c[axis]));
    expect(Math.max(span(0) / view.width, span(1) / view.height), "several locations spread across the map").toBeGreaterThan(0.4);
  }
}

const controls = (page) => ({
  text: page.getByLabel("Search talks"),
  pillar: page.getByLabel("Research pillar"),
  year: page.getByLabel("Year", { exact: true }),
  virtual: page.getByLabel("Format", { exact: true }),
  foundational: page.getByLabel("Include foundational work")
});

async function applyFilters(page, state) {
  const c = controls(page);
  await c.text.fill(state.text ?? "");
  await c.pillar.selectOption({ value: state.pillar ?? "" });
  await c.year.selectOption({ value: state.year ?? "" });
  await c.virtual.selectOption({ value: state.virtual ?? "" });
  await c.foundational.setChecked(state.foundational === INCLUDE);
}

// ---- Data preconditions (both projects) ---------------------------------------

test("the generated map data joins the archive and exercises the map's cases", () => {
  expect(geojson.type).toBe("FeatureCollection");
  for (const feature of features) {
    const { key } = feature.properties;
    expect(talkByKey.has(key), `${key} is a public talk`).toBe(true);
    const [lon, lat] = feature.geometry.coordinates;
    expect(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${key} has coordinates`).toBe(true);
    expect(Object.keys(feature.properties).sort()).toEqual(
      ["key", "title", "organization", "virtual_status", "primary_pillar", "year", ...("location" in feature.properties ? ["location"] : [])].sort()
    );
    expect(feature.properties.title).toBe(talkByKey.get(key).title);
  }
  expect(mapped.size, "feature keys are unique").toBe(features.length);
  if (!liveData) {
    expect(features.some((f) => isVirtual(f) && !isFoundational(f.properties.key)), "a virtual mapped talk shown by default").toBe(true);
    expect(features.some((f) => !isVirtual(f) && !isFoundational(f.properties.key)), "an in-person mapped talk shown by default").toBe(true);
    expect(talks.some((record) => !mapped.has(record.key) && record.foundational_work !== "Y"), "an unmapped talk shown by default").toBe(true);
    expect(features.some((f) => isFoundational(f.properties.key)), "a mapped talk hidden by default").toBe(true);
    expect(new Set(features.map(placeOf)).size, "two or more map locations").toBeGreaterThanOrEqual(2);
    expect(sharedPlaces.length, "two talks at the same location").toBeGreaterThan(0);
    expect(sharedPlaces.some((group) => group.some(isVirtual) && group.some((f) => !isVirtual(f))), "a shared location with virtual and in-person talks").toBe(true);
  }
});

// ---- Without JavaScript -------------------------------------------------------

test("without JavaScript the map region stays hidden and every talk is listed", { tag: "@no-js" }, async ({ page }) => {
  await page.goto(PAGE);
  await expect(region(page)).toBeHidden();
  await expect(page.getByRole("button", { name: /Show on map/ })).toHaveCount(0);
  await expect(page.locator("article.talk-card")).toHaveCount(talks.length);
  for (const record of talks) await expect(card(page, record.key)).toBeVisible();
});

// ---- Synchronization ------------------------------------------------------------

test("the map starts with the archive's visible talks that have a location", { tag: "@js" }, async ({ page }) => {
  await openMap(page);
  expect(await visibleKeys(page)).toEqual(shownByDefault);
  const keys = await expectSynced(page);
  expect(keys).toEqual(mappedOf(shownByDefault));
  // Foundational talks are hidden by default, so their markers are too.
  for (const feature of features.filter((f) => isFoundational(f.properties.key))) {
    expect(keys).not.toContain(feature.properties.key);
  }
  if (!liveData) expect(keys.length).toBeGreaterThan(0);
});

test("marker keys follow every filter change, combined filters and reset", { tag: "@js" }, async ({ page }) => {
  await openMap(page);
  const virtualTalk = features.find((f) => isVirtual(f) && !isFoundational(f.properties.key));
  const states = [
    ...Object.keys(pillars).map((pillar) => ({ pillar })),
    ...Object.keys(pillars).map((pillar) => ({ pillar, foundational: INCLUDE })),
    { virtual: "Y" },
    { virtual: "N" },
    { foundational: INCLUDE },
    ...[...new Set(talks.map((record) => String(record.year)))].slice(0, 3).map((year) => ({ year })),
    ...(virtualTalk ? [{ pillar: virtualTalk.properties.primary_pillar, virtual: "Y", year: String(virtualTalk.properties.year) }] : []),
    { text: "zz-no-such-talk-qq" },
    { virtual: "Y", foundational: INCLUDE }
  ];
  const seen = new Set();
  for (const state of states) {
    await applyFilters(page, state);
    seen.add(JSON.stringify(await expectSynced(page)));
  }
  await page.getByRole("button", { name: "Reset filters" }).first().click();
  expect(await visibleKeys(page)).toEqual(shownByDefault);
  expect(await expectSynced(page)).toEqual(mappedOf(shownByDefault));
  // The states reach several different marker sets, including none.
  if (!liveData) {
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(seen.has("[]")).toBe(true);
  }
});

// The zoom levels of the tiles on the map (tile URLs end /{z}/{x}/{y}.png).
const tileZooms = (page) => page.locator("#talk-map-canvas img.leaflet-tile").evaluateAll((nodes) =>
  [...new Set(nodes.map((node) => /\/(\d+)\/\d+\/\d+\.png$/.exec(node.src)?.[1] ?? node.src))].sort());

test("an empty result leaves no markers, a world view and a note", { tag: "@js" }, async ({ page }) => {
  await openMap(page);
  // First a view fitted to one talk, zoomed well in from the world view.
  const single = features.find((feature) => shownByDefault.includes(feature.properties.key));
  if (!liveData) expect(single).toBeTruthy();
  if (single) {
    await applyFilters(page, { text: single.properties.title });
    expect(await expectSynced(page)).toContain(single.properties.key);
    await expect.poll(async () => (await tileZooms(page)).length, { message: "one tile zoom level" }).toBe(1);
    expect(await tileZooms(page), "fitted, not the world view").not.toEqual(["1"]);
  }
  await applyFilters(page, { text: "zz-no-such-talk-qq" });
  expect(await expectSynced(page)).toEqual([]);
  await expect(page.locator("#talk-map-coverage")).toHaveText("No talks are listed, so the map shows no markers.");
  await expect(canvas(page)).toBeVisible();
  await expect(page.locator("#talk-map-canvas .leaflet-tile-loaded").first()).toBeVisible();
  // The world view (zoom 1), not the previous markers' view.
  await expect.poll(() => tileZooms(page), { message: "every tile is a world-view (zoom 1) tile" }).toEqual(["1"]);
});

test("filtered links open the map with exactly those markers from the start", { tag: "@js" }, async ({ page }) => {
  for (const [name, pillar] of Object.entries(pillars)) {
    await openMap(page, `${PAGE}?pillar=${encodeURIComponent(name)}`);
    // Independent of the page: pillars.json, minus foundational work.
    const listed = pillar.talks.keys.filter((key) => !isFoundational(key));
    expect(await visibleKeys(page)).toEqual(listed);
    expect(await expectSynced(page)).toEqual(mappedOf(listed));

    await openMap(page, `${PAGE}?pillar=${encodeURIComponent(name)}&foundational=include`);
    expect(await expectSynced(page)).toEqual(mappedOf(pillar.talks.keys));
  }
  const virtualTalk = features.find(isVirtual);
  if (!liveData) expect(virtualTalk).toBeTruthy();
  if (virtualTalk) {
    const { primary_pillar: pillar, year } = virtualTalk.properties;
    await openMap(page, `${PAGE}?pillar=${encodeURIComponent(pillar)}&year=${year}&virtual=Y&foundational=include`);
    const keys = await expectSynced(page);
    expect(keys).toContain(virtualTalk.properties.key);
    for (const key of keys) expect(isVirtual(featureOf(key))).toBe(true);
    // Then a change and a reset, after the reload.
    await controls(page).virtual.selectOption({ value: "N" });
    await expectSynced(page);
    await page.getByRole("button", { name: "Reset filters" }).first().click();
    expect(await expectSynced(page)).toEqual(mappedOf(shownByDefault));
  }
});

test("the map follows the archive whichever script runs first", { tag: "@js" }, async ({ page }) => {
  // Serve the page with the two module scripts swapped.
  await page.route((url) => url.pathname === PAGE, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const archive = '<script type="module" src="../js/archive-filters.js"></script>';
    const map = '<script type="module" src="../js/talks-map.js"></script>';
    expect(html.indexOf(archive)).toBeGreaterThan(0);
    expect(html.indexOf(map)).toBeGreaterThan(html.indexOf(archive));
    await route.fulfill({ response, body: html.replace(archive, "%%ARCHIVE%%").replace(map, archive).replace("%%ARCHIVE%%", map) });
  });
  await openMap(page);
  expect(await expectSynced(page)).toEqual(mappedOf(shownByDefault));
  const [name, pillar] = Object.entries(pillars).find(([, p]) => p.talks.keys.some((key) => mapped.has(key))) ?? [];
  if (!liveData) expect(name).toBeTruthy();
  if (name) {
    await openMap(page, `${PAGE}?pillar=${encodeURIComponent(name)}`);
    expect(await expectSynced(page)).toEqual(mappedOf(pillar.talks.keys.filter((key) => !isFoundational(key))));
  }
});

test("if the archive script fails, nothing is hidden and the map shows every mappable talk", { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
  expectedPageErrors.push(/^console\.error: Failed to load resource: net::ERR_FAILED \(.*\/js\/archive-filters\.js\)$/);
  expectedRequestFailures.push(/^net::ERR_FAILED .*\/js\/archive-filters\.js$/);
  await page.route("**/js/archive-filters.js", (route) => route.abort());
  await openMap(page);
  await expect(page.locator("#talk-filters")).toBeHidden();
  expect(await visibleKeys(page)).toEqual(talks.map((record) => record.key));
  expect(await expectSynced(page)).toEqual([...mapped].sort());
});

test("talks without coordinates never get a marker but stay listed and counted", { tag: "@js" }, async ({ page }) => {
  const unmapped = talks.filter((record) => !mapped.has(record.key));
  if (!liveData) expect(unmapped.length).toBeGreaterThan(0);
  await openMap(page, `${PAGE}?foundational=include`);
  const keys = await expectSynced(page);
  for (const record of unmapped) {
    await expect(card(page, record.key)).toBeVisible();
    await expect(showButton(page, record.key)).toHaveCount(0);
    expect(keys).not.toContain(record.key);
  }
  await expect(page.locator("#talk-map-coverage")).toHaveText(coverageText(mapped.size, talks.length));
  for (const record of unmapped.slice(0, 3)) {
    await applyFilters(page, { text: record.title, foundational: INCLUDE });
    const listed = await visibleKeys(page);
    expect(listed).toContain(record.key);
    const shown = await expectSynced(page);
    expect(shown).not.toContain(record.key);
    await expect(page.locator("#talk-map-coverage")).toContainText(`of ${listed.length} listed`);
  }
  // Cards with a marker have the button (hidden with its card); the others do not.
  for (const record of talks) await expect(card(page, record.key).locator(".talk-map-button")).toHaveCount(mapped.has(record.key) ? 1 : 0);
});

// ---- Popups and focus -----------------------------------------------------------

// What a talk's popup says about every talk at its location (archive order).
function expectedPopup(key, listedKeys) {
  const here = placeOf(featureOf(key));
  const group = features.filter((f) => listedKeys.includes(f.properties.key) && placeOf(f) === here);
  const virtualCount = group.filter(isVirtual).length;
  const placeLabel = virtualCount === 0 ? "Event location" : virtualCount === group.length ? "Host location" : "Event and host location";
  const { location } = featureOf(key).properties;
  return {
    place: location ? `${placeLabel}: ${location}` : null,
    note: virtualCount > 0 ? "Virtual talks are shown at their host's location; they did not involve travel." : null,
    talks: group.map((f) => ({
      key: f.properties.key,
      title: f.properties.title,
      href: `#talk-${talkByKey.get(f.properties.key).slug}`,
      meta: isVirtual(f)
        ? `Virtual Hosted by ${f.properties.organization} · ${f.properties.year}`
        : `In person · ${f.properties.organization} · ${f.properties.year}`,
      badge: isVirtual(f) ? "Virtual" : null
    }))
  };
}

const readPopup = (page) => popup(page).evaluate((node) => ({
  place: node.querySelector(".talk-popup-place")?.textContent ?? null,
  note: node.querySelector(".talk-popup-note")?.textContent ?? null,
  talks: [...node.querySelectorAll(".talk-popup-talks > li")].map((item) => ({
    key: item.dataset.key,
    title: item.querySelector(".talk-popup-title").textContent,
    href: item.querySelector(".talk-popup-title").getAttribute("href"),
    meta: item.querySelector(".talk-popup-meta").textContent,
    badge: item.querySelector(".virtual-badge")?.textContent ?? null
  }))
}));

test("popups list the talks at a location; virtual ones say Virtual and Hosted by, never travel", { tag: "@js" }, async ({ page }) => {
  await openMap(page, `${PAGE}?foundational=include`);
  const listed = await visibleKeys(page);
  let virtualChecked = 0;
  for (const feature of features) {
    const { key } = feature.properties;
    await showButton(page, key).click();
    await expect(popup(page)).toBeVisible();
    const shown = await readPopup(page);
    expect(shown, key).toEqual(expectedPopup(key, listed));
    const text = await popup(page).textContent();
    expect(text).not.toMatch(/visit|travel(l)?ed|presented (in|at)|attended|trip/i);
    if (isVirtual(feature)) {
      const item = popup(page).locator(`li[data-key=${cssString(key)}]`);
      await expect(item.locator(".virtual-badge")).toHaveText("Virtual");
      await expect(item.locator(".talk-popup-meta")).toContainText(`Hosted by ${feature.properties.organization}`);
      virtualChecked += 1;
    }
    await page.keyboard.press("Escape");
    await expect(popup(page)).toHaveCount(0);
    await expect(showButton(page, key)).toBeFocused();
  }
  if (!liveData) expect(virtualChecked).toBeGreaterThan(0);
});

test("Show on map highlights the marker and opens its popup; Escape returns to the card", { tag: "@js" }, async ({ page }) => {
  await openMap(page, `${PAGE}?foundational=include`);
  const keys = [...mapped];
  if (!liveData) expect(keys.length).toBeGreaterThan(1);
  for (const key of keys.slice(0, 4)) {
    const button = showButton(page, key);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(popup(page)).toBeFocused();
    await expect(popup(page).locator(`li[data-key=${cssString(key)}]`)).toHaveCount(1);
    await expect(markerIcon(page, key)).toHaveClass(/\bis-selected\b/);
    await expect(page.locator("#talk-map-canvas .talk-marker.is-selected")).toHaveCount(1);
    await expect(card(page, key)).toHaveClass(/\bis-map-selected\b/);
    await expect(page.locator(".talk-card.is-map-selected")).toHaveCount(1);
    await expect(canvas(page)).toBeInViewport();
    await expect(popup(page)).toHaveCSS("outline-width", "3px");
    // The popup's links take keyboard focus with the site's ring and colour.
    await page.keyboard.press("Tab");
    const link = popup(page).locator(".talk-popup-title").first();
    await expect(link).toBeFocused();
    await expect(link).toHaveCSS("outline-style", "solid");
    await expect(link).toHaveCSS("outline-width", "3px");
    await expect(link).toHaveCSS("color", "rgb(92, 107, 115)");
    await page.keyboard.press("Escape");
    await expect(popup(page)).toHaveCount(0);
    await expect(button).toBeFocused();
  }
});

test("selecting a marker by mouse or keyboard moves focus to its card", { tag: "@js" }, async ({ page }) => {
  await openMap(page, `${PAGE}?foundational=include`);
  for (const key of [...mapped].slice(0, 4)) {
    // Reveal the marker (it may be in a cluster), then close the popup.
    await showButton(page, key).click();
    await expect(popup(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(markerIcon(page, key)).toBeVisible();
    await settled(page);

    await markerIcon(page, key).click();
    await expect(heading(page, key)).toBeFocused();
    await expect(heading(page, key)).toBeInViewport();
    await expect(card(page, key)).toHaveClass(/\bis-map-selected\b/);
    await expect(popup(page).locator(`li[data-key=${cssString(key)}]`)).toHaveCount(1);
    await settled(page);

    for (const press of ["Enter", " "]) {
      await canvas(page).scrollIntoViewIfNeeded();
      await markerIcon(page, key).focus();
      await page.keyboard.press(press);
      await expect(heading(page, key)).toBeFocused();
      await expect(heading(page, key)).toBeInViewport();
      await settled(page);
    }
  }
});

test("a popup's talk title moves focus to that talk's card", { tag: "@js" }, async ({ page }) => {
  await openMap(page, `${PAGE}?foundational=include`);
  const group = sharedPlaces[0] ?? [features[0]].filter(Boolean);
  if (!liveData) expect(group.length).toBeGreaterThan(1);
  for (const feature of group) {
    const first = group[0].properties.key;
    await showButton(page, first).click();
    const link = popup(page).locator(`li[data-key=${cssString(feature.properties.key)}] .talk-popup-title`);
    await link.click();
    await expect(heading(page, feature.properties.key)).toBeFocused();
    await expect(heading(page, feature.properties.key)).toBeInViewport();
    expect(new URL(page.url()).hash).toBe("");
  }
});

test("talks at one location cluster, then spread out in place from the keyboard", { tag: "@js" }, async ({ page }) => {
  test.skip(liveData, "needs the fixture's single shared location");
  await openMap(page);
  const group = sharedPlaces.find((g) => g.every((f) => !isFoundational(f.properties.key)));
  expect(group).toBeTruthy();
  const cluster = page.locator("#talk-map-canvas .talk-cluster");
  await expect(cluster).toHaveCount(1);
  await expect(cluster).toHaveText(String(group.length));
  await expect(cluster).toHaveAttribute("role", "button");
  await expect(cluster).toHaveAttribute("tabindex", "0");
  await expect(cluster).toHaveAttribute("aria-label", `${group.length} talks at the same or nearby locations. Select to zoom in or spread them out.`);
  for (const feature of group) await expect(markerIcon(page, feature.properties.key)).toHaveCount(0);
  await cluster.focus();
  await page.keyboard.press("Enter");
  for (const feature of group) await expect(markerIcon(page, feature.properties.key)).toBeVisible();
  await expect(canvas(page)).toBeFocused();
  // Each marker is a named button: title and host, and Virtual where it was.
  for (const feature of group) {
    const icon = markerIcon(page, feature.properties.key);
    await expect(icon).toHaveAttribute("role", "button");
    const { title, organization } = feature.properties;
    await expect(icon).toHaveAttribute("aria-label", new RegExp(`^${escapeRegExp(title)}\\. ${isVirtual(feature) ? "Virtual, hosted by" : "In person:"} ${escapeRegExp(organization)}`));
    await expect(icon).toHaveAttribute("title", await icon.getAttribute("aria-label"));
    await expect(icon).toHaveClass(isVirtual(feature) ? /\btalk-marker-virtual\b/ : /\btalk-marker-in-person\b/);
    await expect(icon.locator(".talk-marker-virtual-tag")).toHaveCount(isVirtual(feature) ? 1 : 0);
  }
});

test("virtual markers differ in shape and carry a V; numbers and fills follow the primary pillar", { tag: "@js" }, async ({ page }) => {
  await openMap(page, `${PAGE}?foundational=include`);
  const fills = { 1: "rgb(37, 50, 55)", 2: "rgb(92, 107, 115)", 3: "rgb(157, 180, 192)", 4: "rgb(194, 223, 227)" };
  const text = { 1: "rgb(255, 255, 255)", 2: "rgb(255, 255, 255)", 3: "rgb(37, 50, 55)", 4: "rgb(37, 50, 55)" };
  let virtualSeen = 0;
  for (const feature of features) {
    const { key, primary_pillar: pillar } = feature.properties;
    await showButton(page, key).click();
    await page.keyboard.press("Escape");
    const icon = markerIcon(page, key);
    const number = pillars[pillar].number;
    await expect(icon.locator(".talk-marker-number")).toHaveText(String(number));
    // The number is centred (Leaflet's own CSS would make the icon a block).
    await expect(icon).toHaveCSS("display", "flex");
    await expect(icon).toHaveCSS("justify-content", "center");
    await expect(icon).toHaveCSS("background-color", fills[number]);
    await expect(icon).toHaveCSS("color", text[number]);
    await expect(icon).toHaveCSS("border-top-color", "rgb(37, 50, 55)");
    if (isVirtual(feature)) {
      virtualSeen += 1;
      await expect(icon).toHaveCSS("border-top-style", "double");
      await expect(icon).toHaveCSS("border-top-left-radius", "0px");
      await expect(icon.locator(".talk-marker-virtual-tag")).toHaveText("V");
      await expect(icon.locator(".talk-marker-virtual-tag")).toBeVisible();
    } else {
      await expect(icon).toHaveCSS("border-top-style", "solid");
      await expect(icon).toHaveCSS("border-top-left-radius", "50%");
    }
  }
  if (!liveData) expect(virtualSeen).toBeGreaterThan(0);
});

// ---- Accessibility --------------------------------------------------------------

test("the map has an accessible name, skip links and a text legend", { tag: "@js" }, async ({ page }) => {
  await openMap(page);
  await expect(page.getByRole("region", { name: "Talk locations", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Interactive map of talk locations", exact: true })).toBeVisible();
  // The skip link comes before the map.
  const order = await page.locator('#talk-map a[href$="#talk-archive-heading"], #talk-map-canvas').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim() || node.id));
  expect(order[0]).toBe("Skip map and view talks");
  expect(order.at(-1)).toBe("View talks as a list");
  // The legend is text: each pillar's number and name, then the shapes.
  // The marker swatches are decorative (hidden from assistive technology).
  await expect(page.locator(".talk-map-key li > :is(.talk-marker, .talk-cluster)")).toHaveCount(7);
  await expect(page.locator(".talk-map-key li > :is(.talk-marker, .talk-cluster):not([aria-hidden='true'])")).toHaveCount(0);
  const legend = await page.locator(".talk-map-key li").evaluateAll((nodes) => nodes.map((node) => {
    const copy = node.cloneNode(true);
    for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
    return copy.textContent.trim();
  }));
  const pillarItems = Object.entries(pillars).map(([name, p]) => `Pillar ${p.number}: ${name}`);
  expect(legend).toEqual([
    ...pillarItems,
    "Circle: an in-person talk, at the event location",
    "Square with a double outline and a “V”: a virtual talk, shown at its host's location",
    "Circle with a count: talks at the same or nearby locations; select it to zoom in or spread them out"
  ]);
  // Tiles are attributed, and the page says where they come from.
  await expect(page.locator("#talk-map-canvas .leaflet-control-attribution")).toContainText("© OpenStreetMap contributors");
  await expect(page.locator(".talk-map-tiles")).toHaveText("The background map is loaded from OpenStreetMap's tile servers. Map data © OpenStreetMap contributors.");

  for (const name of ["Skip map and view talks", "View talks as a list"]) {
    await page.goto(PAGE);
    await expect(region(page)).toHaveAttribute("data-map-state", "ready");
    await page.getByRole("link", { name }).click();
    await expect(page.locator("#talk-archive-heading")).toBeFocused();
    await expect(page.locator("#talk-archive-heading")).toBeInViewport();
    await page.getByRole("link", { name }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#talk-archive-heading")).toBeFocused();
  }
});

test("Tab moves into the map, through its controls and out again, with a visible focus ring", { tag: "@js" }, async ({ page }) => {
  await openMap(page);
  await page.getByRole("link", { name: "Skip map and view talks" }).focus();
  await page.keyboard.press("Tab");
  await expect(canvas(page)).toBeFocused();
  const visited = [];
  let left = false;
  for (let step = 0; step < 60; step += 1) {
    const focused = await page.evaluate(() => {
      const node = document.activeElement;
      const style = getComputedStyle(node);
      return {
        inMap: Boolean(node.closest("#talk-map-canvas")),
        kind: node.id === "talk-map-canvas" ? "map"
          : node.classList.contains("talk-marker") ? "marker"
            : node.classList.contains("talk-cluster") ? "cluster"
              : node.classList.contains("leaflet-control-zoom-in") ? "zoom-in"
                : node.classList.contains("leaflet-control-zoom-out") ? "zoom-out"
                  : node.textContent.trim(),
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`
      };
    });
    if (!focused.inMap) {
      expect(focused.kind, "focus leaves the map for the next link").toBe("View talks as a list");
      left = true;
      break;
    }
    visited.push(focused.kind);
    expect(focused.outline, `focus ring on ${focused.kind}`).toBe("solid 3px rgb(37, 50, 55)");
    await page.keyboard.press("Tab");
  }
  // No keyboard trap: Tab reached the link after the map within 60 presses.
  expect(left, "Tab leaves the map").toBe(true);
  expect(visited[0]).toBe("map");
  expect(visited).toContain("zoom-in");
  expect(visited).toContain("zoom-out");
  expect(visited).toContain("OpenStreetMap");
  if (!liveData) expect(visited.some((kind) => kind === "marker" || kind === "cluster")).toBe(true);
  // And back: Shift+Tab from the next link re-enters the map.
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement.closest("#talk-map-canvas")))).toBe(true);
});

test("map controls, markers and buttons are at least 24 by 24 pixels", { tag: "@js" }, async ({ page }) => {
  await openMap(page, `${PAGE}?foundational=include`);
  const key = [...mapped][0];
  test.skip(!key, "no mapped talks");
  await showButton(page, key).click();
  await expect(popup(page)).toBeVisible();
  const targets = [
    page.locator(".leaflet-control-zoom-in"),
    page.locator(".leaflet-control-zoom-out"),
    page.locator(".leaflet-popup-close-button"),
    markerIcon(page, key),
    showButton(page, key),
    page.getByRole("link", { name: "Skip map and view talks" })
  ];
  const clusters = page.locator("#talk-map-canvas .talk-cluster");
  if (await clusters.count()) targets.push(clusters.first());
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
  test(`the map fits a ${viewport.width}px screen without horizontal scrolling`, { tag: "@js" }, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openMap(page, `${PAGE}?foundational=include`);
    const sizes = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      map: document.querySelector("#talk-map-canvas").getBoundingClientRect().toJSON()
    }));
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.innerWidth);
    expect(sizes.map.left).toBeGreaterThanOrEqual(0);
    expect(sizes.map.right).toBeLessThanOrEqual(viewport.width);
    expect(sizes.map.height).toBeGreaterThanOrEqual(300);
    // Every popup fits inside the map, clear of the zoom buttons (which sit
    // above popups), and does not widen the page.
    if (!liveData) expect(mapped.size).toBeGreaterThan(0);
    for (const key of [...mapped].slice(0, 4)) {
      await showButton(page, key).click();
      await expect(popup(page)).toBeFocused();
      await settled(page);
      await expect.poll(() => page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const p = box("#talk-map-canvas .leaflet-popup");
        const c = box("#talk-map-canvas");
        const z = box("#talk-map-canvas .leaflet-control-zoom");
        return {
          insideMap: p.left >= c.left && p.right <= c.right && p.top >= c.top && p.bottom <= c.bottom,
          clearOfZoom: p.left >= z.right || p.top >= z.bottom,
          noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth
        };
      }), { message: `popup of ${key}` }).toEqual({ insideMap: true, clearOfZoom: true, noHorizontalScroll: true });
      await page.keyboard.press("Escape");
      await settled(page);
    }
  });
}

// ---- Motion -----------------------------------------------------------------------

// Records every animation class Leaflet or markercluster puts on the map pane
// while the reader zooms with the button and pans with the keyboard.
async function animationClasses(page) {
  await page.evaluate(() => {
    window.__mapAnimations = new Set();
    const pane = document.querySelector("#talk-map-canvas .leaflet-map-pane");
    new MutationObserver(() => {
      for (const name of pane.classList) if (/-anim$/.test(name)) window.__mapAnimations.add(name);
    }).observe(pane, { attributes: true, attributeFilter: ["class"] });
  });
  await page.locator(".leaflet-control-zoom-in").click();
  await canvas(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));
  return page.evaluate(() => [...window.__mapAnimations].sort());
}

test("with reduced motion the map does not animate", { tag: "@js" }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openMap(page);
  const map = canvas(page);
  await expect(map).not.toHaveClass(/\bleaflet-fade-anim\b/);
  // No zoom-animation proxy, markers hidden (not animated) while zooming.
  await expect(page.locator("#talk-map-canvas .leaflet-proxy")).toHaveCount(0);
  await expect(page.locator("#talk-map-canvas .leaflet-marker-pane")).toHaveClass(/\bleaflet-zoom-hide\b/);
  expect(await animationClasses(page)).toEqual([]);

  // Moving to the list jumps there: over the next ten frames the page shows
  // at most two scroll positions (the jump, then Quarto's navbar script
  // nudging the target below the fixed header), never the many in-between
  // positions of an animated scroll.
  const stillFrames = () => page.evaluate(() => new Promise((resolve) => {
    const ys = [window.scrollY];
    const tick = () => {
      ys.push(window.scrollY);
      if (ys.length < 10) requestAnimationFrame(tick);
      else resolve(new Set(ys).size <= 2);
    };
    requestAnimationFrame(tick);
  }));
  await page.getByRole("link", { name: "Skip map and view talks" }).click();
  expect(await stillFrames(), "the skip link does not animate the scroll").toBe(true);
  await expect(page.locator("#talk-archive-heading")).toBeFocused();
  await expect(page.locator("#talk-archive-heading")).toBeInViewport();
  const key = mappedOf(shownByDefault)[0];
  if (!liveData) expect(key).toBeTruthy();
  if (key) {
    await showButton(page, key).click();
    await expect(popup(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await markerIcon(page, key).click();
    expect(await stillFrames(), "a marker does not animate the scroll to its card").toBe(true);
    await expect(heading(page, key)).toBeFocused();
    await expect(heading(page, key)).toBeInViewport();
  }
});

test("without a reduced-motion preference Leaflet's animations are on (control)", { tag: "@js" }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openMap(page);
  await expect(canvas(page)).toHaveClass(/\bleaflet-fade-anim\b/);
  await expect(page.locator("#talk-map-canvas .leaflet-proxy")).toHaveCount(1);
  const seen = await animationClasses(page);
  expect(seen).toContain("leaflet-zoom-anim");
  expect(seen).toContain("leaflet-pan-anim");
});

// ---- Failures and resources -----------------------------------------------------------

async function expectArchiveUsable(page) {
  await expect(region(page)).toHaveAttribute("data-map-state", "unavailable");
  await expect(page.locator("[data-talk-map-message]")).toHaveText(MESSAGES.unavailable);
  await expect(page.locator("[data-talk-map-body]")).toBeHidden();
  await expect(page.getByRole("button", { name: /Show on map/ })).toHaveCount(0);
  await expect(page.locator("article.talk-card")).toHaveCount(talks.length);
  expect(await visibleKeys(page)).toEqual(shownByDefault);
  await controls(page).foundational.check();
  expect(await visibleKeys(page)).toEqual(talks.map((record) => record.key));
}

test("a GeoJSON error (503) replaces the map with a message; the archive works", { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
  expectedPageErrors.push(/^console\.error: Failed to load resource: the server responded with a status of 503 .*\(.*\/data\/generated\/talks\.geojson\)$/);
  expectedRequestFailures.push(/^503 .*\/data\/generated\/talks\.geojson$/);
  // A usable body with an error status: the status alone must stop the map.
  await page.route("**/data/generated/talks.geojson", (route) => route.fulfill({ status: 503, contentType: "application/geo+json", body: JSON.stringify(geojson) }));
  await page.goto(PAGE);
  await expectArchiveUsable(page);
});

for (const [name, body] of [["invalid JSON", "{ not json"], ["JSON that is not a FeatureCollection", '{"type":"Feature"}']]) {
  test(`GeoJSON with ${name} replaces the map with a message; the archive works`, { tag: "@js" }, async ({ page }) => {
    await page.route("**/data/generated/talks.geojson", (route) => route.fulfill({ status: 200, contentType: "application/geo+json", body }));
    await page.goto(PAGE);
    await expectArchiveUsable(page);
  });
}

for (const file of ["leaflet/leaflet.js", "leaflet.markercluster/leaflet.markercluster.js"]) {
  test(`a missing map library (${file}) replaces the map with a message; the archive works`, { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
    const escaped = escapeRegExp(`/assets/vendor/${file}`);
    expectedPageErrors.push(new RegExp(`^console\\.error: Failed to load resource: net::ERR_FAILED \\(.*${escaped}\\)$`));
    expectedRequestFailures.push(new RegExp(`^net::ERR_FAILED .*${escaped}$`));
    await page.route(`**/assets/vendor/${file}`, (route) => route.abort());
    await page.goto(PAGE);
    await expectArchiveUsable(page);
  });
}

test("failed tiles keep the map and show a short note", { tag: "@js" }, async ({ page, expectedPageErrors, expectedRequestFailures }) => {
  expectedPageErrors.push(/^console\.error: Failed to load resource: net::ERR_FAILED \(https:\/\/tile\.openstreetmap\.org\/.*\)$/);
  expectedRequestFailures.push(/^net::ERR_FAILED https:\/\/tile\.openstreetmap\.org\//);
  await page.route(TILE_URL_PATTERN, (route) => route.abort());
  await openMap(page);
  await expect(page.locator("[data-talk-map-message]")).toHaveText(MESSAGES.tiles);
  await expect(page.locator("[data-talk-map-body]")).toBeVisible();
  await expectSynced(page);
  await controls(page).foundational.check();
  await expectSynced(page);
});

test("the map loads its libraries and data from the site; tiles are the only third-party requests", { tag: "@js" }, async ({ page, baseURL }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const data = page.waitForResponse((response) => response.url().endsWith("/data/generated/talks.geojson"));
  await openMap(page);
  const response = await data;
  expect(response.url()).toBe(`${baseURL}/data/generated/talks.geojson`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual(geojson);
  for (const file of ["leaflet/leaflet.js", "leaflet/leaflet.css", "leaflet.markercluster/leaflet.markercluster.js", "leaflet.markercluster/MarkerCluster.css"]) {
    expect(requests).toContain(`${baseURL}/assets/vendor/${file}`);
  }
  const thirdParty = requests.filter((url) => !url.startsWith(`${baseURL}/`) && !url.startsWith("data:"));
  expect(thirdParty.length).toBeGreaterThan(0);
  for (const url of thirdParty) expect(url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
  // Leaflet's stylesheet images are served too (no 404 if a control uses them).
  for (const image of ["layers.png", "layers-2x.png", "marker-icon.png", "marker-icon-2x.png", "marker-shadow.png"]) {
    expect((await page.request.get(`${baseURL}/assets/vendor/leaflet/images/${image}`)).status(), image).toBe(200);
  }
});
