// Browser tests for the research-pillar component (_pillars.qmd, rendered by
// R/pillar_cards.R; js/pillars.js) on the Research and Home pages. They are
// data-driven: every expectation comes from data/generated/ and
// data/pillar-copy.yml at test time, so the suite runs on the synthetic
// fixtures (locally) and on the live sheet (CI, with E2E_DATA=live).
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { pillarHref } from "../../js/pillars.js";
import { cssString, expect, liveData, readGenerated, renderScratchSite, root as repoRoot, routeScratchSite, test } from "./support.mjs";

const pillars = JSON.parse(readGenerated("pillars.json"));
const publications = loadYaml(readGenerated("publications.yml"));
const talks = loadYaml(readGenerated("talks.yml"));
const copy = loadYaml(readFileSync(path.join(repoRoot, "data", "pillar-copy.yml"), "utf8"));

const UMBRELLA = "Translational physician-scientist for public health";
// The controlled pillar values (R/config.R), in canonical order.
const PILLAR_NAMES = [
  "Infectious-disease biology, evolution and environment",
  "Quantitative and experimental biomedical discovery",
  "Clinical translation and health-system improvement",
  "Climate and planetary health in medicine"
];
const PAGES = ["/research/", "/"];
const JET_BLACK = "rgb(37, 50, 55)";
const COOL_STEEL = "rgb(157, 180, 192)";

// Each archive, as the pillar links reach it (templates/*.ejs.md ids).
const KINDS = {
  publications: {
    base: "/publications/",
    records: publications,
    nouns: ["publication", "publications"],
    card: "publication",
    pillarControl: "#publication-filter-pillar",
    foundationalControl: "#publication-filter-foundational",
    container: "#publication-records",
    count: "#publication-filters [data-archive-count]",
    heading: "Selected publications"
  },
  talks: {
    base: "/talks/",
    records: talks,
    nouns: ["talk", "talks"],
    card: "talk",
    pillarControl: "#talk-filter-pillar",
    foundationalControl: "#talk-filter-foundational",
    container: "#talk-records",
    count: "#talk-filters [data-archive-count]",
    heading: "Selected talks"
  }
};
const KIND_NAMES = Object.keys(KINDS);

// ---- Reference model, independent of the page and of js/filter-core.js ----

const isAssigned = (record, name) => record.primary_pillar === name || record.secondary_pillar === name;
const assignedRecords = (kind, name) => KINDS[kind].records.filter((record) => isAssigned(record, name));
const noun = (n, [one, many]) => (n === 1 ? one : many);
const linkText = (kind, name) => {
  const any = assignedRecords(kind, name).length;
  return `View ${any} ${noun(any, KINDS[kind].nouns)} in Pillar ${PILLAR_NAMES.indexOf(name) + 1}`;
};
const recordByKey = (kind, key) => KINDS[kind].records.find((record) => record.key === key);
const cardHref = (kind, slug) => `${KINDS[kind].base}?foundational=include#${KINDS[kind].card}-${encodeURIComponent(slug)}`;
// Quarto rewrites site-absolute links in a page to page-relative ones (and
// undoes percent-encoding that is not needed, such as %20), and its script
// makes them absolute again; the URL a link opens is unchanged. So links are
// compared as resolved URLs.
const resolvedHref = (locator) => locator.evaluate((node) => node.href);
const resolve = (page, href) => new URL(href, page.url()).href;
const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// ---- Page helpers -----------------------------------------------------------

const component = (page) => page.locator("[data-pillar-component]");
const card = (page, n) => page.locator(`#pillar-${n}`);
const toggle = (page, n) => page.locator(`#pillar-${n}-toggle`);
const panel = (page, n) => page.locator(`#pillar-${n}-panel`);

async function openEnhanced(page, pagePath) {
  await page.goto(pagePath);
  await expect(component(page)).toHaveClass(/\bjs-enhanced\b/);
}

// Which pillars are open: aria-expanded, panel visibility and the hidden
// attribute must agree.
async function expectOpen(page, open) {
  for (let n = 1; n <= 4; n += 1) {
    const isOpen = open === n;
    await expect(toggle(page, n)).toHaveAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      await expect(panel(page, n)).toBeVisible();
      await expect(panel(page, n)).not.toHaveAttribute("hidden");
      await expect(card(page, n)).toHaveClass(/\bis-selected\b/);
    } else {
      await expect(panel(page, n)).toBeHidden();
      await expect(panel(page, n)).toHaveAttribute("hidden", "");
      await expect(card(page, n)).not.toHaveClass(/\bis-selected\b/);
    }
  }
}

// What a reader is shown: the component's rendered text and visible links.
const shownContent = (page) => component(page).evaluate((node) => ({
  text: node.innerText.replace(/\s+/g, " ").trim(),
  links: [...node.querySelectorAll("a")].filter((link) => link.checkVisibility()).map((link) => link.href)
}));

async function tabTo(page, id, limit = 100) {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((target) => document.activeElement?.id === target, id)) return;
  }
  throw new Error(`Tab never reached #${id}`);
}

const outlineOf = (locator) => locator.evaluate((node) => {
  const style = getComputedStyle(node);
  return [style.outlineStyle, style.outlineWidth, style.outlineColor, style.outlineOffset];
});

// ---- Data preconditions -----------------------------------------------------

test("the generated data exercises the cases these tests check", () => {
  expect(Object.keys(pillars)).toEqual(PILLAR_NAMES);
  expect(Object.keys(copy)).toEqual(PILLAR_NAMES);
  expect(PILLAR_NAMES).not.toContain(UMBRELLA);
  for (const name of PILLAR_NAMES) {
    for (const kind of KIND_NAMES) {
      const entry = pillars[name][kind];
      const expected = assignedRecords(kind, name);
      expect(entry.keys, `${name} ${kind}`).toEqual(expected.map((record) => record.key));
      expect(entry.any).toBe(expected.length);
      expect(entry.primary).toBe(expected.filter((record) => record.primary_pillar === name).length);
      expect(entry.representative.length).toBeLessThanOrEqual(3);
    }
    expect(Array.isArray(pillars[name].topic_tags)).toBe(true);
  }
  if (liveData) return;
  const entries = PILLAR_NAMES.flatMap((name) => KIND_NAMES.map((kind) => ({ name, kind, ...pillars[name][kind] })));
  const reps = entries.flatMap(({ kind, representative }) => representative.map((key) => recordByKey(kind, key)));
  // At least two pillars with both publications and talks.
  expect(PILLAR_NAMES.filter((name) => KIND_NAMES.every((kind) => pillars[name][kind].any > 0)).length).toBeGreaterThanOrEqual(2);
  // Secondary pillars, foundational work, primary counts that differ from the
  // link counts, secondary-pillar and foundational selected outputs.
  for (const kind of KIND_NAMES) expect(KINDS[kind].records.some((record) => record.secondary_pillar), kind).toBe(true);
  expect([...publications, ...talks].some((record) => record.foundational_work === "Y")).toBe(true);
  expect(entries.some((entry) => entry.primary !== entry.any)).toBe(true);
  expect(entries.some((entry) => entry.representative_secondary > 0)).toBe(true);
  expect(reps.some((record) => record.foundational_work === "Y")).toBe(true);
  expect(PILLAR_NAMES.every((name) => pillars[name].topic_tags.length > 0)).toBe(true);
});

for (const pagePath of PAGES) {
  test.describe(`pillar component on ${pagePath}`, () => {
    // ---- Static content (with and without JavaScript) ----------------------

    test("the umbrella is text and there are exactly four numbered pillar controls", async ({ page }) => {
      await page.goto(pagePath);
      const root = component(page);
      await expect(root).toHaveCount(1);
      await expect(root.getByRole("heading", { level: 2, name: UMBRELLA, exact: true })).toBeVisible();
      // Not a control or a value anywhere on the page.
      for (const role of ["button", "link", "tab", "option", "checkbox", "radio", "combobox", "listbox", "menuitem", "switch"]) {
        await expect(page.getByRole(role, { name: UMBRELLA }), role).toHaveCount(0);
      }
      const values = await page.locator("[value], [data-pillar]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("value") ?? node.dataset.pillar));
      expect(values).not.toContain(UMBRELLA);

      const buttons = root.getByRole("button");
      await expect(buttons).toHaveCount(4);
      const headings = root.getByRole("heading", { level: 3 });
      await expect(headings).toHaveCount(4);
      for (let i = 0; i < 4; i += 1) {
        const n = i + 1;
        const name = `Pillar ${n} ${PILLAR_NAMES[i]}`;
        await expect(buttons.nth(i)).toHaveAccessibleName(name);
        await expect(headings.nth(i)).toHaveAccessibleName(name);
        await expect(buttons.nth(i)).toHaveAttribute("id", `pillar-${n}-toggle`);
        await expect(buttons.nth(i)).toHaveAttribute("aria-controls", `pillar-${n}-panel`);
        await expect(buttons.nth(i)).toHaveAccessibleDescription(`Role: ${copy[PILLAR_NAMES[i]].role}`);
        // The controlled panel is the card's own.
        await expect(card(page, n).locator(`#pillar-${n}-panel`)).toHaveCount(1);
        await expect(card(page, n)).toHaveAccessibleName(name);
      }
      expect(await root.locator("[data-pillar]").evaluateAll((nodes) => nodes.map((node) => node.dataset.pillar))).toEqual(PILLAR_NAMES);
      expect(await root.locator("[data-pillar-number]").evaluateAll((nodes) => nodes.map((node) => node.dataset.pillarNumber))).toEqual(["1", "2", "3", "4"]);
    });

    test("copy, topic tags, counts, archive links and selected outputs agree with the data", async ({ page }) => {
      await page.goto(pagePath);
      const textOf = (locator) => locator.evaluate((node) => node.textContent);
      let secondaryLabels = 0;
      for (const [i, name] of PILLAR_NAMES.entries()) {
        const n = i + 1;
        const c = card(page, n);
        const entry = pillars[name];
        expect(squash(await textOf(c.locator(".pillar-role")))).toBe(`Role: ${copy[name].role}`);
        expect(squash(await textOf(c.locator(".pillar-includes")))).toBe(`Includes: ${copy[name].includes}`);
        const tags = await c.locator(".pillar-topics li").evaluateAll((nodes) => nodes.map((node) => node.textContent));
        expect(tags).toEqual(entry.topic_tags);
        await expect(c.locator(".pillar-topics")).toHaveCount(entry.topic_tags.length > 0 ? 1 : 0);

        for (const kind of KIND_NAMES) {
          const { base, nouns, heading } = KINDS[kind];
          const summary = entry[kind];
          const fact = c.locator(`[data-pillar-kind="${kind}"]`);
          await expect(fact).toHaveCount(1);
          expect(squash(await textOf(fact.locator("[data-primary-count]")))).toBe(String(summary.primary));
          expect(squash(await textOf(fact.locator("dd").first()))).toBe(`${summary.primary} with this as primary pillar`);
          // The link states how many records it lists: primary or secondary,
          // foundational work included.
          // (CSS locators: with JavaScript the closed panels are hidden.)
          const link = fact.locator("a");
          await expect(link).toHaveCount(1);
          expect(squash(await textOf(link))).toBe(linkText(kind, name));
          expect(squash(await textOf(link))).toBe(`View ${summary.any} ${noun(summary.any, nouns)} in Pillar ${n}`);
          expect(await resolvedHref(link)).toBe(resolve(page, pillarHref(base, name)));

          expect(squash(await textOf(c.locator("h4").filter({ hasText: heading })))).toBe(heading);
          const outputs = c.locator(`ul[data-pillar-outputs="${kind}"] > li`);
          await expect(outputs).toHaveCount(summary.representative.length);
          if (summary.representative.length === 0) {
            expect(squash(await textOf(c.locator(`p[data-pillar-outputs="${kind}"]`)))).toBe(`No public ${nouns[1]} in this pillar yet.`);
            continue;
          }
          for (const [j, key] of summary.representative.entries()) {
            const record = recordByKey(kind, key);
            expect(record, key).toBeDefined();
            const item = outputs.nth(j);
            await expect(item).toHaveAttribute("data-key", key);
            const anchor = item.locator("a");
            expect(await resolvedHref(anchor)).toBe(resolve(page, cardHref(kind, record.slug)));
            expect(await textOf(anchor)).toBe(record.title);
            expect(squash(await textOf(item.locator(".pillar-output-year")))).toBe(String(record.year));
            // "also tagged" exactly when this pillar is the record's secondary one.
            const secondary = record.primary_pillar !== name;
            expect(record.primary_pillar === name || record.secondary_pillar === name).toBe(true);
            await expect(item.locator(".pillar-output-secondary")).toHaveCount(secondary ? 1 : 0);
            if (secondary) {
              expect(squash(await textOf(item.locator(".pillar-output-secondary")))).toBe("also tagged (secondary pillar)");
              secondaryLabels += 1;
            }
          }
          await expect(c.locator(`ul[data-pillar-outputs="${kind}"] .pillar-output-secondary`)).toHaveCount(summary.representative_secondary);
        }
      }
      if (!liveData) expect(secondaryLabels).toBeGreaterThan(0);
    });

    test("no horizontal overflow at 375, 768 and 1280 px, and controls of at least 24 px", async ({ page }, testInfo) => {
      const enhanced = testInfo.project.use.javaScriptEnabled !== false;
      for (const width of [375, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(pagePath);
        // Without JavaScript every panel is open; with it, open each in turn.
        const states = enhanced ? [1, 2, 3, 4] : [null];
        if (enhanced) await expect(component(page)).toHaveClass(/\bjs-enhanced\b/);
        for (const n of states) {
          if (n) {
            await toggle(page, n).click();
            await expect(panel(page, n)).toBeVisible();
          }
          const overflow = await page.evaluate(() => ({
            page: document.documentElement.scrollWidth - window.innerWidth,
            wide: [...document.querySelectorAll("[data-pillar-component] *")]
              .filter((node) => node.checkVisibility() && node.getBoundingClientRect().right > window.innerWidth + 0.5)
              .map((node) => node.outerHTML.slice(0, 80))
          }));
          expect(overflow, `${width}px, pillar ${n ?? "all"}`).toEqual({ page: 0, wide: [] });
        }
        for (let n = 1; n <= 4; n += 1) {
          const box = await toggle(page, n).boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(24);
          expect(box.height).toBeGreaterThanOrEqual(24);
        }
      }
    });

    // ---- Without JavaScript ------------------------------------------------

    test("without JavaScript every pillar is shown in full as stacked cards", { tag: "@no-js" }, async ({ page }) => {
      await page.goto(pagePath);
      const root = component(page);
      await expect(root).not.toHaveClass(/\bjs-enhanced\b/);
      await expect(root.locator(".pillar-hint")).toBeHidden();
      for (let n = 1; n <= 4; n += 1) {
        const name = PILLAR_NAMES[n - 1];
        await expect(toggle(page, n)).toHaveAttribute("aria-expanded", "true");
        await expect(panel(page, n)).toBeVisible();
        await expect(card(page, n).locator(".pillar-toggle-state")).toBeHidden();
        await expect(card(page, n).locator(".pillar-role")).toBeVisible();
        await expect(card(page, n).locator(".pillar-includes")).toBeVisible();
        for (const kind of KIND_NAMES) {
          const link = card(page, n).locator(`[data-pillar-kind="${kind}"]`).getByRole("link");
          await expect(link).toBeVisible();
          await expect(link).toHaveText(linkText(kind, name));
          for (const item of await card(page, n).locator(`[data-pillar-outputs="${kind}"] a`).all()) await expect(item).toBeVisible();
        }
      }
      // Stacked in DOM order: umbrella, then pillars 1-4, one column.
      const boxes = [await root.locator(".pillar-hub").boundingBox()];
      for (let n = 1; n <= 4; n += 1) boxes.push(await card(page, n).boundingBox());
      for (let i = 1; i < boxes.length; i += 1) {
        expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);
        expect(Math.abs(boxes[i].x - boxes[1].x)).toBeLessThan(1);
        expect(Math.abs(boxes[i].width - boxes[1].width)).toBeLessThan(1);
      }
    });

    // ---- With JavaScript ---------------------------------------------------

    test("pillars start collapsed; selecting one shows only it; selecting it again closes it", { tag: "@js" }, async ({ page }) => {
      await openEnhanced(page, pagePath);
      await expect(component(page).locator(".pillar-hint")).toBeVisible();
      await expectOpen(page, null);
      await toggle(page, 2).click();
      await expectOpen(page, 2);
      await toggle(page, 4).click();
      await expectOpen(page, 4);
      await expect(card(page, 4).locator(".pillar-toggle-state")).toBeVisible();
      await toggle(page, 4).click();
      await expectOpen(page, null);
    });

    test("hover and keyboard focus emphasise a pillar without revealing it", { tag: "@js" }, async ({ page }) => {
      await openEnhanced(page, pagePath);
      await page.mouse.move(0, 0);
      await expect(card(page, 3)).toHaveCSS("border-top-color", COOL_STEEL);
      await toggle(page, 3).hover();
      await expect(card(page, 3)).toHaveCSS("border-top-color", JET_BLACK);
      await expect(card(page, 1)).toHaveCSS("border-top-color", COOL_STEEL);
      await expectOpen(page, null);
      await page.mouse.move(0, 0);
      await expect(card(page, 3)).toHaveCSS("border-top-color", COOL_STEEL);

      for (let n = 1; n <= 4; n += 1) {
        await tabTo(page, `pillar-${n}-toggle`);
        // The site's opaque ring, outside the card's 2px border.
        expect(await outlineOf(toggle(page, n))).toEqual(["solid", "3px", JET_BLACK, "6px"]);
        await expect(card(page, n)).toHaveCSS("border-top-color", JET_BLACK);
        await expectOpen(page, null);
      }
    });

    test("mouse and keyboard (Enter, Space) selection expose the same content", { tag: "@js" }, async ({ page }) => {
      for (let n = 1; n <= 4; n += 1) {
        await openEnhanced(page, pagePath);
        await toggle(page, n).click();
        await expectOpen(page, n);
        const byMouse = await shownContent(page);
        // The open pillar's role and both archive links are among what shows.
        expect(byMouse.text).toContain(`Role: ${copy[PILLAR_NAMES[n - 1]].role}`);
        for (const kind of KIND_NAMES) expect(byMouse.links).toContain(resolve(page, pillarHref(KINDS[kind].base, PILLAR_NAMES[n - 1])));

        await openEnhanced(page, pagePath);
        await tabTo(page, `pillar-${n}-toggle`);
        await page.keyboard.press("Enter");
        await expectOpen(page, n);
        expect(await shownContent(page)).toEqual(byMouse);
        await page.keyboard.press("Space");
        await expectOpen(page, null);
        await page.keyboard.press("Space");
        await expectOpen(page, n);
        expect(await shownContent(page)).toEqual(byMouse);
        await expect(toggle(page, n)).toBeFocused();
      }
    });

    test.describe("on a touch screen", { tag: "@js" }, () => {
      test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });

      test("tapping a pillar exposes the same content as clicking it", async ({ page }) => {
        for (let n = 1; n <= 4; n += 1) {
          await openEnhanced(page, pagePath);
          await toggle(page, n).click();
          await expectOpen(page, n);
          const byClick = await shownContent(page);

          await openEnhanced(page, pagePath);
          await toggle(page, n).tap();
          await expectOpen(page, n);
          expect(await shownContent(page)).toEqual(byClick);
          await toggle(page, n).tap();
          await expectOpen(page, null);
        }
      });
    });

    test("reduced motion: no transitions; otherwise brief ones", { tag: "@js" }, async ({ page }) => {
      const durations = () => component(page).locator(".pillar-card, .pillar-toggle-state")
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).transitionDuration));
      const allZero = (values) => values.every((value) => value.split(",").every((part) => part.trim() === "0s"));

      await page.emulateMedia({ reducedMotion: "reduce" });
      await openEnhanced(page, pagePath);
      await expect(component(page)).not.toHaveClass(/\bpillars-motion\b/);
      let values = await durations();
      expect(values).toHaveLength(8);
      expect(allZero(values), values.join(" | ")).toBe(true);
      await toggle(page, 1).click();
      await expectOpen(page, 1);
      expect(allZero(await durations())).toBe(true);
      // The stylesheet also refuses transitions while reduced motion is set.
      await component(page).evaluate((node) => node.classList.add("pillars-motion"));
      expect(allZero(await durations())).toBe(true);

      // Turning the preference off brings the brief transitions back.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(component(page)).toHaveClass(/\bpillars-motion\b/);
      values = await durations();
      expect(values.every((value) => value.split(",").every((part) => part.trim() === "0.15s")), values.join(" | ")).toBe(true);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(component(page)).not.toHaveClass(/\bpillars-motion\b/);
      expect(allZero(await durations())).toBe(true);
    });

    test("desktop surrounds the umbrella with the four pillars; narrower screens stack them", { tag: "@js" }, async ({ page }) => {
      const layout = async () => {
        const hub = await component(page).locator(".pillar-hub").boundingBox();
        const cards = [];
        for (let n = 1; n <= 4; n += 1) cards.push(await card(page, n).boundingBox());
        return { hub, cards };
      };
      await page.setViewportSize({ width: 1280, height: 900 });
      await openEnhanced(page, pagePath);
      let { hub, cards } = await layout();
      const [c1, c2, c3, c4] = cards;
      expect(Math.abs(c1.y - c2.y)).toBeLessThan(1);
      expect(c2.x).toBeGreaterThanOrEqual(c1.x + c1.width);
      expect(hub.y).toBeGreaterThanOrEqual(c1.y + c1.height);
      expect(c3.y).toBeGreaterThanOrEqual(hub.y + hub.height);
      expect(Math.abs(c3.y - c4.y)).toBeLessThan(1);
      expect(c4.x).toBeGreaterThanOrEqual(c3.x + c3.width);
      expect(Math.abs((hub.x + hub.width / 2) - (c1.x + (c2.x + c2.width - c1.x) / 2))).toBeLessThan(2);
      // The DOM order stays umbrella, 1, 2, 3, 4.
      expect(await component(page).evaluate((node) => [...node.children].map((child) => child.dataset.pillarNumber ?? "hub")))
        .toEqual(["hub", "1", "2", "3", "4"]);

      for (const width of [768, 375]) {
        await page.setViewportSize({ width, height: 900 });
        ({ hub, cards } = await layout());
        const stack = [hub, ...cards];
        for (let i = 1; i < stack.length; i += 1) {
          expect(stack[i].y, `${width}px`).toBeGreaterThanOrEqual(stack[i - 1].y + stack[i - 1].height);
          expect(Math.abs(stack[i].x - cards[0].x)).toBeLessThan(1);
        }
      }
    });

    // ---- Following the links (JavaScript: the archives filter) -------------

    for (const kind of KIND_NAMES) {
      test(`each pillar's ${kind} link opens the ${kind} archive filtered to that pillar`, { tag: "@js" }, async ({ page }) => {
        const { base, records, nouns, pillarControl, foundationalControl, container, count } = KINDS[kind];
        for (const [i, name] of PILLAR_NAMES.entries()) {
          const n = i + 1;
          await openEnhanced(page, pagePath);
          await toggle(page, n).click();
          const link = panel(page, n).locator(`[data-pillar-kind="${kind}"]`).getByRole("link");
          const stated = Number((await link.textContent()).match(/^View (\d+) /)[1]);
          expect(stated).toBe(pillars[name][kind].any);
          await link.click();
          await page.waitForURL((url) => url.pathname === base);

          const query = Object.fromEntries(new URL(page.url()).searchParams);
          expect(query).toEqual({ pillar: name, foundational: "include" });
          await expect(page.locator(pillarControl)).toHaveValue(name);
          await expect(page.locator(foundationalControl)).toBeChecked();

          // The records listed: exactly those with the pillar as primary or
          // secondary (foundational work included), as many as the link said.
          const expected = records.filter((record) => isAssigned(record, name)).map((record) => record.key);
          const shown = await page.locator(`${container} [data-key]`)
            .evaluateAll((nodes) => nodes.filter((node) => !node.hidden && node.checkVisibility()).map((node) => node.dataset.key));
          expect(shown, `${name} ${kind}`).toEqual(expected);
          expect(shown).toHaveLength(stated);
          for (const key of shown) expect(isAssigned(records.find((record) => record.key === key), name), key).toBe(true);
          await expect(page.locator(count)).toHaveText(`Showing ${stated} of ${records.length} ${noun(records.length, nouns)}`);
          await expect(page.locator(`${container} [data-archive-empty]`)).toBeVisible({ visible: stated === 0 });
        }
      });
    }
  });
}

test("each selected output opens its archive card, foundational work included", { tag: "@js" }, async ({ page }) => {
  let followed = 0;
  for (const [i, name] of PILLAR_NAMES.entries()) {
    for (const kind of KIND_NAMES) {
      for (const key of pillars[name][kind].representative) {
        const record = recordByKey(kind, key);
        await openEnhanced(page, "/research/");
        await toggle(page, i + 1).click();
        await panel(page, i + 1).locator(`[data-pillar-outputs="${kind}"] [data-key=${cssString(key)}] a`).click();
        await page.waitForURL((url) => url.pathname === KINDS[kind].base);
        const url = new URL(page.url());
        expect(url.hash).toBe(`#${KINDS[kind].card}-${encodeURIComponent(record.slug)}`);
        expect(url.searchParams.get("foundational")).toBe("include");
        const target = page.locator(`${KINDS[kind].container} [data-key=${cssString(key)}]`);
        await expect(target).toBeVisible();
        expect(await target.evaluate((node) => node.matches(":target"))).toBe(true);
        followed += 1;
      }
    }
  }
  expect(followed).toBeGreaterThan(0);
});

// ---- Escaping (synthetic hostile records, rendered separately with R) -------

test.describe("pillar component escaping", { tag: "@js" }, () => {
  const origin = "http://hostile.test";
  const pubKey = `k"><img src=x onerror="window.__pwned=1">'`;
  const talkKey = "talk <b>2</b>";
  const title = "Bad </script><script>window.__pwned=2</script> <img src=x onerror=\"window.__pwned=3\"> *emph* [link](javascript:window.__pwned=4) & 'q' \"qq\"\n```\n<b>after fence</b> {{< meta title >}} {=html}";
  const tags = ["<svg onload=\"window.__pwned=5\">", "```", "{{< meta title >}}", "<%= 'template' %>", "a & b \"c\" 'd'"];
  const publication = {
    key: pubKey, title, year: 2025, slug: `bad"slug><img src=x onerror=window.__pwned=6>`,
    primary_pillar: PILLAR_NAMES[0], secondary_pillar: PILLAR_NAMES[1], topic_tags: tags
  };
  const talk = {
    key: talkKey, title: `Talk <i onclick="window.__pwned=7">x</i> \`code\``, year: 2024, slug: "talk-2",
    primary_pillar: PILLAR_NAMES[3], secondary_pillar: PILLAR_NAMES[0], topic_tags: []
  };
  const entry = (kind, primary, keys, secondary = 0) => ({
    primary, any: keys.length, keys, representative: keys, representative_secondary: secondary
  });
  const summary = {
    [PILLAR_NAMES[0]]: { number: 1, publications: entry("publications", 1, [pubKey]), talks: entry("talks", 0, [talkKey], 1), topic_tags: tags },
    [PILLAR_NAMES[1]]: { number: 2, publications: entry("publications", 0, [pubKey], 1), talks: entry("talks", 0, []), topic_tags: tags },
    [PILLAR_NAMES[2]]: { number: 3, publications: entry("publications", 0, []), talks: entry("talks", 0, []), topic_tags: [] },
    [PILLAR_NAMES[3]]: { number: 4, publications: entry("publications", 0, []), talks: entry("talks", 1, [talkKey]), topic_tags: [] }
  };
  let scratch;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    scratch = renderScratchSite(
      "pillar-component-",
      ["research/index.qmd", "_pillars.qmd", "R/config.R", "R/pillar_cards.R", "data/pillar-copy.yml", "js/pillars.js", "styles"],
      { "pillars.json": summary, "publications.yml": [publication], "talks.yml": [talk] },
      { theme: "styles/styles.scss", renv: true }
    );
  });

  test.afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("hostile text renders as text, never as markup, script, shortcode or a link", async ({ page }) => {
    await routeScratchSite(page, scratch, origin);
    await page.goto(`${origin}/research/`);
    const root = component(page);
    await expect(root).toHaveClass(/\bjs-enhanced\b/);
    await expect(root.getByRole("button")).toHaveCount(4);

    await expect(root.locator(":is(img, svg, b, i, em, strong, iframe, object, embed, script, code, pre)")).toHaveCount(0);
    const handlers = await root.locator("*").evaluateAll((nodes) =>
      nodes.flatMap((node) => [...node.attributes].map((attr) => attr.name)).filter((name) => name.startsWith("on")));
    expect(handlers).toEqual([]);

    const textOf = (locator) => locator.evaluate((node) => node.textContent);
    for (const n of [1, 2]) {
      const item = card(page, n).locator('[data-pillar-outputs="publications"] > li');
      await expect(item).toHaveCount(1);
      expect(await item.getAttribute("data-key")).toBe(pubKey);
      expect(await textOf(item.locator("a"))).toBe(title);
      expect(await resolvedHref(item.locator("a"))).toBe(`${origin}/publications/?foundational=include#publication-${encodeURIComponent(publication.slug)}`);
      expect(await card(page, n).locator(".pillar-topics li").evaluateAll((nodes) => nodes.map((node) => node.textContent))).toEqual(tags);
    }
    const talkItem = card(page, 4).locator('[data-pillar-outputs="talks"] > li');
    expect(await talkItem.getAttribute("data-key")).toBe(talkKey);
    expect(await textOf(talkItem.locator("a"))).toBe(talk.title);
    // Only the component's own links: 8 archive links and the 4 outputs.
    await expect(root.locator("a")).toHaveCount(12);

    // Selecting still works, and the text shows as typed.
    await toggle(page, 1).click();
    await expectOpen(page, 1);
    await expect(panel(page, 1).getByRole("link", { name: "Bad </script>" })).toBeVisible();
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});
