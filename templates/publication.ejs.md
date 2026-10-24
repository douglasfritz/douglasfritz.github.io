<%
// Publication archive: one card per record in data/generated/publications.yml,
// plus the filter form that js/archive-filters.js reveals.

// ==== Shared template helpers: begin ====
// Copied byte-for-byte into every templates/*.ejs.md (Quarto listing
// templates cannot import code); tests/js/template-helpers.test.mjs checks
// that the copies are identical, so edit them together.
//
// Escaping: Quarto compiles listing templates with lodash _.template, where
// the dash tag HTML-escapes and the equals tag inserts text unchanged (the
// reverse of the ejs package). Every spreadsheet-derived value goes through
// esc() and is then inserted with the equals tag, so escaping never depends
// on which tag is used. (No closing tag may appear inside a code block, not
// even in a comment.) esc() also escapes the backtick: the output sits in a
// raw-HTML fence so that pandoc does not read titles as Markdown, and a value
// containing a line of backticks could otherwise close the fence.
const esc = (value) => String(value ?? "").replace(/[&<>"'`]/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[ch]
));

// JSON for a <script type="application/ld+json"> body. Escaping these
// characters keeps the JSON valid and makes "</script>" (or a fence) impossible.
const jsonForScript = (value) => JSON.stringify(value).replace(/[<>&`\u2028\u2029]/g, (ch) => (
  `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
));

// Links are rendered only for https:// or mailto: values without whitespace
// (the R validation already enforces this; this is defence in depth).
const isSafeUrl = (value) => typeof value === "string" && /^(https:\/\/|mailto:)\S+$/.test(value);

// The four research pillars in canonical order (template-params on the
// listing page, matching R/config.R). An unknown pillar stops the render
// rather than showing a wrong number.
const pillars = (templateParams && templateParams.pillars) || [];
if (pillars.length !== 4) throw new Error("listing template: template-params.pillars must list the four research pillars");
const pillarNumber = (name) => {
  const index = pillars.indexOf(name);
  if (index < 0) throw new Error(`listing template: unknown pillar '${name}'`);
  return index + 1;
};
// ==== Shared template helpers: end ====

// preprint_doi is a bare DOI ("10.xxxx/...") or, occasionally, an https URL.
const preprintUrl = (doi) => {
  if (typeof doi !== "string") return undefined;
  if (isSafeUrl(doi) && doi.startsWith("https://")) return doi;
  if (/^10\.\d{4,9}\/\S+$/.test(doi)) return `https://doi.org/${doi.split("/").map(encodeURIComponent).join("/")}`;
  return undefined;
};
const doiPrefix = /^https:\/\/(?:dx\.)?doi\.org\//;
const publisherLinkText = (url) => {
  if (doiPrefix.test(url)) return `DOI ${url.replace(doiPrefix, "")}`;
  return url.startsWith("mailto:") ? `Email ${url.slice("mailto:".length)}` : "Publisher page";
};

// Schema.org metadata only for published work (never for "In Review"), and
// only with fields the data supports. The free-text author list is not a
// valid schema.org author (Person or Organization), so it is left out.
const scholarlyArticle = (item) => {
  const article = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: item.title,
    name: item.title,
    datePublished: String(item.year),
    isPartOf: { "@type": "Periodical", name: item.journal }
  };
  if (isSafeUrl(item.doi_url) && item.doi_url.startsWith("https://")) {
    article.url = item.doi_url;
    article.sameAs = item.doi_url;
  }
  return article;
};

const years = [...new Set(items.map((item) => String(item.year)))].sort((a, b) => Number(b) - Number(a));
const statuses = [...new Set(items.map((item) => item.status))].sort();
%>

```{=html}
<form class="archive-filters" id="publication-filters" role="search" aria-label="Filter publications"
  data-archive-filters data-archive-records="publication-records"
  data-archive-noun="publication" data-archive-noun-plural="publications" autocomplete="off" hidden>
  <div class="archive-filter-fields">
    <div class="archive-field archive-field-search">
      <label for="publication-filter-text">Search publications</label>
      <input class="form-control" type="search" id="publication-filter-text" name="text" aria-describedby="publication-filter-help">
    </div>
    <div class="archive-field">
      <label for="publication-filter-pillar">Research pillar</label>
      <select class="form-select" id="publication-filter-pillar" name="pillar">
        <option value="">All pillars</option>
<% pillars.forEach((pillar, index) => { %>
        <option value="<%= esc(pillar) %>">Pillar <%= index + 1 %>: <%= esc(pillar) %></option>
<% }); %>
      </select>
    </div>
    <div class="archive-field">
      <label for="publication-filter-status">Status</label>
      <select class="form-select" id="publication-filter-status" name="status">
        <option value="">All statuses</option>
<% for (const status of statuses) { %>
        <option value="<%= esc(status) %>"><%= esc(status) %></option>
<% } %>
      </select>
    </div>
    <div class="archive-field">
      <label for="publication-filter-year">Year</label>
      <select class="form-select" id="publication-filter-year" name="year">
        <option value="">All years</option>
<% for (const year of years) { %>
        <option value="<%= esc(year) %>"><%= esc(year) %></option>
<% } %>
      </select>
    </div>
  </div>
  <div class="archive-check">
    <input type="checkbox" id="publication-filter-foundational" name="foundational" value="include">
    <label for="publication-filter-foundational">Include foundational work</label>
  </div>
  <p class="archive-help" id="publication-filter-help">Search looks in titles, authors, journals and topic tags. The pillar filter matches a publication's primary or secondary pillar. Foundational work, earlier research that is not central to the current focus, is hidden unless you include it.</p>
  <div class="archive-actions">
    <p class="archive-count" role="status" aria-live="polite" aria-atomic="true" data-archive-count></p>
    <button class="archive-button" type="button" data-archive-reset>Reset filters</button>
  </div>
</form>

<div class="archive-records" id="publication-records">
<% for (const item of items) {
  const primaryNumber = pillarNumber(item.primary_pillar);
  const secondaryNumber = item.secondary_pillar ? pillarNumber(item.secondary_pillar) : undefined;
  const isPublished = item.status === "Published";
  const tags = Array.isArray(item.topic_tags) ? item.topic_tags : [];
  const doiLink = isSafeUrl(item.doi_url) ? item.doi_url : undefined;
  const preprintLink = preprintUrl(item.preprint_doi);
  const cardId = `publication-${item.slug}`;
%>
<article class="archive-record publication-card" id="<%= esc(cardId) %>" aria-labelledby="<%= esc(cardId) %>-title"
  data-key="<%= esc(item.key) %>"
  data-primary-pillar="<%= esc(item.primary_pillar) %>"
  data-secondary-pillar="<%= esc(item.secondary_pillar) %>"
  data-status="<%= esc(item.status) %>"
  data-year="<%= esc(item.year) %>"
  data-foundational="<%= esc(item.foundational_work) %>">
  <p class="record-kicker">
    <span class="status-badge <%= isPublished ? "status-published" : "status-not-published" %>"><%= esc(item.status) %></span>
    <span class="record-year"><%= esc(item.year) %></span>
  </p>
  <h2 class="record-title" id="<%= esc(cardId) %>-title" data-search><%= esc(item.title) %></h2>
  <p class="record-authors" data-search><%= esc(item.author) %></p>
  <p class="record-venue"><cite data-search><%= esc(item.journal) %></cite><% if (item.volume) { %>, <%= esc(item.volume) %><% } %><% if (item.page_number) { %>, <%= esc(item.page_number) %><% } %></p>
  <dl class="record-details">
    <div class="record-detail">
      <dt>Primary pillar</dt>
      <dd><span class="pillar-badge pillar-<%= primaryNumber %>"><span class="visually-hidden">Pillar </span><%= primaryNumber %></span> <span class="pillar-name"><%= esc(item.primary_pillar) %></span></dd>
    </div>
<% if (secondaryNumber) { %>
    <div class="record-detail">
      <dt>Secondary pillar</dt>
      <dd><span class="pillar-badge pillar-<%= secondaryNumber %>"><span class="visually-hidden">Pillar </span><%= secondaryNumber %></span> <span class="pillar-name"><%= esc(item.secondary_pillar) %></span></dd>
    </div>
<% } %>
<% if (tags.length > 0) { %>
    <div class="record-detail">
      <dt>Topics</dt>
      <dd><ul class="record-tags"><% for (const tag of tags) { %><li data-search><%= esc(tag) %></li><% } %></ul></dd>
    </div>
<% } %>
  </dl>
<% if (doiLink || preprintLink) { %>
  <ul class="record-links">
<% if (doiLink) { %>
    <li><a href="<%= esc(doiLink) %>"><%= esc(publisherLinkText(doiLink)) %></a></li>
<% } %>
<% if (preprintLink) { %>
    <li><a href="<%= esc(preprintLink) %>">Preprint<% if (item.preprint_journal) { %> (<%= esc(item.preprint_journal) %>)<% } %></a></li>
<% } %>
  </ul>
<% } %>
<% if (isPublished) { %>
  <script type="application/ld+json"><%= jsonForScript(scholarlyArticle(item)) %></script>
<% } %>
</article>
<% } %>
  <p class="archive-empty" data-archive-empty hidden>No publications match these filters. <button class="archive-button" type="button" data-archive-reset>Reset filters</button></p>
</div>
```
