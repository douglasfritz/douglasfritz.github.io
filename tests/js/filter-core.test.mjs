import test from "node:test";
import assert from "node:assert/strict";
import {
  FILTER_KEYS,
  matchesRecord,
  normalizeText,
  parseFilterQuery,
  sanitizeFilterState,
  serializeFilterQuery
} from "../../js/filter-core.js";

const P1 = "Infectious-disease biology, evolution and environment";
const P2 = "Quantitative and experimental biomedical discovery";
const P3 = "Clinical translation and health-system improvement";

const record = {
  key: "pub-1",
  search: "dengue viral fitness",
  primaryPillar: P1,
  secondaryPillar: "",
  status: "In Review",
  year: "2026",
  foundational: "N"
};

// Options as the publication page offers them: text is free text, the selects
// accept only their listed values.
const publicationOptions = {
  text: null,
  pillar: [P1, P2, P3],
  status: ["In Review", "Published"],
  year: ["2026", "2025", "2016"]
};

test("combined publication filters require every active facet", () => {
  assert.equal(matchesRecord(record, { text: "fitness", status: "In Review", year: "2026" }), true);
  assert.equal(matchesRecord(record, { text: "fitness", status: "Published", year: "2026" }), false);
  assert.equal(matchesRecord(record, { text: "fitness", status: "In Review", year: "2025" }), false);
  assert.equal(matchesRecord(record, { text: "measles", status: "In Review", year: "2026" }), false);
  assert.equal(matchesRecord(record, { text: "fitness", pillar: P2 }), false);
  assert.equal(matchesRecord(record, { text: "fitness", pillar: P1 }), true);
});

test("an empty state matches every record", () => {
  assert.equal(matchesRecord(record, {}), true);
  assert.equal(matchesRecord(record, { text: "", pillar: "", status: "", year: "" }), true);
});

test("the pillar facet matches the primary or the secondary pillar", () => {
  const multi = { ...record, primaryPillar: P3, secondaryPillar: P2 };
  assert.equal(matchesRecord(multi, { pillar: P3 }), true);
  assert.equal(matchesRecord(multi, { pillar: P2 }), true);
  assert.equal(matchesRecord(multi, { pillar: P1 }), false);
  // A blank or missing secondary pillar matches nothing.
  assert.equal(matchesRecord({ ...record, secondaryPillar: "" }, { pillar: P2 }), false);
  assert.equal(matchesRecord({ ...record, secondaryPillar: undefined }, { pillar: P2 }), false);
});

test("text search is case-insensitive, whitespace-normalized and needs every term", () => {
  const titled = { ...record, search: "A Synthetic  Study of\nExample PATHOGENS  Doe, J. tag-alpha" };
  assert.equal(matchesRecord(titled, { text: "synthetic study" }), true);
  assert.equal(matchesRecord(titled, { text: "  PATHOGENS   synthetic  " }), true);
  assert.equal(matchesRecord(titled, { text: "study of example" }), true);
  assert.equal(matchesRecord(titled, { text: "pathogens measles" }), false);
  assert.equal(matchesRecord(titled, { text: "TAG-ALPHA doe" }), true);
  assert.equal(matchesRecord(titled, { text: "tag-gamma" }), false);
});

test("year matching compares strings and numbers alike", () => {
  assert.equal(matchesRecord({ ...record, year: 2026 }, { year: "2026" }), true);
  assert.equal(matchesRecord(record, { year: 2026 }), true);
  assert.equal(matchesRecord(record, { year: "202" }), false);
});

test("status matching is exact", () => {
  assert.equal(matchesRecord(record, { status: "In Review" }), true);
  assert.equal(matchesRecord(record, { status: "in review" }), false);
  assert.equal(matchesRecord({ ...record, status: "Published" }, { status: "In Review" }), false);
});

test("query state round trips and drops unknown keys", () => {
  const state = parseFilterQuery("?pillar=Infectious-disease%20biology%2C%20evolution%20and%20environment&unknown=x");
  assert.deepEqual(Object.keys(state), ["pillar"]);
  assert.equal(state.pillar, P1);
  assert.equal(parseFilterQuery(`?${serializeFilterQuery(state)}`).pillar, state.pillar);
});

test("parseFilterQuery keeps only allowed, nonempty keys with normalized values", () => {
  assert.deepEqual(parseFilterQuery(""), {});
  assert.deepEqual(parseFilterQuery("?"), {});
  assert.deepEqual(parseFilterQuery("text=&year=%20%20&status=Published"), { status: "Published" });
  assert.deepEqual(parseFilterQuery("?text=%20%20viral%20%20%20fitness%20"), { text: "viral fitness" });
  assert.deepEqual(parseFilterQuery("?text=dengue+fitness"), { text: "dengue fitness" });
  // The first nonempty value of a repeated key wins.
  assert.deepEqual(parseFilterQuery("?year=&year=2025&year=2016"), { year: "2025" });
  // Prototype-like and unknown keys are ignored. "q" belongs to Quarto's site
  // search (it highlights the term and removes it from the URL), so the
  // archives never read it.
  assert.deepEqual(parseFilterQuery("?__proto__=x&constructor=y&TEXT=z&q=site&text=ok"), { text: "ok" });
  // Accepts URLSearchParams as well as strings.
  assert.deepEqual(parseFilterQuery(new URLSearchParams({ status: "In Review", foo: "bar" })), { status: "In Review" });
});

test("all eight archive keys are recognized (publications and talks share the parser)", () => {
  assert.deepEqual(FILTER_KEYS, ["text", "pillar", "status", "year", "type", "scope", "virtual", "foundational"]);
  const query = FILTER_KEYS.map((key) => `${key}=v-${key}`).join("&");
  assert.deepEqual(Object.keys(parseFilterQuery(query)), FILTER_KEYS);
});

test("serializeFilterQuery writes keys in canonical order and omits empty values", () => {
  assert.equal(serializeFilterQuery({}), "");
  assert.equal(serializeFilterQuery({ text: "", year: undefined, status: null }), "");
  assert.equal(
    serializeFilterQuery({ year: "2025", unknown: "x", q: "site search", text: "viral fitness", status: "In Review" }),
    "text=viral+fitness&status=In+Review&year=2025"
  );
});

test("serialized queries round trip awkward text", () => {
  const state = { text: "a&b=c + d, é ü 50% #1 ?x", pillar: P1, status: "In Review", year: "2016" };
  assert.deepEqual(parseFilterQuery(serializeFilterQuery(state)), state);
});

test("sanitizeFilterState keeps only the page's keys and known option values", () => {
  assert.deepEqual(
    sanitizeFilterState({ text: " fitness ", pillar: P2, status: "Published", year: "2016" }, publicationOptions),
    { text: "fitness", pillar: P2, status: "Published", year: "2016" }
  );
  // Keys the page has no control for (talk-only facets) are dropped.
  assert.deepEqual(sanitizeFilterState({ type: "Poster", virtual: "Y", foundational: "show" }, publicationOptions), {});
  // Unknown option values are dropped (the facet falls back to "all"), never
  // kept to hide every record.
  assert.deepEqual(
    sanitizeFilterState({ pillar: "Not a pillar", status: "Retracted", year: "1066", text: "dengue" }, publicationOptions),
    { text: "dengue" }
  );
});

test("sanitizeFilterState maps option values case- and whitespace-insensitively to the canonical value", () => {
  assert.deepEqual(
    sanitizeFilterState({ status: "in  review", pillar: P2.toUpperCase() }, publicationOptions),
    { status: "In Review", pillar: P2 }
  );
});

test("normalizeText lowercases, folds compatibility forms and collapses whitespace", () => {
  assert.equal(normalizeText("  Viral\t\nFITNESS  "), "viral fitness");
  assert.equal(normalizeText("ﬁtness"), "fitness");
  assert.equal(normalizeText(undefined), "");
  assert.equal(normalizeText(2026), "2026");
});
