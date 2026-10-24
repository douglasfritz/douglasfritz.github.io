// Progressive enhancement for archive pages. The records are ordinary HTML
// that works without JavaScript; this module reveals the (hidden) filter form,
// filters the records in place, keeps the query string in sync and, on the
// talk page, rewrites the reach summary for the records shown.
//
// Markup contract (see templates/publication.ejs.md and templates/talk.ejs.md):
//   form[data-archive-filters]       hidden until enhanced. Named controls
//                                    whose names are query keys: a text input
//                                    is free text, a select allows its nonempty
//                                    option values, a checkbox stands for its
//                                    value when checked (foundational=include)
//     data-archive-records="<id>"    element holding the records
//     data-archive-summary="<id>"    optional reach summary (talk page)
//     data-archive-noun(-plural)     words for the result count
//     [data-archive-count]           the role="status" result count
//     [data-archive-reset]           reset buttons (also allowed in the empty state)
//   #<records> [data-key]            one element per record. Each data-*
//                                    attribute becomes a record field under its
//                                    dataset name (data-primary-pillar ->
//                                    primaryPillar); descendants marked
//                                    [data-search] hold its searchable text
//   #<records> [data-archive-empty]  the "no matches" message (hidden)
//   #<summary> [data-reach=NAME]     a reach figure: presentations, countries,
//                                    hosts, cities, links or years
import {
  filterRecords,
  formatReach,
  parseFilterQuery,
  prepareRecord,
  sanitizeFilterState,
  serializeFilterQuery,
  summarizeReach
} from "./filter-core.js";

// Quarto's listing script (site_libs/quarto-listing) re-runs on every
// hashchange and reads window["quarto-listings"], which Quarto creates only
// for listings with a list.js ".list" element. These archives have none, so
// without an (empty) registry every in-page "#" link would throw.
window["quarto-listings"] ??= {};

// The card's data attributes plus its folded search text (folded once here,
// not on every keystroke).
function readRecord(element) {
  const search = Array.from(element.querySelectorAll("[data-search]"), (node) => node.textContent).join(" ");
  return { ...prepareRecord({ ...element.dataset, search }), element };
}

const isCheckbox = (control) => control.type === "checkbox";

// null for free text, otherwise the values the control can take.
function allowedValues(control) {
  if (control.tagName === "SELECT") return Array.from(control.options, (option) => option.value).filter((value) => value !== "");
  if (isCheckbox(control)) return [control.value];
  return null;
}

const readControl = (control) => {
  if (isCheckbox(control)) return control.checked ? control.value : "";
  return control.value;
};

const writeControl = (control, value) => {
  if (isCheckbox(control)) control.checked = value === control.value;
  else control.value = value ?? "";
};

function enhanceArchive(form) {
  const container = document.getElementById(form.dataset.archiveRecords);
  if (!container) return;

  const records = Array.from(container.querySelectorAll("[data-key]"), readRecord);
  const controls = Array.from(form.elements).filter((element) => element.name);
  const options = Object.fromEntries(controls.map((control) => [control.name, allowedValues(control)]));
  const count = form.querySelector("[data-archive-count]");
  const empty = container.querySelector("[data-archive-empty]");
  const summary = form.dataset.archiveSummary ? document.getElementById(form.dataset.archiveSummary) : null;
  const figures = summary ? Array.from(summary.querySelectorAll("[data-reach]")) : [];
  const singular = form.dataset.archiveNoun || "record";
  const plural = form.dataset.archiveNounPlural || `${singular}s`;
  const noun = (n) => (n === 1 ? singular : plural);

  const currentState = () => sanitizeFilterState(
    Object.fromEntries(controls.map((control) => [control.name, readControl(control)])),
    options
  );

  const writeControls = (state) => {
    for (const control of controls) writeControl(control, state[control.name]);
  };

  // The URL is a convenience: if the browser refuses replaceState (some
  // sandboxed or file: contexts), filtering still works.
  const syncUrl = (state) => {
    const query = serializeFilterQuery(state);
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url === current) return;
    try {
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // Keep the current URL.
    }
  };

  const render = (state) => {
    const { shown, hiddenFoundational } = filterRecords(records, state);
    const visible = new Set(shown);
    for (const record of records) record.element.hidden = !visible.has(record);

    let text = `Showing ${shown.length} of ${records.length} ${noun(records.length)}`;
    if (hiddenFoundational > 0) text += ` (${hiddenFoundational} foundational ${noun(hiddenFoundational)} hidden)`;
    // Only touch the live region when the announcement changes.
    if (count && count.textContent !== text) count.textContent = text;
    if (empty) empty.hidden = shown.length > 0;

    if (figures.length > 0) {
      const reach = formatReach(summarizeReach(shown));
      for (const figure of figures) {
        const value = reach[figure.dataset.reach];
        if (value !== undefined && figure.textContent !== value) figure.textContent = value;
      }
    }
    // Task 6 (map) hooks in here, after the cards and figures are updated:
    //   form.dispatchEvent(new CustomEvent("archive:filtered", { bubbles: true, detail: { state, keys: shown.map((record) => record.key) } }));
  };

  const update = () => {
    const state = currentState();
    render(state);
    syncUrl(state);
  };

  const reset = (event) => {
    writeControls({});
    update();
    // The empty-state button hides itself; move focus somewhere useful.
    if (event.currentTarget.closest("[data-archive-empty]") && controls.length > 0) controls[0].focus();
  };

  // Wire and reveal the controls before the first render, so that the reset
  // buttons work even if something below fails.
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  // Filters apply as the user types; Enter must not reload the page.
  form.addEventListener("submit", (event) => event.preventDefault());
  for (const scope of [form, container]) {
    for (const button of scope.querySelectorAll("[data-archive-reset]")) button.addEventListener("click", reset);
  }
  form.hidden = false;

  const initial = sanitizeFilterState(parseFilterQuery(window.location.search), options);
  writeControls(initial);
  render(initial);
  syncUrl(initial);
}

for (const form of document.querySelectorAll("form[data-archive-filters]")) enhanceArchive(form);
