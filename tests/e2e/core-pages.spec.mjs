// Browser tests for the site shell and the Home, About and CV pages
// (R/site_summary.R, data/site.yml, includes/person-jsonld.html,
// _quarto.yml): titles and metadata, navigation, profile links, the hero,
// Selected work, the reach summary, Person structured data, privacy and the
// conditional CV download. Data-driven: every expectation comes from
// data/generated/ and data/site.yml at test time, so the suite runs on the
// synthetic fixtures (locally) and on the live sheet (CI, E2E_DATA=live).
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { cssString, expect, liveData, readGenerated, renderScratchSite, root as repoRoot, routeScratchSite, test } from "./support.mjs";

const publications = loadYaml(readGenerated("publications.yml"));
const talks = loadYaml(readGenerated("talks.yml"));
const site = loadYaml(readFileSync(path.join(repoRoot, "data", "site.yml"), "utf8"));

const SITE_URL = "https://douglasfritz.github.io/";
const ROUTES = ["/", "/research/", "/publications/", "/talks/", "/about/", "/cv/"];
const NAV = ["Home", "Research", "Publications", "Talks & Reach", "About", "CV"];
const PROFILES = [
  { key: "github", label: "GitHub", url: "https://github.com/douglasfritz" },
  { key: "orcid", label: "ORCID", url: "https://orcid.org/0000-0001-8822-4639" },
  { key: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/in/douglas-fritz" }
];
const PERSON_KEYS = ["@context", "@type", "image", "jobTitle", "name", "sameAs", "url"];
const PERSON_PAGES = ["/", "/about/"];
const JET_BLACK = "rgb(37, 50, 55)";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));

// ---- Reference model, independent of the page and of R/site_summary.R ------

const KINDS = {
  publications: { records: publications, card: "publication" },
  talks: { records: talks, card: "talk" }
};
// Featured ("Y") first, then the rest, each in archive order (newest first);
// foundational work never; at most three.
const selectRecords = (records) => {
  const eligible = records.filter((record) => record.foundational_work !== "Y");
  return [...eligible.filter((record) => record.featured === "Y"), ...eligible.filter((record) => record.featured !== "Y")].slice(0, 3);
};
const distinct = (records, field) => new Set(records.map((record) => String(record[field] ?? "").trim()).filter((value) => value !== "")).size;
const expectedReach = () => ({ presentations: talks.length, countries: distinct(talks, "location_country"), hosts: distinct(talks, "organization") });
const cardHref = (origin, kind, slug) => `${origin}/${kind}/#${KINDS[kind].card}-${encodeURIComponent(slug)}`;
const shortDate = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`;
};
const longDate = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};
const talkLocation = (record) => {
  const place = record.location_display ? `, ${record.location_display}` : "";
  return record.virtual_status === "Y" ? `Virtual — hosted by ${record.organization}${place}` : `${record.organization}${place}`;
};
const sizeText = (bytes) => (bytes < 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(Math.round((bytes / 1024 ** 2) * 10) / 10).toFixed(1)} MB`);

// Generic shapes, never the real values: a phone-like run holds 9 to 15
// digits (ORCID iDs and ISO dates removed first); an email-like string is
// a local part, an at sign and a dotted domain.
const phoneLike = (text) => {
  const cleaned = String(text).replace(/\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  return (cleaned.match(/\+?\(?\d[\d ().-]{5,}\d/g) ?? []).filter((run) => {
    const digits = run.replace(/\D/g, "").length;
    return digits >= 9 && digits <= 15;
  });
};
const emailLike = (text) => String(text).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? [];

// The contact-leak scan covers site-authored content only: the navbar, the
// footer, page titles and metadata, and the pages' own prose. These regions
// hold spreadsheet text instead and are left out: a DOI label, title, author
// or journal can look like a phone number, and a record's link may be a
// mailto: address (spec 16). The R pipeline checks those fields (https:// or
// mailto: only).
const DATA_DERIVED = [
  ".quarto-listing", // the archive listings: cards, filters, reach, map (templates/*.ejs.md)
  "#selected-work", // Home: Selected work (R/site_summary.R)
  "[data-pillar-outputs]", // pillar component: selected outputs (R/pillar_cards.R)
  ".pillar-topics" // pillar component: topic tags
].join(", ");

// What on the current page looks like contact details or the private sheet:
// - in site-authored content only (read with the data-derived regions
//   hidden): phone- or email-like text, email-like link targets or metadata,
//   mailto:/tel: links;
// - anywhere on the page, data-derived regions included: a link to, or the
//   address of, the private source sheet.
const PRIVATE_SHEET = /[^\s"'<>()[\]{},]*docs\.google\.com\/spreadsheets[^\s"'<>()[\]{},]*/g;
async function contactLeaks(page) {
  const seen = await page.evaluate((selectors) => {
    const valueOf = (node) => node.getAttribute("href") ?? node.getAttribute("src") ?? node.getAttribute("content");
    const nodes = [...document.querySelectorAll("[href], [src], meta[content]")];
    const allText = document.documentElement.textContent;
    const hide = document.createElement("style");
    hide.textContent = `${selectors} { display: none !important; }`;
    document.head.append(hide);
    const metadata = [...document.querySelectorAll('meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]')].map((node) => node.getAttribute("content"));
    const text = [document.title, ...metadata, document.body.innerText].join("\n");
    hide.remove();
    return {
      text,
      values: nodes.filter((node) => node.closest(selectors) === null).map(valueOf),
      allValues: nodes.map(valueOf),
      allText
    };
  }, DATA_DERIVED);
  const findings = [
    ...phoneLike(seen.text).map((match) => `phone-like text: ${match}`),
    ...emailLike(seen.text).map((match) => `email-like text: ${match}`),
    ...seen.values.flatMap(emailLike).map((match) => `email-like link or metadata: ${match}`),
    ...seen.values.filter((value) => /^(mailto|tel):/i.test(value)).map((value) => `contact link: ${value}`),
    ...[...new Set([...seen.allValues, seen.allText].flatMap((value) => String(value).match(PRIVATE_SHEET) ?? []))].map((match) => `private sheet: ${match}`)
  ];
  return { findings, text: seen.text };
}

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
const textOf = (locator) => locator.evaluate((node) => node.textContent);
const resolvedHref = (locator) => locator.evaluate((node) => node.href);
const origin = (page) => new URL(page.url()).origin;
const meta = (page, selector) => page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("content") ?? node.getAttribute("href")));

// The figures the Talks page renders for readers without JavaScript (its
// script recomputes them for the default view, which hides foundational work).
async function talksPageReach(browser, baseURL) {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/talks/");
    const figures = {};
    for (const name of ["presentations", "countries", "hosts"]) {
      figures[name] = Number(squash(await page.locator(`#talk-reach [data-reach="${name}"]`).textContent()));
    }
    return figures;
  } finally {
    await context.close();
  }
}

// ---- Data preconditions -----------------------------------------------------

test("the generated data exercises the cases these tests check", () => {
  for (const kind of Object.keys(KINDS)) {
    const selected = selectRecords(KINDS[kind].records);
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.every((record) => record.foundational_work !== "Y")).toBe(true);
  }
  expect(site.profiles).toEqual(Object.fromEntries(PROFILES.map(({ key, url }) => [key, url])));
  expect(Object.keys(site)).not.toContain("email");
  if (liveData) return;
  const kinds = Object.keys(KINDS);
  for (const kind of kinds) expect(selectRecords(KINDS[kind].records).length, kind).toBeGreaterThan(0);
  // Featured work and foundational work in both kinds.
  for (const kind of kinds) {
    expect(KINDS[kind].records.some((record) => record.featured === "Y"), kind).toBe(true);
    expect(KINDS[kind].records.some((record) => record.foundational_work === "Y"), kind).toBe(true);
  }
  // A featured record is selected before a newer one that is not featured.
  expect(kinds.some((kind) => {
    const { records } = KINDS[kind];
    const firstPlain = records.findIndex((record) => record.featured !== "Y" && record.foundational_work !== "Y");
    return records.findIndex((record) => record.key === selectRecords(records)[0].key) > firstPlain;
  })).toBe(true);
  // Foundational work that would otherwise have been selected, so fewer than
  // three are shown.
  expect(kinds.some((kind) => {
    const { records } = KINDS[kind];
    const unfiltered = [...records.filter((r) => r.featured === "Y"), ...records.filter((r) => r.featured !== "Y")].slice(0, 3);
    return unfiltered.some((record) => record.foundational_work === "Y") && selectRecords(records).length < 3;
  })).toBe(true);
  // An In Review publication and a virtual talk among the selected work; at
  // least two hosting countries.
  expect(selectRecords(publications).some((record) => record.status === "In Review")).toBe(true);
  expect(selectRecords(talks).some((record) => record.virtual_status === "Y")).toBe(true);
  expect(expectedReach().countries).toBeGreaterThanOrEqual(2);
});

// ---- Every page -------------------------------------------------------------

test("every page has a unique title and description, a canonical link, social metadata and one h1", async ({ page }) => {
  const titles = [];
  const descriptions = [];
  for (const route of ROUTES) {
    await page.goto(route);
    const title = await page.title();
    expect(title.trim(), route).not.toBe("");
    titles.push(title);
    const [description] = await meta(page, 'meta[name="description"]');
    expect(description?.trim(), route).toBeTruthy();
    descriptions.push(description);
    expect(await meta(page, 'link[rel="canonical"]'), route).toEqual([`${SITE_URL}${route.slice(1)}`]);
    expect((await meta(page, 'meta[property="og:title"]'))[0]?.trim(), route).toBeTruthy();
    expect(await meta(page, 'meta[property="og:description"]'), route).toEqual([description]);
    expect(await meta(page, 'meta[name="twitter:card"]'), route).toEqual(["summary"]);
    // The hero headshot is the Home page's preview image; other pages have none.
    expect(await meta(page, 'meta[property="og:image"]'), route).toEqual(route === "/" ? [`${SITE_URL}${site.headshot.src}`] : []);
    // One h1, and headings never skip a level.
    const levels = await page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((nodes) => nodes.map((node) => Number(node.tagName[1])));
    expect(levels.filter((level) => level === 1), route).toHaveLength(1);
    expect(levels[0], route).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level, `${route} heading ${i}`).toBeLessThanOrEqual(levels[i - 1] + 1);
    });
  }
  expect(new Set(titles).size).toBe(ROUTES.length);
  expect(new Set(descriptions).size).toBe(ROUTES.length);
});

test("the navigation lists the six pages in order and the favicon loads", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator(".navbar-nav.me-auto a.nav-link");
  expect((await nav.allTextContents()).map(squash)).toEqual(NAV);
  const icon = page.locator('link[rel="icon"]');
  await expect(icon).toHaveAttribute("type", "image/svg+xml");
  const href = await icon.evaluate((node) => node.href);
  expect(href).toBe(`${origin(page)}/assets/images/favicon.svg`);
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
});

test("profile links have the right addresses and descriptive names on every page", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    // Navbar icons (GitHub, LinkedIn) and footer text links (all three).
    const navbar = page.locator(".navbar-nav.ms-auto a.nav-link");
    await expect(navbar).toHaveCount(2);
    for (const [i, { label, url }] of PROFILES.filter(({ key }) => key !== "orcid").entries()) {
      await expect(navbar.nth(i)).toHaveAccessibleName(`Douglas Fritz on ${label}`);
      await expect(navbar.nth(i)).toHaveAttribute("href", url);
    }
    const footer = page.locator(".nav-footer a.footer-profile");
    await expect(footer).toHaveCount(3);
    for (const [i, { label, url }] of PROFILES.entries()) {
      await expect(footer.nth(i)).toHaveAccessibleName(`Douglas Fritz on ${label}`);
      await expect(footer.nth(i)).toHaveAttribute("href", url);
      await expect(footer.nth(i)).toHaveText(label);
    }
    // In-page profile lists (Home and About).
    const listed = page.locator("main .profile-links a");
    await expect(listed).toHaveCount(PERSON_PAGES.includes(route) ? 3 : 0);
    for (const [i, { label, url }] of (PERSON_PAGES.includes(route) ? PROFILES : []).entries()) {
      await expect(listed.nth(i)).toHaveAccessibleName(`Douglas Fritz on ${label}`);
      await expect(listed.nth(i)).toHaveAttribute("href", url);
    }
    // External links open normally.
    await expect(page.locator(`a[href^="https://"][target]`)).toHaveCount(0);
  }
});

test("icon links show the site's focus ring when reached by keyboard", { tag: "@js" }, async ({ page }) => {
  await page.goto("/");
  await page.locator(".navbar-nav.me-auto a.nav-link").last().focus();
  for (const { label } of PROFILES.filter(({ key }) => key !== "orcid")) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveAccessibleName(`Douglas Fritz on ${label}`);
    const ring = await focused.evaluate((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return { outline: [style.outlineStyle, style.outlineWidth, style.outlineColor], width: box.width, height: box.height };
    });
    expect(ring.outline).toEqual(["solid", "3px", JET_BLACK]);
    expect(ring.width).toBeGreaterThanOrEqual(24);
    expect(ring.height).toBeGreaterThanOrEqual(24);
  }
});

test("no site-authored content shows or links an email address or a phone number", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const { findings, text } = await contactLeaks(page);
    expect(findings, route).toEqual([]);
    // The scan reads the authored regions: navbar, footer and the page itself.
    for (const authored of [...NAV, "Built with Quarto, R, and GitHub Pages", "GitHub", "ORCID", "LinkedIn"]) {
      expect(text, `${route}: ${authored}`).toContain(authored);
    }
    const heading = route === "/" ? site.training_context : squash(await textOf(page.locator("h1")));
    expect(text, route).toContain(heading);
  }
  // The detectors work: synthetic shapes only.
  expect(phoneLike(`call +99 ${"0".repeat(4)} ${"1".repeat(6)}`)).toHaveLength(1);
  expect(phoneLike("ORCID 0000-0001-8822-4639, 2026-10-24, 800 x 1066")).toEqual([]);
  expect(emailLike(`someone${"@"}example.org`)).toHaveLength(1);
});

test("Person structured data appears on Home and About only, with the approved fields", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const blocks = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((node) => node.textContent));
    const persons = blocks.map((block) => JSON.parse(block)).filter((data) => data["@type"] === "Person");
    expect(persons, route).toHaveLength(PERSON_PAGES.includes(route) ? 1 : 0);
    for (const person of persons) {
      expect(Object.keys(person).sort()).toEqual(PERSON_KEYS);
      expect(person["@context"]).toBe("https://schema.org");
      expect(person.name).toBe(site.name);
      expect(person.url).toBe(SITE_URL);
      expect(person.image).toBe(`${SITE_URL}${site.headshot.src}`);
      expect(person.jobTitle).toBe(site.position);
      expect(person.sameAs).toEqual(PROFILES.map(({ url }) => url));
    }
  }
});

test("no page scrolls sideways on a phone, a tablet or a desktop", async ({ page }) => {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/about/", "/cv/"]) {
      await page.goto(route);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(scrollWidth, `${route} at ${width}px`).toBeLessThanOrEqual(innerWidth);
    }
  }
});

// ---- Home -------------------------------------------------------------------

test("Home states the name, umbrella identity and training context, with two calls to action and the pillars", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(site.name);
  await expect(page.locator(".home-umbrella")).toHaveText(site.umbrella);
  await expect(page.locator(".home-training")).toHaveText(site.training_context);
  expect(squash(await textOf(page.locator(".home-lead"))).length).toBeGreaterThan(80);
  const ctas = page.locator(".home-actions a");
  await expect(ctas).toHaveCount(2);
  await expect(ctas.nth(0)).toHaveAccessibleName("Explore the research");
  await expect(ctas.nth(1)).toHaveAccessibleName("Browse talks and reach");
  expect(await resolvedHref(ctas.nth(0))).toBe(`${origin(page)}/research/`);
  expect(await resolvedHref(ctas.nth(1))).toBe(`${origin(page)}/talks/`);
  for (const cta of [ctas.nth(0), ctas.nth(1)]) {
    const box = await cta.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
  await expect(page.locator("[data-pillar-component] button.pillar-toggle")).toHaveCount(4);
  // Pillars are reached through the Research page, never a hash into a panel.
  await expect(page.locator('a[href*="#pillar-"]')).toHaveCount(0);
  // Sections in the order of spec 6.1.
  const order = await page.evaluate(() => [...document.querySelectorAll(".home-hero, #research-pillars, #selected-work, #home-reach, #home-connect")].map((node) => node.id || node.className));
  expect(order).toEqual(["home-hero", "research-pillars", "selected-work", "home-reach", "home-connect"]);
  // Current affiliations, the CV and profile links close the page.
  const affiliations = (await page.locator("#home-connect .affiliation-list li").allTextContents()).map(squash);
  expect(affiliations).toEqual(site.affiliations.map((entry) => [entry.title, entry.organization].filter(Boolean).join(", ")));
  const cv = page.locator("#home-connect").getByRole("link", { name: "Full CV", exact: true });
  expect(await resolvedHref(cv)).toBe(`${origin(page)}/cv/`);
});

test("the headshot loads, has alt text and keeps its space", async ({ page }) => {
  await page.goto("/");
  const img = page.locator("img.home-headshot");
  await expect(img).toHaveCount(1);
  expect(site.headshot.alt.trim()).not.toBe("");
  await expect(img).toHaveAttribute("alt", site.headshot.alt);
  await expect(img).toHaveAttribute("width", String(site.headshot.width));
  await expect(img).toHaveAttribute("height", String(site.headshot.height));
  await expect.poll(() => img.evaluate((node) => node.complete && node.naturalWidth > 0)).toBe(true);
  const natural = await img.evaluate((node) => {
    // The content box (the image without its border) keeps the image's shape.
    return { width: node.naturalWidth, height: node.naturalHeight, ratio: node.clientHeight / node.clientWidth };
  });
  expect([natural.width, natural.height]).toEqual([site.headshot.width, site.headshot.height]);
  expect(natural.ratio).toBeCloseTo(site.headshot.height / site.headshot.width, 2);
  const response = await page.request.get(await img.evaluate((node) => node.src));
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/jpeg/);
});

test("Selected work matches the reference: featured first, then newest, no foundational work, exact status", async ({ page }) => {
  await page.goto("/");
  for (const kind of Object.keys(KINDS)) {
    const expected = selectRecords(KINDS[kind].records);
    const items = page.locator(`#selected-work [data-selected-kind="${kind}"] li.selected-item`);
    expect(await items.evaluateAll((nodes) => nodes.map((node) => node.dataset.key))).toEqual(expected.map((record) => record.key));
    await expect(page.locator(`#selected-work [data-selected-kind="${kind}"] .selected-none`)).toHaveCount(expected.length === 0 ? 1 : 0);
    for (const [i, record] of expected.entries()) {
      const item = items.nth(i);
      const link = item.locator("a.selected-title");
      expect(await textOf(link)).toBe(record.title);
      expect(await resolvedHref(link)).toBe(cardHref(origin(page), kind, record.slug));
      if (kind === "publications") {
        const badge = item.locator(".status-badge");
        expect(await textOf(badge)).toBe(record.status);
        await expect(badge).toHaveClass(record.status === "Published" ? /\bstatus-published\b/ : /\bstatus-not-published\b/);
        expect(squash(await textOf(item.locator(".selected-meta")))).toBe(record.journal);
      } else {
        await expect(item.locator("time")).toHaveAttribute("datetime", record.date);
        expect(await textOf(item.locator("time"))).toBe(shortDate(record.date));
        expect(squash(await textOf(item.locator(".talk-location")))).toBe(talkLocation(record));
        await expect(item.locator(".virtual-badge")).toHaveCount(record.virtual_status === "Y" ? 1 : 0);
      }
    }
  }
  const foundational = [...publications, ...talks].filter((record) => record.foundational_work === "Y");
  for (const record of foundational) {
    await expect(page.locator(`#selected-work [data-key=${cssString(record.key)}]`)).toHaveCount(0);
  }
});

test("each Selected work link opens its card on the archive page", async ({ page }) => {
  const links = [];
  await page.goto("/");
  for (const kind of Object.keys(KINDS)) {
    for (const record of selectRecords(KINDS[kind].records)) {
      const link = page.locator(`#selected-work [data-selected-kind="${kind}"] li[data-key=${cssString(record.key)}] a.selected-title`);
      links.push({ href: await resolvedHref(link), key: record.key });
    }
  }
  if (!liveData) expect(links.length).toBeGreaterThanOrEqual(2);
  // One archive load per link: the default 30s plus a share per link.
  test.setTimeout(30_000 + 3_000 * links.length);
  for (const { href, key } of links) {
    await page.goto(href);
    // The link's own fragment names a card on the page: the record's card.
    const id = decodeURIComponent(new URL(href).hash.slice(1));
    const card = page.locator(`[id=${cssString(id)}]`);
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/\barchive-record\b/);
    await expect(card).toHaveAttribute("data-key", key);
    await expect(page.locator(":target")).toHaveAttribute("id", id);
  }
});

test("the reach summary counts documented hosting locations and equals the Talks page's figures", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  const reach = page.locator("#home-reach");
  const shown = {};
  for (const name of ["presentations", "countries", "hosts"]) {
    const figure = reach.locator(`[data-reach="${name}"]`);
    shown[name] = (await figure.count()) === 1 ? Number(squash(await textOf(figure))) : 0;
  }
  const expected = expectedReach();
  expect(shown).toEqual(expected);
  expect(shown).toEqual(await talksPageReach(browser, baseURL));
  const line = squash(await textOf(reach.locator(".home-reach-line")));
  if (expected.presentations === 0) {
    expect(line).toBe("No public talks are listed yet.");
  } else {
    const countries = expected.countries > 0 ? `${expected.countries} ${expected.countries === 1 ? "country" : "countries"} and ` : "";
    expect(line).toBe(`Across ${countries}${expected.hosts} hosting ${expected.hosts === 1 ? "institution" : "institutions"}.`);
  }
  await expect(reach).toContainText("These are not audience figures.");
  expect(await resolvedHref(reach.getByRole("link"))).toBe(`${origin(page)}/talks/`);
});

// ---- About ------------------------------------------------------------------

test("About gives the current training, affiliations and methods, and the direction as training", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.locator("h1")).toHaveText("About");
  // (Quarto's script adds an anchor link to each, so compare the text.)
  expect((await page.locator("main h2").allTextContents()).map(squash)).toEqual(["Current work", "Direction", "Current training and affiliations", "Selected methods", "Contact"]);
  const affiliations = (await page.locator("section#current-training-and-affiliations .affiliation-list li").allTextContents()).map(squash);
  expect(affiliations).toEqual(site.affiliations.map((entry) => [entry.title, entry.organization].filter(Boolean).join(", ")));
  await expect(page.locator("section#contact .profile-links a")).toHaveCount(PROFILES.length);
  // The direction is framed as training, not as a role already held.
  await expect(page.locator("section#direction")).toContainText("training");
  expect(await page.locator("section#selected-methods li").count()).toBeGreaterThanOrEqual(3);
});

// ---- CV ---------------------------------------------------------------------

test("the CV page offers the approved PDF, with its size and date, only when it is published", async ({ page }) => {
  const published = existsSync(path.join(repoRoot, "_site", site.cv_pdf));
  // The build reflects the repository: the PDF is published exactly when it exists.
  expect(published).toBe(existsSync(path.join(repoRoot, site.cv_pdf)));
  await page.goto("/cv/");
  await expect(page.locator("h1")).toHaveText("CV");
  const download = page.locator("main .cv-download");
  await expect(download).toHaveCount(1);
  await expect(download).toHaveAttribute("data-cv-pdf", published ? "present" : "absent");
  const pdfLinks = page.locator('main a[href$=".pdf"]');
  const pdfUrl = `${origin(page)}/${site.cv_pdf}`;
  if (published) {
    await expect(pdfLinks).toHaveCount(1);
    expect(await resolvedHref(pdfLinks)).toBe(pdfUrl);
    await expect(pdfLinks).toHaveAttribute("type", "application/pdf");
    const bytes = statSync(path.join(repoRoot, site.cv_pdf)).size;
    expect(squash(await textOf(pdfLinks))).toBe(`Download the CV (PDF, ${sizeText(bytes)})`);
    const response = await page.request.get(pdfUrl);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/pdf/);
    expect(site.cv_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(download.locator("time")).toHaveAttribute("datetime", site.cv_updated);
    expect(squash(await textOf(download.locator(".cv-updated")))).toBe(`Last updated: ${longDate(site.cv_updated)}`);
  } else {
    await expect(pdfLinks).toHaveCount(0);
    await expect(page.locator("main time")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Last updated");
    await expect(download).toContainText("The CV is a PDF generated from the same spreadsheet as this site.");
    expect((await page.request.get(pdfUrl)).status()).toBe(404);
  }
});

// ---- Pillar styling stays scoped to the component -------------------------

test("a js-enhanced class outside the pillar component does not switch on pillar styling", { tag: "@no-js" }, async ({ page }) => {
  await page.goto("/research/");
  const component = page.locator("[data-pillar-component]");
  await expect(component).not.toHaveClass(/\bjs-enhanced\b/);
  await page.evaluate(() => document.body.classList.add("js-enhanced"));
  await expect(component.locator(".pillar-hint")).toBeHidden();
  expect(await component.locator(".pillar-toggle-state").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))).toEqual(["none", "none", "none", "none"]);
  // The component's own class still does.
  await page.evaluate(() => document.querySelector("[data-pillar-component]").classList.add("js-enhanced"));
  await expect(component.locator(".pillar-hint")).toBeVisible();
});

// ---- Contact-leak scan scope (scratch renders, never the real pages) ---------

// Obviously fake values, built here so that no email-like string is written in
// the repository.
const at = "@";
const FAKE = {
  prosePhone: "+00 11111 111111",
  navbarPhone: "+00 22222 222222",
  proseEmail: `prose${at}example.org`,
  footerEmail: `footer${at}example.org`,
  linkEmail: `someone${at}example.org`
};
// Realistic DOI shapes and titles with digits, as spreadsheet data.
const DOIS = ["10.1016/j.cell.2020.04.015", "10.1073/pnas.1912345116", "10.1038/s41586-020-2012-7"];
const DIGIT_TITLE = "Trial 2020-2021 outcomes 1912345116";
const DIGIT_JOURNAL = "Journal 2020 0415 0001";
const DIGIT_HOST = "Example Institute 0000 111222";
const FAKE_SHEET = "https://docs.google.com/spreadsheets/d/FAKE";
const SCRATCH_ORIGIN = "https://scope.example";
const SCRATCH_FILES = [
  "_pillars.qmd", "R/config.R", "R/pillar_cards.R", "R/site_summary.R", "data/site.yml", "data/pillar-copy.yml",
  "includes/person-jsonld.html", "js", "assets/images", "styles"
];
const SCRATCH_OPTIONS = { resources: ["js/*.js", "assets/images/*", "assets/vendor/**", "data/generated/talks.geojson"], theme: "styles/styles.scss", renv: true };
// The canonical pillar names, from the site's own copy file (not the data).
const SCOPE_PILLARS = Object.keys(loadYaml(readFileSync(path.join(repoRoot, "data", "pillar-copy.yml"), "utf8")));

// Fully synthetic public data, independent of data/generated/ (fixture or
// live): its own keys, titles, DOI labels, mailto: links, a link to a fake
// copy of the private sheet, and pillar assignments that put the digit title
// in Home's Selected work, in Pillar 1's outputs and on an archive card.
function scopeData() {
  const publication = (key, year, extra) => ({
    key, slug: key, status: "Published", author: "Doe, J.", year, journal: "Journal of Example Science",
    primary_pillar: SCOPE_PILLARS[0], topic_tags: [], foundational_work: "N", ...extra
  });
  // Archive order: year, newest first.
  const publications = [
    publication("scope-pub-2", 2026, { status: "In Review", title: "Imaginary cohort follow-up", author: `Roe, R.; Ward ${"0".repeat(5)} ${"0".repeat(6)}`, doi_url: `https://doi.org/${DOIS[1]}`, primary_pillar: SCOPE_PILLARS[1] }),
    publication("scope-pub-1", 2025, { title: DIGIT_TITLE, journal: DIGIT_JOURNAL, doi_url: `https://doi.org/${DOIS[0]}`, featured: "Y" }),
    publication("scope-pub-4", 2024, { title: "Correspondence 0000 111 2222", doi_url: `mailto:${FAKE.linkEmail}`, primary_pillar: SCOPE_PILLARS[2] }),
    publication("scope-pub-5", 2023, { title: "Record that links a spreadsheet", doi_url: FAKE_SHEET, primary_pillar: SCOPE_PILLARS[2] }),
    publication("scope-pub-3", 2016, { title: "Foundational imaginary assay", doi_url: `https://doi.org/${DOIS[2]}`, primary_pillar: SCOPE_PILLARS[3], foundational_work: "Y" })
  ];
  const talk = (key, date, extra) => ({
    key, slug: key, author: "Doe, J.", date, year: Number(date.slice(0, 4)), type: "Invited talk",
    presented_by_me: "Y", topic_tags: [], foundational_work: "N", virtual_status: "N", event_scope: "national", ...extra
  });
  const talks = [
    talk("scope-talk-1", "2025-09-14", {
      title: DIGIT_TITLE, organization: "Example University", featured: "Y", primary_pillar: SCOPE_PILLARS[0],
      location_city: "Sampleton", location_country: "Exampleland", location_display: "Sampleton, Exampleland",
      latitude: 12.3456, longitude: 45.6789, slides_url: `mailto:${FAKE.linkEmail}`
    }),
    talk("scope-talk-2", "2024-05-02", {
      title: "Remote seminar on imaginary data", organization: DIGIT_HOST, primary_pillar: SCOPE_PILLARS[1],
      location_country: "Testonia", location_display: "Testonia", virtual_status: "Y"
    })
  ];
  const kind = (records, number) => {
    const keys = records.filter((record) => record.primary_pillar === SCOPE_PILLARS[number - 1]).map((record) => record.key);
    return { primary: keys.length, any: keys.length, keys, representative: keys.slice(0, 3), representative_secondary: 0 };
  };
  const pillars = Object.fromEntries(SCOPE_PILLARS.map((name, i) => [name, {
    number: i + 1, publications: kind(publications, i + 1), talks: kind(talks, i + 1), topic_tags: []
  }]));
  const geojson = {
    type: "FeatureCollection",
    features: talks.filter((record) => record.latitude !== undefined).map((record) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [record.longitude, record.latitude] },
      properties: { key: record.key, title: record.title, organization: record.organization, location: record.location_display, virtual_status: record.virtual_status, primary_pillar: record.primary_pillar, year: record.year }
    }))
  };
  return { "publications.yml": publications, "talks.yml": talks, "pillars.json": pillars, "talks.geojson": geojson };
}

test.describe("contact-leak scan: data-derived text is out of scope", () => {
  let scratch;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    scratch = renderScratchSite(
      "contact-scope-data-",
      ["index.qmd", "research/index.qmd", "publications/index.qmd", "talks/index.qmd", "templates", "assets/vendor", ...SCRATCH_FILES],
      scopeData(),
      SCRATCH_OPTIONS
    );
  });

  test.afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("DOI labels, digit titles and mailto: links in spreadsheet text do not fail the scan; a sheet link does", async ({ page }) => {
    await routeScratchSite(page, scratch, SCRATCH_ORIGIN);
    const shown = {
      "/publications/": [...DOIS.map((doi) => `DOI ${doi}`), DIGIT_TITLE, DIGIT_JOURNAL, `Email ${FAKE.linkEmail}`],
      "/talks/": [DIGIT_TITLE, DIGIT_HOST],
      "/": [DIGIT_TITLE, DIGIT_JOURNAL],
      "/research/": [DIGIT_TITLE]
    };
    for (const [route, strings] of Object.entries(shown)) {
      await page.goto(`${SCRATCH_ORIGIN}${route}`);
      // Open Pillar 1 (its outputs include the digit title) where the script
      // collapses the panels; without JavaScript every panel is open.
      if (route === "/research/" && (await page.locator("[data-pillar-component].js-enhanced").count()) === 1) {
        await page.locator("#pillar-1-toggle").click();
      }
      // The data is on the page, and an unscoped scan would flag it ...
      const body = await page.evaluate(() => document.body.innerText);
      const html = await page.content();
      for (const string of strings) expect(`${body}\n${html}`, `${route}: ${string}`).toContain(string);
      expect(phoneLike(body).length, route).toBeGreaterThan(0);
      // ... but it is spreadsheet text, outside the contact scan. The
      // private-sheet check is global: the publication that links a sheet is
      // reported, from inside the archive listing.
      const { findings } = await contactLeaks(page);
      expect(findings, route).toEqual(route === "/publications/" ? [`private sheet: ${FAKE_SHEET}`] : []);
    }
    // The publication links themselves: the three DOIs, the mailto: one and
    // the sheet link, all inside the data-derived listing.
    await page.goto(`${SCRATCH_ORIGIN}/publications/`);
    for (const doi of DOIS) await expect(page.locator(`.quarto-listing a[href="https://doi.org/${doi}"]`)).toHaveCount(1);
    await expect(page.locator(`.quarto-listing a[href="mailto:${FAKE.linkEmail}"]`)).toHaveCount(1);
    await expect(page.locator(`.quarto-listing a[href="${FAKE_SHEET}"]`)).toHaveCount(1);
    // The digit title is on Home's Selected work and in Pillar 1's outputs.
    await page.goto(`${SCRATCH_ORIGIN}/`);
    await expect(page.locator("#selected-work [data-key=\"scope-pub-1\"]")).toContainText(DIGIT_TITLE);
    await expect(page.locator('#pillar-1-panel [data-pillar-outputs="publications"] [data-key="scope-pub-1"]')).toContainText(DIGIT_TITLE);
  });
});

test.describe("contact-leak scan: site-authored text is in scope", () => {
  let scratch;

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(300_000);
    // The real About page with an extra authored paragraph, and a navbar and
    // footer carrying fake contact details.
    const about = readFileSync(path.join(repoRoot, "about", "index.qmd"), "utf8");
    scratch = renderScratchSite(
      "contact-scope-authored-",
      SCRATCH_FILES,
      {},
      {
        ...SCRATCH_OPTIONS,
        website: [
          "navbar:",
          "  left:",
          "    - href: about/index.qmd",
          `      text: "Call ${FAKE.navbarPhone}"`,
          "page-footer:",
          `  center: "Write to ${FAKE.footerEmail} or [ring](tel:000) us"`
        ],
        write: {
          "about/index.qmd": `${about}\nCall me on ${FAKE.prosePhone}, write to ${FAKE.proseEmail} or [send a message](mailto:${FAKE.linkEmail}). The sheet: ${FAKE_SHEET}/prose\n`
        }
      }
    );
  });

  test.afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test("phone- and email-like text and contact links in prose, navbar or footer fail the scan", async ({ page }) => {
    await routeScratchSite(page, scratch, SCRATCH_ORIGIN);
    await page.goto(`${SCRATCH_ORIGIN}/about/`);
    await expect(page.locator("main")).toContainText("Selected methods");
    const { findings } = await contactLeaks(page);
    expect(findings).toEqual(expect.arrayContaining([
      `phone-like text: ${FAKE.prosePhone}`,
      `phone-like text: ${FAKE.navbarPhone}`,
      `email-like text: ${FAKE.proseEmail}`,
      `email-like text: ${FAKE.footerEmail}`,
      `email-like link or metadata: ${FAKE.linkEmail}`,
      `contact link: mailto:${FAKE.linkEmail}`,
      "contact link: tel:000",
      `private sheet: ${FAKE_SHEET}/prose`
    ]));
  });
});
