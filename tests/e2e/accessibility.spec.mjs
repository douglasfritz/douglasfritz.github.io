// Site-wide accessibility checks on the six primary pages (spec 4.5, 13.5,
// 14, 16; WCAG 2.2 AA): axe-core in the default and interactive states, the
// skip link and landmarks, keyboard order and focus visibility, descriptive
// link names, safe link targets and requests, forced colours, reduced
// motion, and the pages without JavaScript. Data-driven: expectations come
// from the rendered page and data/generated/, so the suite runs on the
// synthetic fixtures and on the live sheet (E2E_DATA=live).
import { load as loadYaml } from "js-yaml";
import {
  AXE_PATH,
  ROUTES,
  axeViolations,
  crawlTabOrder,
  expectNoAxeViolations,
  expectVisibleFocus,
  focusedElement,
  listTabbables,
  waitUntilEnhanced
} from "./helpers.mjs";
import { cssString, expect, liveData, readGenerated, test } from "./support.mjs";

const publications = loadYaml(readGenerated("publications.yml"));
const talks = loadYaml(readGenerated("talks.yml"));
const features = JSON.parse(readGenerated("talks.geojson")).features;
const JET_BLACK = "rgb(37, 50, 55)";
const TILE_PATTERN = /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/;
const shownByDefault = (records) => records.filter((record) => record.foundational_work !== "Y");
const mappedShownTalk = features.find((feature) => shownByDefault(talks).some((record) => record.key === feature.properties.key));

async function open(page, route, query = "") {
  await page.goto(`${route}${query}`);
  await waitUntilEnhanced(page, route);
}

// ---- axe-core -------------------------------------------------------------------

test.describe("axe-core", { tag: "@js" }, () => {
  for (const route of ROUTES) {
    test(`${route}: no violations in the default state, on a desktop and a phone`, async ({ page }) => {
      await open(page, route);
      await expectNoAxeViolations(page, `${route} at 1280px`);
      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoAxeViolations(page, `${route} at 375px`);
      // The phone's navigation menu, opened.
      await page.locator(".navbar-toggler").click();
      await expect(page.locator("#navbarCollapse")).toHaveClass(/\bshow\b/);
      await expectNoAxeViolations(page, `${route} at 375px with the menu open`);
    });
  }

  for (const route of ["/", "/research/"]) {
    test(`${route}: no violations with each pillar open`, async ({ page }) => {
      await open(page, route);
      for (let n = 1; n <= 4; n += 1) {
        await page.locator(`#pillar-${n}-toggle`).click();
        await expect(page.locator(`#pillar-${n}-panel`)).toBeVisible();
        await expectNoAxeViolations(page, `${route} with pillar ${n} open`);
      }
    });
  }

  test("/publications/: no violations with filters applied and with no matches", async ({ page }) => {
    const record = publications[0];
    await open(page, "/publications/", `?pillar=${encodeURIComponent(record.primary_pillar)}&year=${record.year}&foundational=include`);
    await expect(page.locator(`#publication-records [data-key=${cssString(record.key)}]`)).toBeVisible();
    await expectNoAxeViolations(page, "filtered publications");
    await page.getByLabel("Search publications").fill("zz-no-such-publication-qq");
    await expect(page.locator("#publication-records [data-archive-empty]")).toBeVisible();
    await expectNoAxeViolations(page, "no matching publications");
  });

  test("/talks/: no violations with filters applied, with no matches, with a popup open and with a card selected", async ({ page }) => {
    const record = talks[0];
    await open(page, "/talks/", `?pillar=${encodeURIComponent(record.primary_pillar)}&year=${record.year}&foundational=include`);
    await expect(page.locator(`#talk-records [data-key=${cssString(record.key)}]`)).toBeVisible();
    await expectNoAxeViolations(page, "filtered talks");
    await page.getByLabel("Search talks").fill("zz-no-such-talk-qq");
    await expect(page.locator("#talk-records [data-archive-empty]")).toBeVisible();
    await expectNoAxeViolations(page, "no matching talks");

    if (!liveData) expect(mappedShownTalk, "a mapped talk shown by default").toBeTruthy();
    if (mappedShownTalk) {
      const { key } = mappedShownTalk.properties;
      await open(page, "/talks/");
      await page.locator(`article[data-key=${cssString(key)}] .talk-map-button`).click();
      await expect(page.locator("#talk-map-canvas .talk-popup")).toBeFocused();
      await expectNoAxeViolations(page, "a map popup open");
      // Selecting the marker: popup open, card selected, focus on the card.
      await page.keyboard.press("Escape");
      await page.locator(`#talk-map-canvas .talk-marker[data-key=${cssString(key)}]`).click();
      await expect(page.locator(`article[data-key=${cssString(key)}] .record-title`)).toBeFocused();
      await expect(page.locator(".talk-card.is-map-selected")).toHaveCount(1);
      await expectNoAxeViolations(page, "a marker selected");
    }
  });

  test("Quarto's search dialog: no violations open, with results, apart from the excluded third-party nodes", async ({ page }) => {
    await open(page, "/");
    await page.locator("#quarto-search .aa-DetachedSearchButton").click();
    await expect(page.locator(".aa-DetachedOverlay .aa-Input")).toBeFocused();
    await expectNoAxeViolations(page, "search dialog, empty");
    // A word from the site's own navigation, so that results exist.
    await page.keyboard.type("Research");
    await expect(page.locator(".aa-DetachedOverlay .search-result-link").first()).toBeVisible();
    await expectNoAxeViolations(page, "search dialog with results");
  });

  test("the helper reports violations and keeps exclusions to their own rule and nodes (control)", async ({ page }) => {
    await open(page, "/about/");
    await page.evaluate(() => {
      const image = document.createElement("img");
      image.src = "../assets/images/favicon.svg";
      image.id = "control-image";
      document.querySelector("main").append(image);
    });
    const violations = await axeViolations(page);
    expect(violations.map((violation) => violation.id)).toContain("image-alt");
    expect(violations.find((violation) => violation.id === "image-alt").nodes.map((node) => node.target)).toEqual(["#control-image"]);
  });
});

// ---- Skip link and landmarks ----------------------------------------------------

test.describe("skip link", () => {
  for (const route of ROUTES) {
    test(`${route}: the first Tab stop is a visible skip link to the main content`, async ({ page }, testInfo) => {
      const enhanced = testInfo.project.use.javaScriptEnabled !== false;
      if (enhanced) await open(page, route);
      else await page.goto(route);
      const link = page.locator("a.skip-link");
      await expect(link).toHaveCount(1);
      // (Quarto's script makes in-page links absolute; the target is the same.)
      const pageUrl = page.url().replace(/#.*$/, "");
      expect(await link.evaluate((node) => node.href)).toBe(`${pageUrl}#quarto-document-content`);
      // The first element in the body, before the navbar.
      expect(await page.evaluate(() => document.body.firstElementChild?.classList.contains("skip-link"))).toBe(true);
      await page.keyboard.press("Tab");
      await expect(link).toBeFocused();
      await expect(link).toHaveAccessibleName("Skip to main content");
      await expect(link).toBeInViewport();
      const box = await link.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
      await expect(link).toHaveCSS("outline-style", "solid");
      await expect(link).toHaveCSS("outline-width", "3px");
      await expect(link).toHaveCSS("outline-color", JET_BLACK);
      expectVisibleFocus(await focusedElement(page), route);

      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#quarto-document-content$/);
      const main = page.locator("main#quarto-document-content");
      // With JavaScript the main content takes focus; without it the browser
      // starts the next Tab there. Either way the next Tab lands on the first
      // focusable element from the start of the main content (inside it, or
      // after it when it has none, as a page of records without links may
      // have without JavaScript), never back in the navbar.
      if (enhanced) await expect(main).toBeFocused();
      await expect(page.locator("main h1")).toBeInViewport();
      const next = await page.evaluate(() => {
        const start = document.getElementById("quarto-document-content");
        const candidates = document.querySelectorAll("a[href], button, input, select, textarea, [tabindex='0']");
        const first = [...candidates].find((element) => (start.contains(element) || (start.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
          && element.tabIndex >= 0 && element.checkVisibility({ visibilityProperty: true }));
        first?.setAttribute("data-next-after-skip", "");
        return first ? { inMain: start.contains(first), inNavbar: Boolean(first.closest("#quarto-header")) } : null;
      });
      expect(next, "a focusable element follows the start of the main content").not.toBeNull();
      expect(next.inNavbar).toBe(false);
      await page.keyboard.press("Tab");
      await expect(page.locator("[data-next-after-skip]")).toBeFocused();
    });
  }

  // The link is added after Quarto has written its search index, so a search
  // never finds it: no entry's title, section or text has the link's words.
  test("the site search index never contains the skip link's text", async ({ page }) => {
    const response = await page.request.get("/search.json");
    expect(response.status()).toBe(200);
    const entries = await response.json();
    // Every page is indexed (one entry per page or per section).
    for (const route of ROUTES) {
      const href = `${route.slice(1)}index.html`;
      expect(entries.some((entry) => entry.href === href || entry.href.startsWith(`${href}#`)), href).toBe(true);
    }
    const leaks = entries.filter((entry) => [entry.title, entry.section, entry.text].some((value) => /skip to main content/i.test(String(value ?? ""))));
    expect(leaks.map((entry) => entry.href)).toEqual([]);
  });

  test("the skip link is hidden until it has focus", async ({ page }) => {
    await page.goto("/about/");
    const box = await page.locator("a.skip-link").boundingBox();
    expect(box.width * box.height).toBeLessThanOrEqual(1);
  });
});

test("every page has one main, banner and contentinfo landmark, and every navigation and region is uniquely named and not nested", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole("main"), route).toHaveCount(1);
    await expect(page.getByRole("banner"), route).toHaveCount(1);
    await expect(page.getByRole("contentinfo"), route).toHaveCount(1);
    for (const role of ["navigation", "region", "search", "form", "complementary"]) {
      const landmarks = page.getByRole(role);
      const names = [];
      for (const landmark of await landmarks.all()) {
        names.push(await landmark.evaluate((node) => node.getAttribute("aria-label")
          ?? node.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim()
          ?? ""));
      }
      if (names.length > 1) {
        expect(names.every(Boolean), `${route}: every ${role} landmark is named when there are several (${JSON.stringify(names)})`).toBe(true);
        expect(new Set(names).size, `${route}: ${role} landmark names are unique`).toBe(names.length);
      }
    }
    // No region landmark (a named section) inside another, except the talk
    // map's canvas, the named map widget inside its own section.
    const nested = await page.locator("section[aria-labelledby], section[aria-label], [role='region']").evaluateAll((nodes) => nodes
      .filter((node) => node.parentElement?.closest("section[aria-labelledby], section[aria-label], [role='region']"))
      .map((node) => node.id || node.className));
    expect(nested, route).toEqual(route === "/talks/" ? ["talk-map-canvas"] : []);
  }
});

// ---- Keyboard order and focus visibility ---------------------------------------

test.describe("keyboard", { tag: "@js" }, () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    for (const route of ROUTES) {
      test(`${route} at ${viewport.width}px: Tab visits every focusable element in order, each with a visible focus ring, and leaves the page`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await open(page, route);
        const expected = await listTabbables(page);
        expect(expected.length).toBeGreaterThan(5);
        // The crawl visits every focusable element, so its length follows the
        // data (the live Talks page has some seventy at 375px): the default
        // 30s plus a share per element.
        test.setTimeout(30_000 + 1_000 * expected.length);
        const visited = await crawlTabOrder(page, { limit: expected.length + 5, label: `${route} at ${viewport.width}px` });
        expect(visited.map((focus) => focus.name)).toEqual(expected.map((element) => element.name));
        expect(visited.map((focus) => focus.id)).toEqual(expected.map((element) => element.id));
        // The parts of the page the spec names are among them.
        const names = visited.map((focus) => focus.name).join("\n");
        expect(visited[0].name).toMatch(/^a\.skip-link\b.* "Skip to main content"$/);
        expect(names).toContain(".aa-DetachedSearchButton");
        expect(names).toContain('"Douglas Fritz on GitHub"');
        if (viewport.width < 992) expect(names).toContain('button.navbar-toggler "Toggle navigation"');
        else expect(names).toMatch(/a\.nav-link[^"]* "Publications"/);
        if (route === "/" || route === "/research/") expect(names.match(/button#pillar-\d-toggle/g)).toHaveLength(4);
        if (route === "/publications/") {
          expect(names).toContain("input#publication-filter-text");
          expect(names).toContain('"Reset filters"');
        }
        if (route === "/talks/") {
          expect(names).toContain("input#talk-filter-text");
          expect(names).toContain('"Skip map and view talks"');
          expect(names).toContain("div#talk-map-canvas");
          expect(names).toContain('"Zoom in"');
          expect(names).toContain('"View talks as a list"');
          if (mappedShownTalk) expect(names).toMatch(/talk-marker|talk-cluster/);
          if (mappedShownTalk) expect(names).toContain('"Show on map: ');
        }
      });
    }
  }

  test("on a phone the navigation menu opens from the keyboard and its links show the focus ring", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "/");
    const toggler = page.locator(".navbar-toggler");
    await expect(toggler).toBeVisible();
    await expect(page.getByRole("link", { name: "Publications", exact: true }).first()).toBeHidden();
    await toggler.focus();
    await expect(toggler).not.toHaveAttribute("role", "menu");
    await expect(toggler).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(toggler).toHaveAttribute("aria-expanded", "true");
    // Bootstrap adds "show" once the menu has finished opening.
    await expect(page.locator("#navbarCollapse")).toHaveClass(/\bshow\b/);
    for (const name of ["Home", "Research", "Publications", "Talks & Reach", "About", "CV"]) {
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toHaveText(name);
      await expect.poll(async () => (await focusedElement(page)).visible, { message: `menu link ${name} in view` }).toBe(true);
      expectVisibleFocus(await focusedElement(page), `menu link ${name}`);
    }
  });

  test("Quarto's search dialog keeps focus inside while open, shows the focus ring and returns focus when closed", async ({ page }) => {
    await open(page, "/");
    const button = page.locator("#quarto-search .aa-DetachedSearchButton");
    await button.focus();
    await page.keyboard.press("Enter");
    const input = page.locator(".aa-DetachedOverlay .aa-Input");
    await expect(input).toBeFocused();
    expectVisibleFocus(await focusedElement(page), "search input");
    await page.keyboard.type("Research");
    const results = page.locator(".aa-DetachedOverlay .search-result-link");
    await expect(results.first()).toBeVisible();
    // Tab through every control and result and wrap back to the input.
    const count = await page.locator(".aa-DetachedOverlay").evaluate((dialog) => [...dialog.querySelectorAll("a[href], button, input")].filter((node) => node.tabIndex >= 0 && node.checkVisibility()).length);
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".aa-DetachedOverlay"))), `Tab ${i + 1} stays in the dialog`).toBe(true);
      expectVisibleFocus(await focusedElement(page), `search dialog, Tab ${i + 1}`);
    }
    await expect(input).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".aa-DetachedOverlay")))).toBe(true);
    // Escape closes it; focus goes back to the button.
    await input.focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".aa-DetachedOverlay")).toHaveCount(0);
    await expect(button).toBeFocused();
    // So does Cancel.
    await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    await page.locator(".aa-DetachedCancelButton").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".aa-DetachedOverlay")).toHaveCount(0);
    await expect(button).toBeFocused();
  });
});

// ---- Descriptive link and control names ---------------------------------------

// Titles that more than one public record shares (a talk given twice, a
// paper and the talk about it). Links named by such a title alone may go to
// different records: their list item gives the type, date or year beside
// them (WCAG 2.4.4, in context). No other name may be shared by two
// destinations.
const sharedTitles = (() => {
  const counts = new Map();
  for (const record of [...publications, ...talks]) counts.set(record.title, (counts.get(record.title) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([title]) => title));
})();

// Every exposed link and button: accessible name (computed by axe-core),
// visible text and, for links, where it goes.
async function namedControls(page) {
  if (!(await page.evaluate(() => typeof window.axe === "object"))) await page.addScriptTag({ path: AXE_PATH });
  // axe's name computation needs its virtual tree (axe.setup) outside a run.
  return page.evaluate(() => {
    window.axe.setup(document);
    try {
      return [...document.querySelectorAll("a[href], button, [role='button']")]
        .filter((node) => window.axe.commons.dom.isVisibleToScreenReaders(node) && node.checkVisibility({ visibilityProperty: true }))
        .map(describeControl);
    } finally {
      window.axe.teardown();
    }
    function describeControl(node) {
      return {
        kind: node.matches("a[href]:not([role='button'])") ? "link" : node.tagName === "BUTTON" ? "button" : "widget",
        name: window.axe.commons.text.accessibleText(node).replace(/\s+/g, " ").trim(),
        visible: (node.innerText ?? "").replace(/\s+/g, " ").trim(),
        href: node.matches("a[href]") ? node.href : null
      };
    }
  });
}

test.describe("names", { tag: "@js" }, () => {
  for (const route of ROUTES) {
    test(`${route}: links to different places have different names, and every name contains its visible text`, async ({ page }) => {
      await open(page, route);
      // Every link the page can show: on the pillar pages each panel is open
      // in turn (one at a time), so its links are exposed too.
      const states = [await namedControls(page)];
      if (route === "/" || route === "/research/") {
        for (let n = 1; n <= 4; n += 1) {
          await page.locator(`#pillar-${n}-toggle`).click();
          await expect(page.locator(`#pillar-${n}-panel`)).toBeVisible();
          states.push(await namedControls(page));
        }
        // The panels' archive and output links were among them.
        expect(states.flat().filter((control) => /^View \d+ /.test(control.name)).length).toBeGreaterThanOrEqual(8);
      }
      const controls = states.flat();
      expect(controls.filter((control) => control.kind === "link").length).toBeGreaterThan(5);
      for (const control of controls) {
        expect(control.name, `${control.kind} to ${control.href} has a name`).not.toBe("");
        // Label in name (WCAG 2.5.3), for controls whose visible text is
        // words or numbers (not a lone symbol such as Leaflet's "+").
        const words = control.visible.length > 1 && /[\p{L}\p{N}]/u.test(control.visible);
        if (words) expect(control.name.toLowerCase(), `${control.kind} "${control.visible}"`).toContain(control.visible.toLowerCase());
      }
      // A link to an element (a fragment) goes to that element, whatever its
      // query adds (Selected work and the pillar outputs link one card with
      // and without ?foundational=include); any other link goes to its URL.
      const destination = (href) => {
        const url = new URL(href);
        return url.hash ? `${url.origin}${url.pathname}${url.hash}` : url.href;
      };
      const destinations = new Map();
      for (const { name, href } of controls.filter((control) => control.kind === "link")) {
        destinations.set(name, new Set([...(destinations.get(name) ?? []), destination(href)]));
      }
      const ambiguous = [...destinations].filter(([name, hrefs]) => hrefs.size > 1 && !sharedTitles.has(name));
      expect(ambiguous.map(([name, hrefs]) => `${name} -> ${[...hrefs].join(", ")}`), route).toEqual([]);
      // Buttons that repeat per card name their card too. (The map's
      // markers and clusters, role="button" widgets, are named by the talk
      // or by how many talks they group; they are checked above.)
      for (const state of states) {
        const buttons = state.filter((control) => control.kind === "button").map((control) => control.name);
        const repeated = buttons.filter((name, i) => buttons.indexOf(name) !== i && !/^Reset filters$/.test(name));
        expect(repeated, `${route}: repeated button names`).toEqual([]);
      }
    });
  }

  test("per-card links and buttons name their record after their visible text", async ({ page }) => {
    // Checks per card: the default 30s plus a share per record.
    test.setTimeout(30_000 + 500 * (talks.length + publications.length));
    await open(page, "/talks/", "?foundational=include");
    const talkLinks = page.locator("#talk-records .record-links a");
    if (!liveData) expect(await talkLinks.count()).toBeGreaterThan(0);
    for (const link of await talkLinks.all()) {
      const card = link.locator("xpath=ancestor::article[1]");
      const title = await card.locator(".record-title").textContent();
      const date = await card.locator("time").textContent();
      await expect(link).toHaveAccessibleName(`${await link.textContent()}: ${title}, ${date}`);
    }
    for (const button of await page.locator(".talk-map-button").all()) {
      const card = button.locator("xpath=ancestor::article[1]");
      await expect(button).toHaveAccessibleName(`Show on map: ${await card.locator(".record-title").textContent()}, ${await card.locator("time").textContent()}`);
    }
    await open(page, "/publications/", "?foundational=include");
    const publicationLinks = page.locator("#publication-records .record-links a");
    if (!liveData) expect(await publicationLinks.count()).toBeGreaterThan(0);
    for (const link of await publicationLinks.all()) {
      const title = await link.locator("xpath=ancestor::article[1]").locator(".record-title").textContent();
      await expect(link).toHaveAccessibleName(`${await link.textContent()}: ${title}`);
    }
  });
});

// ---- Safe link targets and requests (spec 16) ----------------------------------

// Every URL-bearing attribute on the page: links and areas, form actions,
// frames, images, scripts, stylesheets and media.
const URL_ATTRIBUTES = [
  ["a[href]", "href"], ["area[href]", "href"], ["form[action]", "action"], ["iframe[src]", "src"], ["img[src]", "src"],
  ["script[src]", "src"], ["link[href]", "href"], ["source[src]", "src"], ["video[src]", "src"], ["audio[src]", "src"],
  ["embed[src]", "src"], ["object[data]", "data"]
];

test("every link, form, frame, image, script and stylesheet uses https, the site itself or (links only) mailto", async ({ page }, testInfo) => {
  const enhanced = testInfo.project.use.javaScriptEnabled !== false;
  for (const route of ROUTES) {
    if (enhanced) await open(page, route);
    else await page.goto(route);
    const found = await page.evaluate((attributes) => attributes.flatMap(([selector, attribute]) => [...document.querySelectorAll(selector)].map((node) => {
      const raw = node.getAttribute(attribute) ?? "";
      let resolved = null;
      try {
        resolved = new URL(raw, document.baseURI);
      } catch {
        // Unparseable: reported below.
      }
      return {
        tag: node.tagName.toLowerCase(),
        raw,
        protocol: resolved?.protocol ?? null,
        sameOrigin: resolved?.origin === window.location.origin,
        target: node.getAttribute("target"),
        rel: node.getAttribute("rel") ?? "",
        name: node.getAttribute("aria-label") ?? node.textContent ?? ""
      };
    })), URL_ATTRIBUTES);
    expect(found.filter((item) => item.tag === "a").length, route).toBeGreaterThan(5);
    // Unparseable, a script or data URL, or another site over anything but
    // https (http:, a protocol-relative //host link from an http page, ftp:).
    // (Quarto's script makes the site's own links absolute; they stay
    // same-origin.)
    const unsafe = found.filter((item) => {
      if (item.protocol === null || /^\s*(javascript|data|vbscript):/i.test(item.raw)) return true;
      if (item.sameOrigin || item.protocol === "https:") return false;
      return !(item.protocol === "mailto:" && (item.tag === "a" || item.tag === "area"));
    });
    expect(unsafe, route).toEqual([]);
    // A link that opens a new tab must say so and must not expose the page.
    for (const item of found.filter((entry) => entry.target === "_blank")) {
      expect(item.rel.split(/\s+/), `${route}: ${item.raw}`).toContain("noopener");
      expect(item.name, `${route}: ${item.raw}`).toMatch(/new (tab|window)/i);
    }
  }
});

test("the pages request nothing from other sites, apart from the talk map's OpenStreetMap tiles", async ({ page, baseURL }, testInfo) => {
  const enhanced = testInfo.project.use.javaScriptEnabled !== false;
  for (const route of ROUTES) {
    const requests = [];
    const record = (request) => requests.push(request.url());
    page.on("request", record);
    if (enhanced) {
      await open(page, route);
      if (route === "/talks/") await expect(page.locator("#talk-map-canvas img.leaflet-tile").first()).toBeAttached();
    } else {
      await page.goto(route);
    }
    await page.waitForLoadState("networkidle");
    page.off("request", record);
    expect(requests.length, route).toBeGreaterThan(0);
    // data: URLs are not requests to anyone (none of the site's own, but a
    // library's stylesheet may use them).
    const elsewhere = requests.filter((url) => !url.startsWith(`${baseURL}/`) && !url.startsWith("data:"));
    const allowed = (url) => route === "/talks/" && enhanced && TILE_PATTERN.test(url);
    expect(elsewhere.filter((url) => !allowed(url)), route).toEqual([]);
    if (route === "/talks/" && enhanced) expect(elsewhere.length, "the map requests its tiles").toBeGreaterThan(0);
  }
});

// ---- Forced colours ---------------------------------------------------------------

test.describe("forced colours", { tag: "@js" }, () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
  });

  const outline = (locator) => locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) || 0, shadow: style.boxShadow };
  });

  test("the selected pillar keeps an outline when the system replaces colours and shadows", async ({ page }) => {
    await open(page, "/research/");
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    await page.locator("#pillar-2-toggle").click();
    const selected = await outline(page.locator("#pillar-2"));
    expect(selected.shadow, "box shadows are gone in forced colours").toBe("none");
    expect(selected.style).toBe("solid");
    expect(selected.width).toBeGreaterThanOrEqual(2);
    expect((await outline(page.locator("#pillar-1"))).style).toBe("none");
  });

  test("the selected marker and card keep an outline; badges keep their shapes; the focus ring stays", async ({ page }) => {
    // A badge check per publication: the default 30s plus a share per record.
    test.setTimeout(30_000 + 500 * publications.length);
    if (!liveData) expect(mappedShownTalk).toBeTruthy();
    if (mappedShownTalk) {
      const { key } = mappedShownTalk.properties;
      await open(page, "/talks/");
      await page.locator(`article[data-key=${cssString(key)}] .talk-map-button`).click();
      await expect(page.locator("#talk-map-canvas .talk-popup")).toBeFocused();
      const marker = await outline(page.locator(`#talk-map-canvas .talk-marker[data-key=${cssString(key)}]`));
      expect(marker.style).toBe("solid");
      expect(marker.width).toBeGreaterThanOrEqual(2);
      const card = await outline(page.locator(`article[data-key=${cssString(key)}]`));
      expect(card.style).toBe("solid");
      expect(card.width).toBeGreaterThanOrEqual(2);
      // Unselected cards have none.
      const others = page.locator("article.talk-card:not(.is-map-selected):visible");
      if (await others.count()) expect((await outline(others.first())).style).toBe("none");
    }
    // Virtual talks: the badge's double border; In Review: a dashed, italic
    // badge where Published is solid.
    await open(page, "/talks/", "?foundational=include");
    const virtual = page.locator("#talk-records .virtual-badge").first();
    if (!liveData) await expect(virtual).toHaveCount(1);
    if (await virtual.count()) await expect(virtual).toHaveCSS("border-top-style", "double");
    await open(page, "/publications/", "?foundational=include");
    for (const record of publications) {
      const badge = page.locator(`#publication-records [data-key=${cssString(record.key)}] .status-badge`);
      await expect(badge).toHaveCSS("border-top-style", record.status === "Published" ? "solid" : "dashed");
      if (record.status !== "Published") await expect(badge).toHaveCSS("font-style", "italic");
    }
    // The filter checkbox stays a native control (the system draws its state).
    await expect(page.getByLabel("Include foundational work")).toHaveCSS("appearance", "auto");
    // The focus ring is an outline, which forced colours keep.
    await page.getByLabel("Search publications").focus();
    const ring = await outline(page.getByLabel("Search publications"));
    expect(ring.style).toBe("solid");
    expect(ring.width).toBe(3);
  });
});

// ---- Reduced motion ------------------------------------------------------------

test.describe("reduced motion", { tag: "@js" }, () => {
  test("no page runs an animation or transition, and nothing scrolls smoothly", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of ROUTES) {
      await open(page, route);
      // Interact so that state changes would start any transition.
      if (route === "/" || route === "/research/") await page.locator("#pillar-1-toggle").click();
      if (route === "/publications/") await page.getByLabel("Include foundational work").check();
      if (route === "/talks/" && mappedShownTalk) {
        await page.locator(`article[data-key=${cssString(mappedShownTalk.properties.key)}] .talk-map-button`).click();
        await expect(page.locator("#talk-map-canvas .talk-popup")).toBeFocused();
      }
      const motion = await page.evaluate(() => {
        const interactive = [...document.querySelectorAll("a, button, input, select, [tabindex], .pillar-card, .talk-card, .leaflet-marker-icon, .headroom")];
        const moving = interactive.filter((node) => getComputedStyle(node).transitionDuration.split(",").some((part) => parseFloat(part) > 0));
        return {
          animations: document.getAnimations().map((animation) => animation.constructor.name),
          checked: interactive.length,
          moving: moving.map((node) => `${node.tagName.toLowerCase()}.${node.className}`).slice(0, 10),
          scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior
        };
      });
      expect(motion.checked, route).toBeGreaterThan(5);
      expect(motion, route).toEqual({ animations: [], checked: motion.checked, moving: [], scrollBehavior: "auto" });
    }
  });

  test("without the preference, transitions remain (control)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await open(page, "/research/");
    expect(await page.locator("#pillar-1").evaluate((node) => getComputedStyle(node).transitionDuration)).not.toBe("0s");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("smooth");
  });
});

// ---- Without JavaScript --------------------------------------------------------

test.describe("without JavaScript", { tag: "@no-js" }, () => {
  // Canonical content per page: its h1 and what the page lists.
  const CONTENT = {
    "/": async (page) => {
      await expect(page.locator("main h1")).toBeVisible();
      for (let n = 1; n <= 4; n += 1) await expect(page.locator(`#pillar-${n}-panel`)).toBeVisible();
      await expect(page.locator("#selected-work")).toBeVisible();
      await expect(page.locator("#home-reach")).toBeVisible();
    },
    "/research/": async (page) => {
      for (let n = 1; n <= 4; n += 1) await expect(page.locator(`#pillar-${n}-panel`)).toBeVisible();
    },
    "/publications/": async (page) => {
      await expect(page.locator("#publication-records > article")).toHaveCount(publications.length);
      for (const record of publications) await expect(page.locator(`#publication-records [data-key=${cssString(record.key)}]`)).toBeVisible();
    },
    "/talks/": async (page) => {
      await expect(page.locator("#talk-records > article")).toHaveCount(talks.length);
      for (const record of talks) await expect(page.locator(`#talk-records [data-key=${cssString(record.key)}]`)).toBeVisible();
      await expect(page.locator("#talk-reach")).toBeVisible();
    },
    "/about/": async (page) => {
      expect(await page.locator("main h2").count()).toBeGreaterThan(2);
    },
    "/cv/": async (page) => {
      await expect(page.locator("main .cv-download")).toBeVisible();
    }
  };

  for (const route of ROUTES) {
    test(`${route}: the content is all there, no control or box needs a script, and nothing visible is hidden from assistive technology`, async ({ page }) => {
      // The archives check every record: the default 30s plus a share per record.
      test.setTimeout(30_000 + 200 * (talks.length + publications.length));
      await page.goto(route);
      await expect(page.locator("main h1")).toHaveCount(1);
      await CONTENT[route](page);
      // Controls that need a script are not shown: the filter forms, the
      // reset buttons, the map and its buttons, Quarto's search box, the
      // navbar toggler. The pillar headings' buttons are the exception: they
      // report their panels as expanded, which they are (the Task 7 contract).
      const controls = await page.locator("button, input, select, textarea").evaluateAll((nodes) => nodes
        .filter((node) => node.checkVisibility({ visibilityProperty: true }))
        .map((node) => node.id || node.className));
      expect(controls.filter((id) => !/^pillar-\d-toggle$/.test(id)), route).toEqual([]);
      expect(controls.length).toBe(route === "/" || route === "/research/" ? 4 : 0);
      await expect(page.locator("#talk-map")).toBeHidden();
      // Nothing visible is hidden from assistive technology except decorative
      // glyphs (a +/- sign, a pillar number swatch): at most two characters,
      // nothing focusable.
      const hidden = await page.locator("[aria-hidden='true']").evaluateAll((nodes) => nodes
        .filter((node) => node.checkVisibility({ visibilityProperty: true }))
        .filter((node) => node.textContent.trim().length > 2 || node.querySelector("a, button, input, select, [tabindex]"))
        .map((node) => node.outerHTML.slice(0, 120)));
      expect(hidden, route).toEqual([]);
    });
  }

  test("on a phone the navigation links are shown (the menu button needs a script)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator(".navbar-toggler")).toBeHidden();
      for (const name of ["Home", "Research", "Publications", "Talks & Reach", "About", "CV"]) {
        await expect(page.locator(".navbar-nav.me-auto").getByRole("link", { name, exact: true })).toBeVisible();
      }
    }
  });

  test("the pillar archive links say that they open the whole archive", async ({ page }) => {
    for (const route of ["/", "/research/"]) {
      await page.goto(route);
      const notes = page.locator("[data-pillar-component] .nojs-note");
      await expect(notes).toHaveCount(4);
      for (const note of await notes.all()) {
        await expect(note).toBeVisible();
        await expect(note).toHaveText("Without JavaScript, these links open the whole archive, unfiltered.");
      }
    }
  });

  test("every internal link opens a page that exists, and every fragment names an element on it", async ({ page, baseURL }) => {
    const targets = new Map();
    for (const route of ROUTES) {
      await page.goto(route);
      for (const href of await page.locator("a[href]").evaluateAll((nodes) => nodes.map((node) => node.href))) {
        const url = new URL(href);
        if (url.origin !== new URL(baseURL).origin) continue;
        const pageUrl = `${url.origin}${url.pathname}`;
        targets.set(pageUrl, new Set([...(targets.get(pageUrl) ?? []), ...(url.hash ? [decodeURIComponent(url.hash.slice(1))] : [])]));
      }
    }
    expect(targets.size).toBeGreaterThanOrEqual(ROUTES.length);
    // One load per linked page and a check per linked card: the default 30s
    // plus a share for each.
    const fragments = [...targets.values()].reduce((sum, ids) => sum + ids.size, 0);
    test.setTimeout(30_000 + 3_000 * targets.size + 200 * fragments);
    for (const [pageUrl, fragments] of targets) {
      const response = await page.goto(pageUrl);
      expect(response.status(), pageUrl).toBe(200);
      for (const id of fragments) await expect(page.locator(`[id=${cssString(id)}]`), `${pageUrl}#${id}`).toHaveCount(1);
    }
  });
});

test("with JavaScript the no-script notes are hidden", { tag: "@js" }, async ({ page }) => {
  await open(page, "/research/");
  await expect(page.locator(".nojs-note")).toHaveCount(4);
  for (const note of await page.locator(".nojs-note").all()) await expect(note).toBeHidden();
});
