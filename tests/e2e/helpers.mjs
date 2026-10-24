// Shared helpers for the site-wide accessibility, responsive and
// failure-state tests (accessibility.spec.mjs, responsive.spec.mjs,
// failure-states.spec.mjs). Not a spec file itself. Everything here reads the
// rendered page; nothing depends on particular records, so the helpers work
// on the synthetic fixtures and on the live sheet.
import { createRequire } from "node:module";
import { expect } from "./support.mjs";

const require = createRequire(import.meta.url);

// The six primary pages, in navigation order.
export const ROUTES = ["/", "/research/", "/publications/", "/talks/", "/about/", "/cv/"];

// Waits until a page's scripts have enhanced it (with JavaScript): Quarto's
// search button exists, the pillar component is enhanced, the archive filters
// are shown and the talk map has finished loading (ready or unavailable).
export async function waitUntilEnhanced(page, route) {
  await expect(page.locator("#quarto-search .aa-DetachedSearchButton")).toHaveCount(1);
  await expect(page.locator("#quarto-document-content")).toHaveAttribute("tabindex", "-1");
  if (route === "/" || route === "/research/") await expect(page.locator("[data-pillar-component]")).toHaveClass(/\bjs-enhanced\b/);
  if (route === "/publications/" || route === "/talks/") await expect(page.locator("form[data-archive-filters]")).toBeVisible();
  if (route === "/talks/") await expect(page.locator("#talk-map")).toHaveAttribute("data-map-state", /^(ready|unavailable)$/);
}

// ---- axe-core -----------------------------------------------------------------

export const AXE_PATH = require.resolve("axe-core/axe.min.js");

// WCAG 2.0, 2.1 and 2.2 A and AA, plus axe's best practices.
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// Nodes of third-party widgets the site cannot change, each excluded from one
// rule only. Everything else on the page is checked by every rule.
export const AXE_EXCLUSIONS = [
  {
    // Quarto's search dialog (Algolia Autocomplete, site_libs/quarto-search):
    // with an empty query its input names a not-yet-rendered first option in
    // aria-activedescendant.
    rule: "aria-valid-attr-value",
    selector: ".aa-DetachedOverlay .aa-Input",
    why: "Quarto search dialog: aria-activedescendant names an option before any exists"
  },
  {
    // The same dialog renders each result as an option (role="option")
    // containing the result's link.
    rule: "nested-interactive",
    selector: ".aa-DetachedOverlay .aa-Item",
    why: "Quarto search dialog: each result option contains its link"
  },
  {
    // The dialog's results panel is appended to <body>, outside the page's
    // landmarks.
    rule: "region",
    selector: ".aa-DetachedOverlay, .aa-DetachedOverlay *",
    why: "Quarto search dialog: the overlay is appended to <body>, outside the landmarks"
  }
];

// Every violation axe reports, except the excluded third-party nodes. The
// helper fails on any violation, whatever its impact (stricter than failing
// on serious and critical ones only).
export async function axeViolations(page) {
  if (!(await page.evaluate(() => typeof window.axe === "object"))) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async ({ tags, exclusions }) => {
    const results = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"], elementRef: true });
    const excluded = (rule, node) => exclusions.some((exclusion) => exclusion.rule === rule && node.element?.matches(exclusion.selector));
    return results.violations
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.filter((node) => !excluded(violation.id, node)).map((node) => ({
          target: node.target.join(" "),
          html: node.html.slice(0, 200),
          summary: node.failureSummary
        }))
      }))
      .filter((violation) => violation.nodes.length > 0);
  }, { tags: AXE_TAGS, exclusions: AXE_EXCLUSIONS.map(({ rule, selector }) => ({ rule, selector })) });
}

export async function expectNoAxeViolations(page, label) {
  expect(await axeViolations(page), `axe violations: ${label}`).toEqual([]);
}

// ---- Colour -------------------------------------------------------------------

// Runs in the page: helpers for colour, contrast and naming elements,
// installed once per page as window.__a11y.
export async function installColourHelpers(page) {
  await page.evaluate(() => {
    if (window.__a11y) return;
    const parse = (value) => {
      const match = /rgba?\(([^)]+)\)/.exec(value ?? "");
      if (!match) return null;
      const [r, g, b, a = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1
    });
    // The opaque colour behind `element` (its own background when `own`):
    // backgrounds composited from the element up to the root, over white.
    const background = (element, own) => {
      const layers = [];
      for (let node = own ? element : element.parentElement; node; node = node.parentElement) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (colour && colour.a > 0) layers.push(colour);
        if (colour && colour.a >= 1) break;
      }
      return layers.reverse().reduce((below, layer) => over(layer, below), { r: 255, g: 255, b: 255, a: 1 });
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (a, b) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };
    // A readable label for an element in test messages: tag, id, classes
    // and its aria-label or text.
    const describe = (element) => {
      const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean) : [];
      const text = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes.map((name) => `.${name}`).join("")} "${text}"`;
    };
    // Stable ids, so that the elements Tab visits can be compared with the
    // elements listed beforehand.
    const ids = new WeakMap();
    let next = 1;
    const idOf = (element) => {
      if (!ids.has(element)) ids.set(element, next++);
      return ids.get(element);
    };
    window.__a11y = { parse, background, contrast, describe, idOf };
  });
}

// ---- Keyboard focus -----------------------------------------------------------

// The elements sequential keyboard navigation reaches, in document order
// (the site uses no positive tabindex): enabled, rendered (not display:none,
// visibility:hidden or inert) and tabindex >= 0, each with its id and label.
export async function listTabbables(page) {
  await installColourHelpers(page);
  return page.evaluate(() => {
    const selector = "a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable='true'], [contenteditable='']";
    return [...document.querySelectorAll(selector)]
      .filter((element) => element.tabIndex >= 0 && !element.disabled && !element.closest("[inert]")
        && element.checkVisibility({ visibilityProperty: true }))
      .map((element) => ({ id: window.__a11y.idOf(element), name: window.__a11y.describe(element) }));
  });
}

// Runs in the page: what a sighted keyboard user sees of the focused element.
// - visible: rendered, with a box, and part of it inside the viewport and
//   not covered by anything else (WCAG 2.4.11), sampled at its centre and
//   near its corners;
// - ring: the outline's style, width (px), colour and its contrast with the
//   colour behind it (the element's own background for an inset outline).
function describeFocus() {
  const element = document.activeElement;
  if (!element || element === document.body || element === document.documentElement) return null;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const inset = 2;
  const points = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + inset, rect.top + inset],
    [rect.right - inset, rect.top + inset],
    [rect.left + inset, rect.bottom - inset],
    [rect.right - inset, rect.bottom - inset]
  ].filter(([x, y]) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight);
  const uncovered = points.some(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit) && (hit === element || element.contains(hit));
  });
  const offset = parseFloat(style.outlineOffset) || 0;
  const colour = window.__a11y.parse(style.outlineColor);
  const behind = window.__a11y.background(element, offset < 0);
  return {
    id: window.__a11y.idOf(element),
    name: window.__a11y.describe(element),
    visible: element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && rect.width > 0 && rect.height > 0 && uncovered,
    ring: {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth) || 0,
      colour: style.outlineColor,
      contrast: colour ? Math.round(window.__a11y.contrast(colour, behind) * 100) / 100 : 0
    }
  };
}

// The focused element's description (null when focus is on the page itself).
export async function focusedElement(page) {
  await installColourHelpers(page);
  return page.evaluate(describeFocus);
}

// The focus ring the site requires: an opaque outline of at least 2px
// (the site's is 3px solid Jet Black) with 3:1 contrast against what is
// behind it (WCAG 2.4.7, 2.4.11, 1.4.11).
export function expectVisibleFocus(focus, label) {
  expect(focus, `${label}: something has focus`).not.toBeNull();
  expect(focus.visible, `${label}: ${focus.name} is visible, in view and not covered`).toBe(true);
  expect(focus.ring.style, `${label}: ${focus.name} has an outline`).not.toBe("none");
  expect(focus.ring.width, `${label}: ${focus.name} outline width`).toBeGreaterThanOrEqual(2);
  expect(focus.ring.contrast, `${label}: ${focus.name} outline contrast (${focus.ring.colour})`).toBeGreaterThanOrEqual(3);
}

// Presses Tab from the current focus until focus leaves the page or comes
// back to the first element visited (the browser wraps), checking the focus
// ring of every element on the way. Fails if Tab is still inside the page
// after `limit` presses (a keyboard trap). Returns the visited elements.
export async function crawlTabOrder(page, { limit, label }) {
  await installColourHelpers(page);
  const visited = [];
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    // Scrolling into view and the navbar's show/hide can take a moment.
    let focus = null;
    await expect.poll(async () => {
      focus = await page.evaluate(describeFocus);
      return focus === null || focus.visible;
    }, { message: `${label}: Tab ${step + 1} shows the focused element`, timeout: 3000 }).toBe(true);
    if (focus === null || (visited.length > 0 && focus.id === visited[0].id)) return visited;
    expectVisibleFocus(focus, `${label}, Tab ${step + 1}`);
    visited.push(focus);
  }
  throw new Error(`${label}: focus was still inside the page after ${limit} presses of Tab (keyboard trap?): last ${visited.at(-1)?.name}`);
}

// ---- Layout -------------------------------------------------------------------

// Runs in the page: layout problems at the current viewport width.
// - overflow: how far the page scrolls sideways (0 is none);
// - wide: rendered elements that extend past either side of the viewport,
//   except inside a scrolling container (overflow auto or scroll) or a
//   Leaflet map (whose panes are larger than the map by design and clipped);
// - clipped: controls whose own text is cut off: buttons, labels, inputs and
//   selects whose content is wider than their box, without wrapping;
// - small: pointer targets under 24 by 24 CSS px (WCAG 2.5.8), except
//   inline links in a sentence or line of text (the exception in 2.5.8 for
//   targets whose size is set by the line height of the text around them)
//   and the skip link while it is hidden.
export function layoutProblems(page) {
  return page.evaluate(() => {
    const describe = (element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${typeof element.className === "string" && element.className.trim() ? `.${element.className.trim().split(/\s+/).join(".")}` : ""} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50)}"`;
    const width = window.innerWidth;
    const rendered = (element) => element.checkVisibility({ visibilityProperty: true });
    const visuallyHidden = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (rect.width <= 1 && rect.height <= 1) || (style.clip !== "auto" && style.position === "absolute");
    };
    const contained = (element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (node.classList.contains("leaflet-container")) return true;
        if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowX)) return true;
        if (visuallyHidden(node)) return true;
      }
      return false;
    };
    const all = [...document.body.querySelectorAll("*")].filter(rendered);
    const wide = all.filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      return (rect.right > width + 1 || rect.left < -1) && !visuallyHidden(element) && !contained(element);
    }).map(describe);

    // Text that does not fit its control: wider content than box, and not
    // allowed to show (overflow other than visible, or a native control).
    const measure = document.createElement("canvas").getContext("2d");
    const clipped = all.filter((element) => element.matches("button, label, input:not([type='checkbox']):not([type='radio']):not([type='hidden']), select, .btn")).filter((element) => {
      const style = getComputedStyle(element);
      if (element.tagName === "SELECT") {
        measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = element.selectedOptions[0]?.textContent ?? "";
        const room = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return measure.measureText(text).width > room + 1;
      }
      const native = element.tagName === "INPUT";
      return element.scrollWidth > element.clientWidth + 1 && (native || style.overflowX !== "visible");
    }).map(describe);

    // Pointer targets.
    const targets = all.filter((element) => element.matches("a[href], button, input:not([type='hidden']), select, textarea, summary, [role='button'], [tabindex='0']"));
    const inlineInText = (element) => {
      if (getComputedStyle(element).display !== "inline") return false;
      let block = element.parentElement;
      while (block && getComputedStyle(block).display === "inline") block = block.parentElement;
      const own = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      const around = (block?.textContent ?? "").replace(/\s+/g, " ").trim();
      return around.length > own.length;
    };
    const small = targets.filter((element) => {
      if (visuallyHidden(element) || inlineInText(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width < 24 || rect.height < 24;
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      return `${describe(element)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    });
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, wide, clipped, small, checked: { elements: all.length, controls: all.filter((element) => element.matches("button, label, input, select")).length, targets: targets.length } };
  });
}
