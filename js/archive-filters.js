// Progressive enhancement for archive pages. The records are ordinary HTML
// that works without JavaScript; this module reveals the (hidden) filter form,
// filters the records in place and keeps the query string in sync.
//
// Markup contract (see templates/publication.ejs.md):
//   form[data-archive-filters]       hidden until enhanced; named controls
//                                    (input or select) whose names are query
//                                    keys; select options list allowed values
//     data-archive-records="<id>"    element holding the records
//     data-archive-noun(-plural)     words for the result count
//     [data-archive-count]           the role="status" result count
//     [data-archive-reset]           reset buttons (also allowed in the empty state)
//   #<id> [data-key]                 one element per record, with data-primary-pillar,
//                                    data-secondary-pillar, data-status, data-year,
//                                    data-foundational; descendants marked
//                                    [data-search] hold its searchable text
//   #<id> [data-archive-empty]       the "no matches" message (hidden)
import { matchesRecord, parseFilterQuery, sanitizeFilterState, serializeFilterQuery } from "./filter-core.js";

function readRecord(element) {
  const { key, primaryPillar, secondaryPillar, status, year, foundational } = element.dataset;
  const search = Array.from(element.querySelectorAll("[data-search]"), (node) => node.textContent).join(" ");
  return { element, key, primaryPillar, secondaryPillar, status, year, foundational, search };
}

// null for free text, otherwise the select's nonempty option values.
function allowedValues(control) {
  if (control.tagName !== "SELECT") return null;
  return Array.from(control.options, (option) => option.value).filter((value) => value !== "");
}

function enhanceArchive(form) {
  const container = document.getElementById(form.dataset.archiveRecords);
  if (!container) return;

  const records = Array.from(container.querySelectorAll("[data-key]"), readRecord);
  const controls = Array.from(form.elements).filter((element) => element.name);
  const options = Object.fromEntries(controls.map((control) => [control.name, allowedValues(control)]));
  const count = form.querySelector("[data-archive-count]");
  const empty = container.querySelector("[data-archive-empty]");
  const singular = form.dataset.archiveNoun || "record";
  const plural = form.dataset.archiveNounPlural || `${singular}s`;

  const currentState = () => sanitizeFilterState(
    Object.fromEntries(controls.map((control) => [control.name, control.value])),
    options
  );

  const writeControls = (state) => {
    for (const control of controls) control.value = state[control.name] ?? "";
  };

  const syncUrl = (state) => {
    const query = serializeFilterQuery(state);
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url !== current) window.history.replaceState(window.history.state, "", url);
  };

  const render = (state) => {
    let visible = 0;
    for (const record of records) {
      const show = matchesRecord(record, state);
      record.element.hidden = !show;
      if (show) visible += 1;
    }
    const text = `Showing ${visible} of ${records.length} ${records.length === 1 ? singular : plural}`;
    // Only touch the live region when the announcement changes.
    if (count && count.textContent !== text) count.textContent = text;
    if (empty) empty.hidden = visible > 0;
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

  const initial = sanitizeFilterState(parseFilterQuery(window.location.search), options);
  writeControls(initial);
  render(initial);
  syncUrl(initial);

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  // Filters apply as the user types; Enter must not reload the page.
  form.addEventListener("submit", (event) => event.preventDefault());
  for (const scope of [form, container]) {
    for (const button of scope.querySelectorAll("[data-archive-reset]")) button.addEventListener("click", reset);
  }

  form.hidden = false;
}

for (const form of document.querySelectorAll("form[data-archive-filters]")) enhanceArchive(form);
