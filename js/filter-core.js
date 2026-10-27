// Pure filter state for the archive pages (no DOM access).
//
// A filter state is a plain object keyed by query-string keys; a missing or
// empty value means the facet is inactive. A record is an object built from a
// card's data attributes plus its searchable text, passed once through
// prepareRecord:
//   { key, search, primaryPillar, secondaryPillar, year, foundational,
//     status (publications), type, scope, virtual, country, city, host, links (talks) }

// Every key either archive page understands, in canonical query-string order.
// The publication page uses text, pillar, status, year and foundational; the
// talk page uses all but status.
// Free-text search is "text", not "q": Quarto's site search owns "?q=" on
// every page (quarto-search.js highlights it and deletes it from the URL).
export const FILTER_KEYS = Object.freeze(["text", "pillar", "status", "year", "type", "scope", "virtual", "foundational"]);

// The "foundational" value that reveals foundational work. Without it, records
// whose foundational flag is exactly "Y" are hidden.
export const FOUNDATIONAL_INCLUDE = "include";

const allowedKeys = new Set(FILTER_KEYS);

// Trims and collapses runs of whitespace; used for every query value.
function normalizeValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Text for case- and accent-insensitive search: compatibility-folded (the "ﬁ"
// ligature becomes "fi", full-width letters become ASCII), lowercased without
// locale rules, accents and other combining marks removed ("García" becomes
// "garcia"), whitespace collapsed.
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Reads a query string ("?a=b", "a=b" or URLSearchParams) into a filter state.
// Unknown keys and empty values are dropped; the first nonempty value of a
// repeated key wins. Values are whitespace-normalized but not yet checked
// against the page's options (see sanitizeFilterState).
export function parseFilterQuery(search) {
  const state = {};
  for (const [key, raw] of new URLSearchParams(search)) {
    const value = normalizeValue(raw);
    if (allowedKeys.has(key) && value !== "" && !Object.hasOwn(state, key)) state[key] = value;
  }
  return state;
}

// Writes a filter state as a query string without the leading "?", keys in
// canonical order, empty values and unknown keys omitted.
export function serializeFilterQuery(state) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = normalizeValue(state?.[key]);
    if (value !== "") params.append(key, value);
  }
  return params.toString();
}

// Restricts a state to what a page offers. `options` maps each key the page
// supports to null (free text) or an array of allowed values. Keys the page
// does not support are dropped. A value that matches no option (compared
// case-, accent- and whitespace-insensitively, an exact match first) is
// dropped too, so a stale or mistyped link widens the facet to "all" instead
// of silently hiding every record; a match is replaced by the option's
// canonical spelling.
export function sanitizeFilterState(state, options) {
  const clean = {};
  for (const key of FILTER_KEYS) {
    if (!Object.hasOwn(options, key)) continue;
    const value = normalizeValue(state?.[key]);
    if (value === "") continue;
    const allowed = options[key];
    if (allowed === null) {
      clean[key] = value;
      continue;
    }
    const wanted = normalizeText(value);
    const match = allowed.find((option) => option === value) ?? allowed.find((option) => normalizeText(option) === wanted);
    if (match !== undefined) clean[key] = match;
  }
  return clean;
}

// Returns a copy of `record` whose `search` text is folded with normalizeText,
// so that matching does not refold it on every keystroke.
export function prepareRecord(record) {
  return { ...record, search: normalizeText(record.search) };
}

// One predicate per facet; each returns true when its facet is inactive,
// except the foundational rule, whose default hides foundational work.
const facetRules = [
  (record, state) => {
    const terms = normalizeText(state.text).split(" ").filter(Boolean);
    return terms.every((term) => (record.search ?? "").includes(term));
  },
  (record, state) => !state.pillar || record.primaryPillar === state.pillar || record.secondaryPillar === state.pillar,
  (record, state) => !state.status || record.status === state.status,
  (record, state) => !state.year || String(record.year) === String(state.year),
  (record, state) => !state.type || record.type === state.type,
  (record, state) => !state.scope || record.scope === state.scope,
  (record, state) => !state.virtual || record.virtual === state.virtual,
  (record, state) => state.foundational === FOUNDATIONAL_INCLUDE || record.foundational !== "Y"
];

// True when `record` passes every active facet. It expects a record from
// prepareRecord and a state from sanitizeFilterState (canonical option
// values; exact comparisons for pillar, status, type, scope and virtual).
export function matchesRecord(record, state) {
  return facetRules.every((rule) => rule(record, state));
}

// The records that match, in their original order, and how many foundational
// records match every other facet but are hidden because foundational work is
// not included (the page reports them, so records never vanish silently).
export function filterRecords(records, state) {
  const shown = records.filter((record) => matchesRecord(record, state));
  let hiddenFoundational = 0;
  if (state.foundational !== FOUNDATIONAL_INCLUDE) {
    const revealed = { ...state, foundational: FOUNDATIONAL_INCLUDE };
    hiddenFoundational = records.filter((record) => record.foundational === "Y" && matchesRecord(record, revealed)).length;
  }
  return { shown, hiddenFoundational };
}

// Reach summary (spec 8.3) of the given talk records: documented hosting
// locations and public links only, never audience figures. Countries, cities
// and hosts are distinct nonempty values, compared exactly; virtual talks are
// counted at their host. `links` is each card's number of public links.
export function summarizeReach(records) {
  const distinct = (field) => new Set(records.map((record) => record[field] ?? "").filter((value) => value !== "")).size;
  const years = records.map((record) => Number(record.year)).filter(Number.isFinite);
  return {
    presentations: records.length,
    countries: distinct("country"),
    hosts: distinct("host"),
    cities: distinct("city"),
    links: records.reduce((sum, record) => sum + (Number(record.links) || 0), 0),
    firstYear: years.length > 0 ? Math.min(...years) : undefined,
    lastYear: years.length > 0 ? Math.max(...years) : undefined
  };
}

// Display text for a reach summary. templates/talk.ejs.md formats its no-JS
// summary the same way.
export function formatReach(summary) {
  let years = "None";
  if (summary.firstYear !== undefined) {
    years = summary.firstYear === summary.lastYear ? String(summary.firstYear) : `${summary.firstYear}–${summary.lastYear}`;
  }
  return {
    presentations: String(summary.presentations),
    countries: String(summary.countries),
    hosts: String(summary.hosts),
    cities: String(summary.cities),
    links: String(summary.links),
    years
  };
}
