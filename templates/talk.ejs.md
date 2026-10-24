<%
// Talk archive: the filter form that js/archive-filters.js reveals, the reach
// summary, the map region that js/talks-map.js reveals (static markup only:
// the markers come from data/generated/talks.geojson) and one card per record
// in data/generated/talks.yml. The map's two links to the archive heading
// are plain fragment links; the heading has tabindex="-1", so following
// them moves focus there.

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

// The listing sets date-format "YYYY-MM-DD", so item.date is the ISO date
// (Quarto would otherwise reformat it, e.g. as "Sep 14, 2025"). It is shown
// in UK style ("14 Sep 2025") without locale data.
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const talkDate = (item) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(item.date ?? ""));
  const month = match ? Number(match[2]) : 0;
  if (!match || match[1] !== String(item.year) || month < 1 || month > 12) {
    throw new Error(`talk template: talk '${item.key}' needs an ISO date in its year (is date-format "YYYY-MM-DD" set on the listing?)`);
  }
  return { iso: match[0], text: `${Number(match[3])} ${monthNames[month - 1]} ${match[1]}` };
};

// Event scopes in canonical order (template-params, matching R/config.R).
const scopeOrder = (templateParams && templateParams.scopes) || [];
if (scopeOrder.length === 0) throw new Error("talk template: template-params.scopes must list the event scopes");
const scopeLabel = (scope) => {
  const text = String(scope ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const formatLabel = (virtual) => (virtual === "Y" ? "Virtual" : "In person");

// Public links come from this allowlist of fields, in this order. A missing
// or unsafe value renders no anchor.
const linkFields = [["event_url", "Event page"], ["slides_url", "Slides"], ["poster_url", "Poster"], ["recording_url", "Recording"]];
const talkLinks = (item) => linkFields
  .filter(([field]) => isSafeUrl(item[field]))
  .map(([field, label]) => ({ href: item[field], text: item[field].startsWith("mailto:") ? `${label} (email)` : label }));

// Reach summary of every talk, for readers without JavaScript. The script
// recomputes it for the talks shown (summarizeReach and formatReach in
// js/filter-core.js), with the same rules and formatting.
const distinctCount = (field) => new Set(items.map((item) => item[field] ?? "").filter((value) => value !== "")).size;
const talkYears = items.map((item) => Number(item.year)).filter(Number.isFinite);
const firstYear = talkYears.length > 0 ? Math.min(...talkYears) : undefined;
const lastYear = talkYears.length > 0 ? Math.max(...talkYears) : undefined;
const reach = {
  presentations: String(items.length),
  countries: String(distinctCount("location_country")),
  hosts: String(distinctCount("organization")),
  cities: String(distinctCount("location_city")),
  links: String(items.reduce((sum, item) => sum + talkLinks(item).length, 0)),
  years: firstYear === undefined ? "None" : (firstYear === lastYear ? String(firstYear) : `${firstYear}–${lastYear}`)
};

// Filter options from the data present (pillars: all four, so that every
// pillar link is a valid filter).
const years = [...new Set(items.map((item) => String(item.year)))].sort((a, b) => Number(b) - Number(a));
const types = [...new Set(items.map((item) => item.type))].sort();
const presentScopes = new Set(items.map((item) => item.event_scope));
const scopes = [...scopeOrder.filter((scope) => presentScopes.has(scope)), ...[...presentScopes].filter((scope) => !scopeOrder.includes(scope)).sort()];
const formats = ["N", "Y"].filter((value) => items.some((item) => item.virtual_status === value));
%>

```{=html}
<form class="archive-filters" id="talk-filters" role="search" aria-label="Filter talks"
  data-archive-filters data-archive-records="talk-records" data-archive-summary="talk-reach"
  data-archive-noun="talk" data-archive-noun-plural="talks" autocomplete="off" hidden>
  <div class="archive-filter-fields">
    <div class="archive-field archive-field-search">
      <label for="talk-filter-text">Search talks</label>
      <input class="form-control" type="search" id="talk-filter-text" name="text" aria-describedby="talk-filter-help">
    </div>
    <div class="archive-field">
      <label for="talk-filter-pillar">Research pillar</label>
      <select class="form-select" id="talk-filter-pillar" name="pillar">
        <option value="">All pillars</option>
<% pillars.forEach((pillar, index) => { %>
        <option value="<%= esc(pillar) %>">Pillar <%= index + 1 %>: <%= esc(pillar) %></option>
<% }); %>
      </select>
    </div>
    <div class="archive-field">
      <label for="talk-filter-year">Year</label>
      <select class="form-select" id="talk-filter-year" name="year">
        <option value="">All years</option>
<% for (const year of years) { %>
        <option value="<%= esc(year) %>"><%= esc(year) %></option>
<% } %>
      </select>
    </div>
    <div class="archive-field">
      <label for="talk-filter-type">Presentation type</label>
      <select class="form-select" id="talk-filter-type" name="type">
        <option value="">All types</option>
<% for (const type of types) { %>
        <option value="<%= esc(type) %>"><%= esc(type) %></option>
<% } %>
      </select>
    </div>
    <div class="archive-field">
      <label for="talk-filter-scope">Event scope</label>
      <select class="form-select" id="talk-filter-scope" name="scope">
        <option value="">All scopes</option>
<% for (const scope of scopes) { %>
        <option value="<%= esc(scope) %>"><%= esc(scopeLabel(scope)) %></option>
<% } %>
      </select>
    </div>
    <div class="archive-field">
      <label for="talk-filter-virtual">Format</label>
      <select class="form-select" id="talk-filter-virtual" name="virtual">
        <option value="">All formats</option>
<% for (const value of formats) { %>
        <option value="<%= esc(value) %>"><%= esc(formatLabel(value)) %></option>
<% } %>
      </select>
    </div>
  </div>
  <div class="archive-check">
    <input type="checkbox" id="talk-filter-foundational" name="foundational" value="include">
    <label for="talk-filter-foundational">Include foundational work</label>
  </div>
  <p class="archive-help" id="talk-filter-help">Search looks in titles, authors, hosts, locations, presentation types and topic tags. The pillar filter matches a talk's primary or secondary pillar. Foundational work, earlier research that is not central to the current focus, is hidden unless you include it.</p>
  <div class="archive-actions">
    <p class="archive-count" role="status" aria-live="polite" aria-atomic="true" data-archive-count></p>
    <button class="archive-button" type="button" data-archive-reset>Reset filters</button>
  </div>
</form>

<section class="reach-summary" id="talk-reach" aria-labelledby="talk-reach-heading">
  <h2 id="talk-reach-heading">Reach</h2>
  <p class="reach-note">For the talks listed below: documented hosting locations (a virtual talk counts at its host) and public links. These are not audience figures.</p>
  <dl class="reach-figures">
    <div class="reach-figure"><dt>Presentations</dt><dd data-reach="presentations"><%= esc(reach.presentations) %></dd></div>
    <div class="reach-figure"><dt>Countries</dt><dd data-reach="countries"><%= esc(reach.countries) %></dd></div>
    <div class="reach-figure"><dt>Cities</dt><dd data-reach="cities"><%= esc(reach.cities) %></dd></div>
    <div class="reach-figure"><dt>Hosting institutions</dt><dd data-reach="hosts"><%= esc(reach.hosts) %></dd></div>
    <div class="reach-figure"><dt>Public links</dt><dd data-reach="links"><%= esc(reach.links) %></dd></div>
    <div class="reach-figure"><dt>Years</dt><dd data-reach="years"><%= esc(reach.years) %></dd></div>
  </dl>
</section>

<section class="talk-map" id="talk-map" aria-labelledby="talk-map-heading"
  data-talk-map data-talk-map-data="../data/generated/talks.geojson" data-talk-map-records="talk-records" hidden>
  <h2 id="talk-map-heading">Talk locations</h2>
  <p class="talk-map-intro">Each marker is the documented location of an in-person event, or the host's location for a virtual talk. Only talks with a verified location have a marker; every talk is in the list below.</p>
  <p class="talk-map-message" role="status" data-talk-map-message></p>
  <div class="talk-map-body" data-talk-map-body>
    <p class="talk-map-skip"><a href="#talk-archive-heading">Skip map and view talks</a></p>
    <div class="talk-map-canvas" id="talk-map-canvas" role="region" aria-label="Interactive map of talk locations" data-talk-map-canvas data-marker-keys="[]"></div>
    <p class="talk-map-coverage" id="talk-map-coverage" data-talk-map-coverage></p>
    <div class="talk-map-legend">
      <h3 id="talk-map-key-heading">Map key</h3>
      <p class="talk-map-key-note">A marker's number and fill show the talk's primary pillar; its shape shows the format.</p>
      <ul class="talk-map-key" aria-labelledby="talk-map-key-heading">
<% pillars.forEach((pillar, index) => { %>
        <li data-pillar="<%= esc(pillar) %>" data-pillar-number="<%= index + 1 %>"><span class="talk-marker talk-marker-p<%= index + 1 %> talk-marker-in-person" aria-hidden="true"><span class="talk-marker-number"><%= index + 1 %></span></span> Pillar <%= index + 1 %>: <%= esc(pillar) %></li>
<% }); %>
        <li><span class="talk-marker talk-marker-p0 talk-marker-in-person" aria-hidden="true"></span> Circle: an in-person talk, at the event location</li>
        <li><span class="talk-marker talk-marker-p0 talk-marker-virtual" aria-hidden="true"><span class="talk-marker-virtual-tag">V</span></span> Square with a double outline and a “V”: a virtual talk, shown at its host's location</li>
        <li><span class="talk-cluster" aria-hidden="true"><span class="talk-cluster-count">2</span></span> Circle with a count: talks at the same or nearby locations; select it to zoom in or spread them out</li>
      </ul>
    </div>
    <p class="talk-map-tiles">The background map is loaded from OpenStreetMap's tile servers. Map data © OpenStreetMap contributors.</p>
    <p class="talk-map-list"><a href="#talk-archive-heading">View talks as a list</a></p>
  </div>
</section>

<section class="talk-archive" aria-labelledby="talk-archive-heading">
<h2 class="archive-heading" id="talk-archive-heading" tabindex="-1">Talk archive</h2>
<div class="archive-records" id="talk-records">
<% for (const item of items) {
  const primaryNumber = pillarNumber(item.primary_pillar);
  const secondaryNumber = item.secondary_pillar ? pillarNumber(item.secondary_pillar) : undefined;
  const date = talkDate(item);
  const isVirtual = item.virtual_status === "Y";
  const tags = Array.isArray(item.topic_tags) ? item.topic_tags : [];
  const links = talkLinks(item);
  const cardId = `talk-${item.slug}`;
%>
<article class="archive-record talk-card" id="<%= esc(cardId) %>" aria-labelledby="<%= esc(cardId) %>-title"
  data-key="<%= esc(item.key) %>"
  data-date="<%= esc(date.iso) %>"
  data-year="<%= esc(item.year) %>"
  data-type="<%= esc(item.type) %>"
  data-scope="<%= esc(item.event_scope) %>"
  data-virtual="<%= esc(item.virtual_status) %>"
  data-host="<%= esc(item.organization) %>"
  data-city="<%= esc(item.location_city) %>"
  data-country="<%= esc(item.location_country) %>"
  data-primary-pillar="<%= esc(item.primary_pillar) %>"
  data-secondary-pillar="<%= esc(item.secondary_pillar) %>"
  data-foundational="<%= esc(item.foundational_work) %>"
  data-links="<%= links.length %>">
  <p class="record-kicker"><time class="record-date" datetime="<%= esc(date.iso) %>"><%= esc(date.text) %></time></p>
  <h3 class="record-title" id="<%= esc(cardId) %>-title" tabindex="-1" data-search><%= esc(item.title) %></h3>
  <p class="record-authors" data-search><%= esc(item.author) %></p>
<% if (isVirtual) { %>
  <p class="talk-location"><span class="virtual-badge">Virtual</span> — hosted by <span class="talk-host" data-search><%= esc(item.organization) %></span><% if (item.location_display) { %>, <span class="talk-place" data-search><%= esc(item.location_display) %></span><% } %></p>
<% } else { %>
  <p class="talk-host" data-search><%= esc(item.organization) %></p>
<% if (item.location_display) { %>
  <p class="talk-location"><span class="talk-place" data-search><%= esc(item.location_display) %></span></p>
<% } %>
<% } %>
  <dl class="talk-facts">
    <div class="record-detail"><dt>Type</dt><dd class="talk-type" data-search><%= esc(item.type) %></dd></div>
    <div class="record-detail"><dt>Event scope</dt><dd class="talk-scope"><%= esc(scopeLabel(item.event_scope)) %></dd></div>
    <div class="record-detail"><dt>Format</dt><dd class="talk-format"><%= esc(formatLabel(item.virtual_status)) %></dd></div>
  </dl>
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
<% if (links.length > 0) { %>
  <ul class="record-links">
<% for (const link of links) { %>
    <li><a href="<%= esc(link.href) %>"><%= esc(link.text) %></a></li>
<% } %>
  </ul>
<% } %>
</article>
<% } %>
  <p class="archive-empty" data-archive-empty hidden>No talks match these filters. <button class="archive-button" type="button" data-archive-reset>Reset filters</button></p>
</div>
</section>
```
