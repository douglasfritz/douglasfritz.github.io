// Talk-archive facets, foundational defaults and the reach summary
// (js/filter-core.js). Records go through prepareRecord, as the page does.
import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNDATIONAL_INCLUDE,
  filterRecords,
  formatReach,
  matchesRecord,
  parseFilterQuery,
  prepareRecord,
  sanitizeFilterState,
  serializeFilterQuery,
  summarizeReach
} from "../../js/filter-core.js";

const P2 = "Quantitative and experimental biomedical discovery";
const P3 = "Clinical translation and health-system improvement";
const P4 = "Climate and planetary health in medicine";

const talk = prepareRecord({
  key: "talk-a",
  search: "Extreme heat in Glasgow  García, M.",
  primaryPillar: P4,
  secondaryPillar: P3,
  year: "2026",
  type: "Invited oral presentation",
  scope: "international",
  virtual: "Y",
  foundational: "N",
  country: "United Kingdom",
  city: "Glasgow",
  host: "Example University",
  links: "2"
});

// Options as the talk page offers them.
const talkOptions = {
  text: null,
  pillar: [P2, P3, P4],
  year: ["2026", "2025"],
  type: ["Invited oral presentation", "Poster"],
  scope: ["local", "regional", "national", "international"],
  virtual: ["N", "Y"],
  foundational: [FOUNDATIONAL_INCLUDE]
};

test("talk facets intersect and foundational defaults off", () => {
  assert.equal(matchesRecord(talk, { pillar: talk.primaryPillar, virtual: "Y", scope: "international" }), true);
  assert.equal(matchesRecord(talk, { pillar: talk.primaryPillar, virtual: "N" }), false);
  assert.equal(matchesRecord(talk, { pillar: P3, year: "2026", type: "Invited oral presentation", scope: "international", virtual: "Y", text: "glasgow" }), true);
  // Each facet alone can exclude the record.
  assert.equal(matchesRecord(talk, { type: "Poster" }), false);
  assert.equal(matchesRecord(talk, { scope: "national" }), false);
  assert.equal(matchesRecord(talk, { year: "2025" }), false);
  assert.equal(matchesRecord(talk, { pillar: P2 }), false);
  assert.equal(matchesRecord(talk, { text: "edinburgh" }), false);
});

test("type, scope and virtual match exactly", () => {
  assert.equal(matchesRecord(talk, { type: "Invited oral presentation" }), true);
  assert.equal(matchesRecord(talk, { type: "invited oral presentation" }), false);
  assert.equal(matchesRecord(talk, { type: "Invited oral" }), false);
  assert.equal(matchesRecord(talk, { scope: "International" }), false);
  assert.equal(matchesRecord(talk, { virtual: "y" }), false);
  assert.equal(matchesRecord({ ...talk, virtual: "N" }, { virtual: "N" }), true);
});

test("only foundational == 'Y' is hidden by default; foundational=include reveals it", () => {
  const foundational = { ...talk, foundational: "Y" };
  assert.equal(matchesRecord(foundational, {}), false);
  assert.equal(matchesRecord(foundational, { foundational: "" }), false);
  assert.equal(matchesRecord(foundational, { foundational: FOUNDATIONAL_INCLUDE }), true);
  assert.equal(matchesRecord(foundational, { foundational: FOUNDATIONAL_INCLUDE, scope: "national" }), false);
  // Anything other than exact "Y" is shown by default.
  for (const value of ["N", "y", "", undefined, "Yes"]) {
    assert.equal(matchesRecord({ ...talk, foundational: value }, {}), true, `foundational ${JSON.stringify(value)}`);
  }
  // Including foundational work never hides the rest.
  assert.equal(matchesRecord(talk, { foundational: FOUNDATIONAL_INCLUDE }), true);
});

test("the foundational query value is sanitized against the checkbox value", () => {
  assert.deepEqual(sanitizeFilterState(parseFilterQuery("?foundational=include"), talkOptions), { foundational: "include" });
  assert.deepEqual(sanitizeFilterState(parseFilterQuery("?foundational=INCLUDE"), talkOptions), { foundational: "include" });
  assert.deepEqual(sanitizeFilterState(parseFilterQuery("?foundational=yes&virtual=maybe&scope=global"), talkOptions), {});
  assert.equal(
    serializeFilterQuery({ foundational: "include", virtual: "Y", scope: "local", type: "Poster", year: "2025", pillar: P4, text: "heat" }),
    "text=heat&pillar=Climate+and+planetary+health+in+medicine&year=2025&type=Poster&scope=local&virtual=Y&foundational=include"
  );
});

test("filterRecords returns the matches in order and counts foundational records hidden by the default", () => {
  const records = [
    talk,
    { ...talk, key: "talk-b", foundational: "Y", year: "2025" },
    { ...talk, key: "talk-c", foundational: "Y", scope: "local" },
    { ...talk, key: "talk-d", virtual: "N" }
  ];
  const keys = (result) => result.shown.map((record) => record.key);

  let result = filterRecords(records, {});
  assert.deepEqual(keys(result), ["talk-a", "talk-d"]);
  assert.equal(result.hiddenFoundational, 2);

  // Only foundational records that match the other facets count as hidden.
  result = filterRecords(records, { scope: "international" });
  assert.deepEqual(keys(result), ["talk-a", "talk-d"]);
  assert.equal(result.hiddenFoundational, 1);

  result = filterRecords(records, { year: "2026", scope: "local" });
  assert.deepEqual(keys(result), []);
  assert.equal(result.hiddenFoundational, 1);

  result = filterRecords(records, { foundational: FOUNDATIONAL_INCLUDE });
  assert.deepEqual(keys(result), ["talk-a", "talk-b", "talk-c", "talk-d"]);
  assert.equal(result.hiddenFoundational, 0);

  result = filterRecords([], {});
  assert.deepEqual(result, { shown: [], hiddenFoundational: 0 });
});

test("summarizeReach counts distinct nonempty places and hosts, links and the year span", () => {
  const records = [
    { country: "United Kingdom", city: "Glasgow", host: "Example University", links: "2", year: "2026" },
    { country: "United Kingdom", city: "", host: "Example University", links: "0", year: "2019" },
    { country: "Testonia", city: "Glasgow", host: "Institute of Tests", links: "1", year: "2024" },
    { country: "", city: undefined, host: "Society of Examples", links: "", year: "2021" }
  ];
  assert.deepEqual(summarizeReach(records), {
    presentations: 4,
    countries: 2,
    hosts: 3,
    cities: 1,
    links: 3,
    firstYear: 2019,
    lastYear: 2026
  });
  assert.deepEqual(summarizeReach([]), {
    presentations: 0, countries: 0, hosts: 0, cities: 0, links: 0, firstYear: undefined, lastYear: undefined
  });
});

test("formatReach writes the figures as display text", () => {
  assert.deepEqual(
    formatReach({ presentations: 12, countries: 3, hosts: 9, cities: 7, links: 4, firstYear: 2015, lastYear: 2026 }),
    { presentations: "12", countries: "3", hosts: "9", cities: "7", links: "4", years: "2015–2026" }
  );
  assert.equal(formatReach({ ...summarizeReach([{ year: "2024", links: "0" }]) }).years, "2024");
  assert.equal(formatReach(summarizeReach([])).years, "None");
});
