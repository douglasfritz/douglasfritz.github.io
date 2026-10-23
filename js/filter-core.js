// Pure filter state for the archive pages (no DOM access).
//
// A filter state is a plain object keyed by query-string keys; a missing or
// empty value means the facet is inactive. A record is
//   { key, search, primaryPillar, secondaryPillar, status, year, foundational }
// where `search` is the record's searchable text (normalized here, so any
// text will do) and the other fields are the card's data attributes.

// Every key either archive page understands, in canonical query-string order.
// The publication page uses the first four; the talk page adds the rest.
// Free-text search is "text", not "q": Quarto's site search owns "?q=" on
// every page (quarto-search.js highlights it and deletes it from the URL).
export const FILTER_KEYS = Object.freeze(["text", "pillar", "status", "year", "type", "scope", "virtual", "foundational"]);

const allowedKeys = new Set(FILTER_KEYS);

// Trims and collapses runs of whitespace; used for every query value.
function normalizeValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Text for case-insensitive search: compatibility-folded (e.g. the "ﬁ"
// ligature becomes "fi"), lowercased without locale rules, whitespace collapsed.
export function normalizeText(value) {
  return normalizeValue(value).normalize("NFKC").toLowerCase();
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
// case- and whitespace-insensitively) is dropped too, so a stale or mistyped
// link widens the facet to "all" instead of silently hiding every record;
// a match is replaced by the option's canonical spelling.
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
    const match = allowed.find((option) => normalizeText(option) === wanted);
    if (match !== undefined) clean[key] = match;
  }
  return clean;
}

// One predicate per facet; each returns true when its facet is inactive.
// Facets that need a default (for example hiding foundational work unless
// asked) can be added here without changing the callers.
const facetRules = [
  (record, state) => {
    const terms = normalizeText(state.text).split(" ").filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = normalizeText(record.search);
    return terms.every((term) => haystack.includes(term));
  },
  (record, state) => !state.pillar || record.primaryPillar === state.pillar || record.secondaryPillar === state.pillar,
  (record, state) => !state.status || record.status === state.status,
  (record, state) => !state.year || String(record.year) === String(state.year)
];

export function matchesRecord(record, state) {
  return facetRules.every((rule) => rule(record, state));
}
