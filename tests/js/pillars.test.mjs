import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextSelection, pillarHref } from "../../js/pillars.js";
import { FOUNDATIONAL_INCLUDE, parseFilterQuery, sanitizeFilterState } from "../../js/filter-core.js";

const PILLARS = [
  "Infectious-disease biology, evolution and environment",
  "Quantitative and experimental biomedical discovery",
  "Clinical translation and health-system improvement",
  "Climate and planetary health in medicine"
];

// Shared with tests/testthat/test-pillar-cards.R, which checks the build-time
// links (R/pillar_cards.R) against the same expected hrefs.
const linkFixture = JSON.parse(readFileSync(new URL("../fixtures/pillar_links.json", import.meta.url), "utf8"));

test("pillar links use the same query key as archive filters", () => {
  const pillar = "Climate and planetary health in medicine";
  // The archives hide foundational work by default; the link includes it, so
  // that it lists every record with the pillar as primary or secondary.
  assert.equal(pillarHref("/talks/", pillar), `/talks/?pillar=${encodeURIComponent(pillar)}&foundational=include`);
});

test("pillar links parse back to exactly the pillar, with foundational work included", () => {
  const hostile = "A&B = C/D? #1 + 50% (it’s \"x\") <y> !*~_.é中";
  for (const base of ["/publications/", "/talks/"]) {
    for (const pillar of [...PILLARS, hostile]) {
      const url = new URL(pillarHref(base, pillar), "https://example.org");
      assert.equal(url.pathname, base);
      assert.equal(url.hash, "");
      const state = parseFilterQuery(url.search);
      assert.deepEqual(state, { pillar, foundational: FOUNDATIONAL_INCLUDE });
      // The archive keeps both values (its pillar options are the four names).
      const options = { pillar: [...PILLARS, hostile], foundational: [FOUNDATIONAL_INCLUDE] };
      assert.deepEqual(sanitizeFilterState(state, options), state);
    }
  }
});

test("pillarHref builds the same links as R at build time", () => {
  assert.ok(linkFixture.length >= 10);
  for (const pillar of PILLARS) assert.ok(linkFixture.some((row) => row.pillar === pillar), pillar);
  for (const { base, pillar, href } of linkFixture) assert.equal(pillarHref(base, pillar), href);
});

test("selecting a pillar opens it; selecting the open pillar closes it", () => {
  assert.equal(nextSelection(null, "1"), "1");
  assert.equal(nextSelection("1", "3"), "3");
  assert.equal(nextSelection("3", "3"), null);
  assert.equal(nextSelection(null, "4"), "4");
});
