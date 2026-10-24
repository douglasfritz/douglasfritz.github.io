// Reflow and target size on the six primary pages (spec 14; WCAG 1.4.10,
// 2.5.8) at 320, 375, 768 and 1280 CSS px: no sideways page scrolling, no
// element wider than the screen outside a scrolling container or the map, no
// control whose text is cut off, and pointer targets of at least 24 by 24 px
// (inline links in text excepted). The viewport is set inside each test, so
// the other specs keep the default desktop viewport. With and without
// JavaScript (the no-JavaScript project): the static pages stack differently.
// The rules live in helpers.mjs (layoutProblems).
import { ROUTES, layoutProblems, waitUntilEnhanced } from "./helpers.mjs";
import { expect, readGenerated, test } from "./support.mjs";

const WIDTHS = [320, 375, 768, 1280];

// Pages in a state that shows more: every pillar panel in turn (with
// JavaScript one is open at a time) and the archives filtered to the pillar
// with the longest name, so that a select shows its longest option.
const pillars = JSON.parse(readGenerated("pillars.json"));
const PILLAR = Object.keys(pillars).sort((a, b) => b.length - a.length)[0];
const PILLAR_NUMBER = pillars[PILLAR].number;
const ACCEPTED_CLIPPED = /^select#(publication|talk)-filter-pillar\./;

for (const width of WIDTHS) {
  test.describe(`${width}px wide`, () => {
    for (const route of ROUTES) {
      test(`${route}: no sideways scrolling, nothing too wide, no cut-off control text, targets of 24px or more`, async ({ page }, testInfo) => {
        const enhanced = testInfo.project.use.javaScriptEnabled !== false;
        await page.setViewportSize({ width, height: 900 });
        const states = route === "/publications/" || route === "/talks/" ? ["", `?pillar=${encodeURIComponent(PILLAR)}&foundational=include`] : [""];
        for (const query of states) {
          await page.goto(`${route}${query}`);
          if (enhanced) await waitUntilEnhanced(page, route);
          const panels = enhanced && (route === "/" || route === "/research/") ? [1, 2, 3, 4] : [null];
          for (const n of panels) {
            if (n) await page.locator(`#pillar-${n}-toggle`).click();
            const label = `${route}${query} at ${width}px${n ? `, pillar ${n} open` : ""}`;
            const problems = await layoutProblems(page);
            // The checks saw the page (not an empty or unrendered one).
            expect(problems.checked.elements, label).toBeGreaterThan(20);
            expect(problems.checked.targets, label).toBeGreaterThan(5);
            // Accepted for the first release (controller ruling R44): below
            // 48rem the closed pillar select cannot show the longest pillar
            // names in full. Only that native <select>, only closed and only
            // below 768px: the browser cuts the chosen option's text, while
            // its value (asserted below) and the native picker give it in
            // full. Nothing else may be cut.
            const accepted = problems.clipped.filter((entry) => width < 768 && ACCEPTED_CLIPPED.test(entry));
            const clipped = problems.clipped.filter((entry) => !accepted.includes(entry));
            expect({ overflow: problems.overflow, wide: problems.wide, clipped, small: problems.small }, label)
              .toEqual({ overflow: 0, wide: [], clipped: [], small: [] });
            for (const entry of accepted) {
              const select = page.locator(`#${/^select#([\w-]+)/.exec(entry)[1]}`);
              await expect(select, label).toHaveValue(PILLAR);
              expect(await select.evaluate((node) => node.selectedOptions[0].textContent), label).toBe(`Pillar ${PILLAR_NUMBER}: ${PILLAR}`);
            }
          }
        }
      });
    }
  });
}

// The helper finds what it is meant to find (controls on a real page).
test("the layout checks report a too-wide element, cut-off control text and a small target (control)", { tag: "@js" }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/about/");
  await page.evaluate(() => {
    const main = document.querySelector("main");
    const wide = document.createElement("div");
    wide.id = "control-wide";
    wide.style.width = "700px";
    wide.textContent = "wide";
    const button = document.createElement("button");
    button.id = "control-clipped";
    button.textContent = "A button whose label is far too long for its box";
    Object.assign(button.style, { width: "60px", overflow: "hidden", whiteSpace: "nowrap" });
    const link = document.createElement("a");
    link.id = "control-small";
    link.href = "#";
    link.textContent = "x";
    Object.assign(link.style, { display: "inline-block", width: "10px", height: "10px", overflow: "hidden" });
    main.append(wide, button, link);
  });
  const problems = await layoutProblems(page);
  expect(problems.overflow).toBeGreaterThan(0);
  expect(problems.wide.some((entry) => entry.startsWith("div#control-wide"))).toBe(true);
  expect(problems.clipped.some((entry) => entry.startsWith("button#control-clipped"))).toBe(true);
  expect(problems.small.some((entry) => entry.startsWith("a#control-small"))).toBe(true);
});
