# Douglas Fritz — research website

A static personal research website built with [Quarto](https://quarto.org), R, and GitHub Pages.
Douglas Fritz is a translational physician-scientist for public health whose work connects
infectious-disease biology, quantitative discovery, clinical translation, and planetary health.

## Requirements

- [Quarto](https://quarto.org/docs/get-started/) on your `PATH` (the site is built and tested with 1.9.38, the
  version the publishing workflow installs). RStudio and Positron each bundle a copy of Quarto; if `quarto` is not
  found in your shell, add the bundled `bin` directory to `PATH`. On macOS, RStudio's copy is used with
  `export PATH="/Applications/RStudio.app/Contents/Resources/app/quarto/bin:$PATH"`.
- R (4.4 or later), to run the tests and the data script, and for `quarto render` itself: the Home,
  Research, About and CV pages run small R chunks at build time (see "Research pillars" and "Home,
  About and CV pages" below), so Quarto must find `Rscript` (on `PATH`, or set `QUARTO_R`). R packages are pinned with
  [renv](https://rstudio.github.io/renv/) in `renv.lock`; R activates the project library
  automatically when started from the repository root. On a new machine, install the pinned
  packages once with `Rscript -e 'renv::restore()'`. To add a package, list it in `DESCRIPTION`,
  then run `renv::install()` and `renv::snapshot()`.
- [Node.js](https://nodejs.org/) 22 or later, for the JavaScript and browser tests (see "Browser tests").

## Publishing and updates

The site is published by the GitHub Actions workflow `.github/workflows/publish.yml`, named
**Refresh website data and publish**. It runs on every push to `main` and when started by hand from
the Actions tab; it never runs on a schedule. It has two jobs, on GitHub's Ubuntu 24.04 runner image:

- **build** can only read the repository and keeps no credentials. It installs Quarto 1.9.38, R (the
  version in `renv.lock`) with the renv packages, Node.js 22 with `npm ci`, and Playwright's
  Chromium; runs `Rscript scripts/build_data.R`, which reads the live public sheet and validates it;
  runs the R tests, the JavaScript unit tests, `quarto render`, the browser tests with
  `E2E_DATA=live`, and `Rscript scripts/verify_generated_public_data.R`, the final check of the
  public output. Only if all of that passed does it keep the tested `_site/` as the run's `site`
  artifact (for 1 day).
- **publish** runs only after build succeeded, and only on `main`. It installs Quarto 1.9.38 (no R
  or Node.js), takes that `_site/` and publishes it, unchanged, to the `gh-pages` branch, which
  GitHub Pages serves (`quarto publish gh-pages --no-render`, which adds a `.nojekyll` file).

Publishing needs every check to pass, so an unreadable sheet, invalid data or any failed test or
check stops the run and **the site already live stays as it is**. Started on another branch, the
workflow builds and tests but does not publish. One run happens at a time: a run started while
another is in progress waits for it (of several waiting runs, only the newest runs). No secret is
needed: the sheet is public, and the push to `gh-pages` uses the repository's own `GITHUB_TOKEN`,
which only the publish job may use to write to the repository.

**Pinned versions.** The runner image (`ubuntu-24.04`), Quarto (`SITE_QUARTO_VERSION` in the
workflow, now 1.9.38) and every action (a full commit SHA, with its release tag in a comment) are
fixed, so a run changes only when the repository does. Change them deliberately, one at a time:
for Quarto, install the new release locally, run the full check below, then change
`SITE_QUARTO_VERSION` (and the version named in this README); for the image, change `runs-on` in
both jobs and `runner` in `tests/testthat/test-workflow-contract.R`; for an action, take the new
release's full commit SHA from its repository and update the tag comment. Then push and watch the
run. The contract test checks that both jobs use the same Quarto release and every action stays
pinned.

### One-time GitHub setup

1. The workflow cannot create the `gh-pages` branch: Quarto refuses to create it during a workflow
   run, and the publish job fails. Before the first push to `main`, create an empty
   `gh-pages` branch and push both branches together:

   ```bash
   git branch gh-pages "$(git commit-tree -m 'Initialise gh-pages branch' "$(git mktree < /dev/null)")"
   git push origin main gh-pages
   ```

   The first command makes a branch with one empty commit and no history, without touching your
   working files. Check that **Settings → General → Default branch** is `main`. If `main` was pushed
   first, its publish job fails: push `gh-pages` (`git push origin gh-pages`), then open the failed run
   and choose **Re-run failed jobs**. That re-runs only the publish job, with the site the build
   already tested (kept for 1 day), and saves the 20-30 minute build. Choose **Re-run all jobs** only
   if more than a day has passed or the build must run again.
2. **Settings → Pages → Build and deployment**: Source **Deploy from a branch**; Branch **`gh-pages`**,
   folder **`/ (root)`**; **Save**. (A `douglasfritz.github.io` repository may otherwise serve `main`.)
3. **Settings → Actions → General**: under "Actions permissions", allow actions from other
   repositories (the default, "Allow all actions and reusable workflows"; the workflow uses
   `actions/*`, `quarto-dev/quarto-actions` and `r-lib/actions`). Under "Workflow permissions", keep
   the default **Read repository contents and packages permissions**: the workflow grants its publish
   job `contents: write` itself.

### Updating the site after editing the sheet

1. Update the Google Sheet. Set `website_include` to exactly `Y` (capital Y, nothing else) for each
   record to publish; any other value keeps it off the site.
2. Open GitHub → the repository → **Actions**.
3. Select **Refresh website data and publish**.
4. Choose **Run workflow**, keep the branch `main`, and confirm with **Run workflow**.
5. Wait for the run to finish green (expect 20-30 minutes, and longer until a first run has
   succeeded, because the package caches are saved only by a successful run), then open
   https://douglasfritz.github.io/ and check the changed record. GitHub Pages can take a few minutes
   more, and the browser may need a refresh.
6. If the run is red, open it and then the step marked with a red cross; its log names the problem.
   **The site already live is unchanged.** Fix the cause and run the workflow again.

A push to `main` (a change to the code or the pages) starts the same run.

### If a run fails

- **Fetch and validate the public sheet data**: `ERROR: CV data validation failed:` lists each bad
  record as `<tab>: <key>: <problem>`, naming the field. Correct that cell in the sheet and run the
  workflow again. A malformed link, for example, must be a full `https://` URL (see "Link URLs").
  `Unable to read CV source` means the sheet could not be fetched: check that it is still shared as
  "Anyone with the link can view", or try again later. `No public publications` or `talks` means no
  row of that tab has `website_include` exactly `Y`.
- **Verify the public output**: lists each problem by file (and record key and field); for example a
  link cell holding an email (`mailto`) link, which the site never shows.
- **Browser tests**: the run keeps a `playwright-report` artifact (HTML report and traces, 7 days) on
  its summary page. A browser test can fail rarely for reasons of timing (one map test has failed
  once in many runs): choose **Re-run all jobs**, and report it if it fails again.
- **Publish to GitHub Pages** (the publish job): `does not have a branch named "gh-pages"` means step 1
  of the one-time setup is missing; a permission error (403) means the workflow could not write to the
  repository. When only the publish job failed, fix the cause and choose **Re-run failed jobs**: it
  re-runs only publish, with the already-tested `site` artifact (kept for 1 day), and saves the 20-30
  minute build. Choose **Re-run all jobs** only if more than a day has passed or the build must run
  again.

### Local equivalents

```bash
Rscript scripts/build_data.R              # live sheet: as the workflow; fails, writing nothing, on bad data
npm run data:fixture                      # or: the synthetic fixtures, offline
Rscript tests/testthat.R                  # R tests
npm run test:unit                         # JavaScript unit tests
quarto render                             # build _site/
npx playwright test                       # browser tests, fixture data
E2E_DATA=live npx playwright test         # browser tests, data built from the live sheet
Rscript scripts/verify_generated_public_data.R   # final check of data/generated/ and _site/
quarto preview                            # look at the site locally
```

`CI=true npx playwright test` runs the browser tests as the workflow does: an HTML report in
`playwright-report/`, no `test.only`, and always a fresh local web server.

The full check, from a fixture or live data build:
`Rscript tests/testthat.R && npm run test:unit && quarto render && npx playwright test && Rscript scripts/verify_generated_public_data.R`
(add `E2E_DATA=live` before `npx playwright test` after a live build). A local run uses the same
commands as the workflow (apart from publishing), but the CI runner differs (Linux fonts, live data,
`CI=true` behaviour), so a failure that happens only in CI is possible: the run's uploaded
`playwright-report` (HTML report and traces) shows why.

Generated, never committed (git-ignored): `data/generated/*` (apart from `.gitkeep`), `_site/`,
`.quarto/`, `node_modules/`, `renv/library/`, `playwright-report/` and `test-results/`. The workflow
recreates them on every run (the R packages from its cache).

**Search engines.** `robots.txt` and `sitemap.xml` are written by Quarto into `_site/` from `site-url`
in `_quarto.yml`; there is no `robots.txt` in the repository. `robots.txt` holds only the line
`Sitemap: https://douglasfritz.github.io/sitemap.xml`, which allows all crawling, and the sitemap
lists the six pages. The verification script checks both, and that no page asks not to be indexed.

### Launch checklist (Douglas's approval)

The copy on the pages is a draft. Before launch, approve or edit:

- [ ] the hero and positioning copy on Home, and the About and CV text;
- [ ] the headshot (`assets/images/headshot.jpg`, a metadata-free web copy) and its alt text;
- [ ] the CV PDF, once a phone-free, email-free copy is ready: save it as
  `assets/documents/Douglas_Fritz_CV.pdf` and set `cv_updated` in `data/site.yml` (see "The CV PDF");
- [ ] the public contact routes: the site lists no email address, only GitHub, ORCID and LinkedIn
  (decided: no public email). Adding one would be a deliberate change to `data/site.yml`'s schema and
  its privacy tests, and the verification script rejects email (`mailto`) links;
- [ ] the interface text added for accessibility: the skip link ("Skip to main content"), the
  no-JavaScript pillar note, the touch-map hint and the zero-talk reach note;
- [ ] the known limitations below;
- [ ] before the first push to `main`: run `Rscript scripts/build_data.R` against the live sheet and
  correct every cell it reports (each error names the record and the field), so that the first
  workflow run does not fail on a typing slip in the sheet;
- [ ] after the first green run: all six pages load at https://douglasfritz.github.io/.

### Known limitations

- The map marks a virtual talk with a "V" (drawn by CSS), not the word "Virtual"; the talk's card and
  map popup say "Virtual". (The design asks for a visible "Virtual" badge.)
- On screens narrower than 48rem (768 px), the archives' closed "Research pillar" select truncates a
  long pillar name (see "Browser tests").
- Without JavaScript, the four pillar buttons stay visible but do nothing; every panel is shown open.
- A pillar's selected outputs can include foundational work (Home's Selected work never does).

## Local commands

Run these from the repository root.

```bash
quarto preview                          # serve the site locally with live reload
quarto render                           # build the site into _site/
Rscript tests/smoke/test_structure.R    # check the project structure (exits 0 on success)
Rscript tests/testthat.R                # run the R data-pipeline tests (offline, fixtures only)
Rscript scripts/build_data.R [--publications P --talks T --output-dir D]
```

`scripts/build_data.R` reads the Publications and Talks tabs of the public CV sheet, normalizes
them, validates them, and writes the public site data. Only rows whose `website_include` is
exactly `Y` are public, and only an explicit allowlist of fields is exported. It exits nonzero,
naming each bad record, if a source cannot be read, a record fails validation, or either tab has
no public rows; in that case no file is written. Gaps that do not block publication, such as a
missing summary or a talk without coordinates, are printed as `WARNING:` lines. Options:

- `--publications P`, `--talks T`: read local CSV files instead of the sheet.
- `--output-dir D`: where generated data goes (default `data/generated`).

```bash
Rscript scripts/build_data.R            # build from the live public sheet (as the publishing workflow does)
Rscript scripts/build_data.R --publications tests/fixtures/journal_articles.csv --talks tests/fixtures/conferences.csv
                                        # offline build from the synthetic fixtures, for local previews
```

Both write five files into `data/generated/`:

| File | Contents |
|---|---|
| `publications.yml` | Public publications, newest first, for the publication listing |
| `talks.yml` | Public talks, newest first, for the talk listing |
| `talks.geojson` | A GeoJSON FeatureCollection of the talks that have coordinates (virtual talks sit at their host) |
| `pillars.json` | Per research pillar: publication and talk counts, record keys, representative records and topic tags |
| `build-metadata.json` | Build time, schema version, source tab names, and source and public row counts |

All five files are prepared before any is written, then replace the previous build together. A
failed build leaves the previous files as they were. Generated data is not committed:
`data/generated/` is git-ignored apart from its `.gitkeep` placeholder. The publishing workflow builds
it from the live sheet, and locally you build it from the fixtures (or the sheet) before previewing.

### Link URLs

Link cells (`doi_url` on Publications; `event_url`, `slides_url`, `poster_url` and `recording_url`
on Talks) are optional, but a nonblank value in a public row (`website_include` exactly `Y`) must be
a well-formed link, because the site publishes it as written. The build checks the text only (no
network request) and stops on a malformed link instead of publishing a broken one. A link is valid
when it is:

- one token: no spaces, tabs, line breaks, control or invisible characters;
- `https://` (lowercase; `http:`, `javascript:`, `data:` and scheme-less values are rejected)
  followed by `host` or `host:port`, then an optional path, `?query` and `#fragment` of any
  non-space characters. There must be no `user:password@` part. The host is a domain name with at
  least two dot-separated labels of 1-63 letters, digits or hyphens (internationalised names are
  fine), no label starting or ending with a hyphen, and a last label that is not all digits, so
  `localhost`, bare names such as `https://example` and IP addresses are rejected. A port, if
  present, is a number from 1 to 65535;
- or a `mailto` link (the scheme `mailto`, a colon, no `//`) to one simple address: a local part of
  letters, digits and `._%+-`, an at sign, then a host that follows the same rules as above, with
  an optional `?query` (for example a subject line).

Rows that are not public (`N` or blank) are not checked. A bad value stops the build and names the
record (its `key`), the field and the value:

```
ERROR: CV data validation failed:
- publications: <key>: doi_url is not a valid URL: "https://doi:10.0000/example.0001"
```

To fix it, edit that cell in the Google Sheet to the full URL, for example write DOIs as
`https://doi.org/10.0000/example.0001` (not `https://doi:10.0000/...`, `doi:10.0000/...` or a bare
`10.0000/...`), or clear the cell if there is no link, then rebuild. A cleared link only produces a
`WARNING:` line.

## Browser code and tests

The archive pages (Publications, Talks & Reach) are plain HTML generated by Quarto listings
(`templates/publication.ejs.md`, `templates/talk.ejs.md`) and work without JavaScript: every public
record is listed, foundational work included. Small ES modules in `js/` add filtering:
`js/filter-core.js` holds the pure filter logic and `js/archive-filters.js` wires it to the page.
The two templates share a block of escaping and URL helpers that must stay byte-identical
(`tests/js/template-helpers.test.mjs` checks this).

Filters are kept in the query string, so a filtered view can be linked, for example
`/publications/?pillar=Climate+and+planetary+health+in+medicine&status=Published` or
`/talks/?pillar=Climate+and+planetary+health+in+medicine&virtual=Y`. The query keys are:

| Key | Page | Values |
|---|---|---|
| `text` | both | free text; every word must appear (case and common accents such as é, ü and ñ are ignored; letters that are not accent-composed, such as ø, ł, đ, ß and æ, are not folded, so "Soren" does not find "Søren") |
| `pillar` | both | a full pillar name; matches the primary or the secondary pillar |
| `status` | publications | `Published`, `In Review` |
| `year` | both | a year present in the data |
| `type` | talks | a presentation type present in the data |
| `scope` | talks | `local`, `regional`, `national`, `international` |
| `virtual` | talks | `Y` (virtual) or `N` (in person) |
| `foundational` | both | `include` shows foundational work, which is otherwise hidden |

`q` is left to Quarto's site search. Unknown keys and unknown values are ignored. With JavaScript,
records whose `foundational_work` is exactly `Y` are hidden until "Include foundational work" is
ticked, and the result count says how many are hidden.

The Talks & Reach page also shows a reach summary: presentations, countries, cities and hosting
institutions (distinct nonempty `location_country`, `location_city` and `organization` values;
a virtual talk counts at its host), public event, slides, poster and recording links, and the years
spanned. It describes the talks currently listed and is recomputed on every filter change; it never
shows audience numbers. A virtual talk is labelled "Virtual — hosted by" its host and location, never
as a visit.

### Talk map

Between the reach summary and the archive, `js/talks-map.js` shows a [Leaflet](https://leafletjs.com)
map of the talks currently listed, with
[Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) for nearby talks. It is an
extra view of the list, never the only way to reach a talk:

- **Data.** Markers come from `data/generated/talks.geojson`, which `_quarto.yml` publishes
  (alone among the generated files) and the page fetches page-relative
  (`../data/generated/talks.geojson`, so `/data/generated/talks.geojson`). Only talks with verified
  coordinates have a marker; a virtual talk sits at its host's location and its marker says
  "Virtual" and "hosted by". Talks without coordinates stay in the list and in every count; the
  map says how many of the listed talks have a map location.
- **Libraries.** Leaflet and Leaflet.markercluster are exact-pinned devDependencies, copied into
  `assets/vendor/` (scripts, CSS, Leaflet's images and both licences) and committed, so the page
  loads no third-party script. After changing either version run `npm ci && npm run vendor:map`
  and commit `assets/vendor/`; `tests/js/vendor-map.test.mjs` checks the copies against the pinned
  packages. Only the Talks page loads them.
- **Tiles.** The background map is loaded from OpenStreetMap's tile servers
  (`https://tile.openstreetmap.org/`), the page's only third-party requests; the map shows the
  "© OpenStreetMap contributors" attribution and a sentence saying where tiles come from.
- **Synchronization.** The map never filters. After every render `js/archive-filters.js`
  dispatches `archive:filtered` on `document` with `detail.keys`, the keys of the records shown.
  Because the archive renders as soon as its module runs and the map loads its data
  asynchronously, the map listens first and then dispatches `archive:request`, which the archive
  answers with its current keys; this works whichever script runs first, including when the page
  is opened with a filter in the URL. If the archive script fails, nothing is hidden, so the map
  shows every card that has a location.
- **Focus.** Selecting a marker (click, Enter or Space) opens its popup and moves focus to the
  talk's card heading. A card's "Show on map" button highlights its marker, opens the popup and
  moves focus into it; Escape closes it and returns focus to the button. Popups list every listed
  talk at that location, with links to the cards. "Skip map and view talks" and "View talks as a
  list" move focus to the archive heading. The page jumps to the card or the map at once, never
  with a smooth scroll. With `prefers-reduced-motion`, nothing on the map animates. On a touch
  screen one finger scrolls the page over the map and two fingers move it.
- **Failures.** If Leaflet, the GeoJSON (an HTTP error or invalid data) or the map markup is
  unavailable, the map region shows one short message and the archive works as before. Failed
  tiles keep the map and add a short note. Without JavaScript the map region stays hidden.
- **Test hook.** `#talk-map[data-map-state]` is `loading`, `ready` or `unavailable`;
  `#talk-map[data-map-reason]` names why the message shows (`data-fetch`, `data-invalid`,
  `library`, `markup`, `script` or `tiles`); and
  `#talk-map-canvas[data-marker-keys]` holds the keys of the markers in the cluster group as a
  sorted JSON array, updated on every sync. The browser tests compare it with the visible cards.

## Research pillars

The Research page and the Home page show the research-pillar component: the umbrella identity,
"Translational physician-scientist for public health", as text (never a fifth pillar, button or
filter value), and the four numbered pillars of `R/config.R` (`site_config$pillars`), each with its
role, the questions it includes, topic tags, public publication and talk counts, up to three
selected outputs and links to the archives filtered to that pillar.

- **Built by R at build time.** `_pillars.qmd` holds one R chunk that calls
  `pillar_component_block()` in `R/pillar_cards.R`; both pages include it with Quarto's `include`
  shortcode. The chunk reads `data/generated/pillars.json`, `publications.yml` and `talks.yml` and
  `data/pillar-copy.yml`, and writes static HTML, so everything is in the page without JavaScript.
  Every value from the data is HTML-escaped (htmltools), and braces and backticks are escaped too,
  because Quarto expands `{{< … >}}` shortcodes even inside raw HTML. Build the data first
  (`npm run data:fixture` or the live build); the render stops with a clear message if it is missing.
- **Copy.** `data/pillar-copy.yml` holds each pillar's `role` and `includes` text, keyed by the exact
  pillar names in canonical order (`tests/testthat/test-pillar-cards.R` checks the keys). The
  current wording is a draft taken from the design specification, to be approved before launch.
- **Counts and links.** Each pillar shows, per kind, how many records have it as their *primary*
  pillar, and links to `/publications/?pillar=<name>&foundational=include` and
  `/talks/?pillar=<name>&foundational=include` (the name URL-encoded as by `encodeURIComponent`).
  The link text states how many records the archive will list: those with the pillar as primary
  *or* secondary, foundational work included (`any`). Quarto rewrites these site-absolute links to
  page-relative ones; the URL they open is the same. Selected outputs link to their archive cards
  (`/publications/?foundational=include#publication-<slug>`, `/talks/?…#talk-<slug>`); an output
  that has the pillar only as its secondary pillar is marked "also tagged (secondary pillar)".
- **Interaction.** `js/pillars.js` (loaded by both pages) closes every panel and makes the four
  buttons work: selecting a pillar (click, tap, Enter or Space) opens its panel and closes the
  others, and selecting it again closes it. Hover and keyboard focus only emphasise a pillar. From
  62rem the four cards surround the umbrella (CSS grid; the DOM order is always umbrella, 1, 2, 3,
  4); narrower screens, and every screen without JavaScript, show stacked cards. Transitions are
  brief and are off when the reader prefers reduced motion. `pillarHref()` builds the same archive
  links as R (`tests/fixtures/pillar_links.json` holds the expected links for both).

`pillars.json` has exactly the four pillars as keys, in canonical order:

```json
{"<pillar name>": {
   "number": 1,
   "publications": {"primary": 1, "any": 2, "keys": ["..."], "representative": ["..."], "representative_secondary": 1},
   "talks":        {"primary": 1, "any": 1, "keys": ["..."], "representative": ["..."], "representative_secondary": 0},
   "topic_tags": ["..."]}}
```

- `keys`: the records with the pillar as primary or secondary, in archive order; `any` is their
  number and `primary` how many of them have it as primary pillar.
- `representative`: up to three keys, those with the pillar as primary first (featured first, then
  newest), then those with it as secondary (newest first). The last `representative_secondary`
  keys are the secondary-pillar records.
- `topic_tags`: up to eight tags of the pillar's publications and talks (primary or secondary),
  the tags on the most records first, ties in alphabetical order ignoring case; `[]` when none.

## Home, About and CV pages

The Home page has a hero (name, headshot, training context and umbrella identity), a positioning
paragraph, two calls to action ("Explore the research", "Browse talks and reach"), the pillar
component, Selected work, a reach summary, and current affiliations with links to the CV and the
profiles. About is a short first-person narrative (current work, direction, affiliations, methods);
CV explains how the CV is kept and offers the approved PDF once there is one. The parts that come
from data are rendered by R at build time (`R/site_summary.R`, called from small chunks in each
page), escaped like the pillar component, and complete without JavaScript.

### `data/site.yml`

One file holds the site's public identity; `read_site_config()` checks it, and the render stops if
it has any other key. **It never holds a phone number or an email address.**

| Key | Contents |
|---|---|
| `name` | "Douglas Fritz" (the Home h1) |
| `umbrella` | the umbrella identity (the same text as the pillar component) |
| `position` | the CV's documented position line (the `Person` `jobTitle`) |
| `training_context` | the current training line in the Home hero |
| `affiliations` | current, documented roles: each a `title` and an optional `organization` |
| `headshot` | `src` (project-relative), `alt` text, and the image's pixel `width` and `height` |
| `profiles` | exactly `github`, `orcid`, `linkedin`, in that order, as `https://` URLs |
| `cv_pdf` | the approved CV's path, `assets/documents/Douglas_Fritz_CV.pdf` |
| `cv_updated` | the PDF's date (`YYYY-MM-DD`), or `~` while there is no PDF |

The positioning paragraph and the About and CV text live in `index.qmd`, `about/index.qmd` and
`cv/index.qmd`. The same profile URLs appear in `_quarto.yml` (navbar icons for GitHub and LinkedIn;
footer links for all three) and in `includes/person-jsonld.html`; `tests/testthat/test-site-content.R`
checks that they all agree.

### Selected work and reach

- **Selected work** shows up to three publications and up to three talks, chosen separately from
  the public generated data (never typed by hand): records with `featured` exactly `Y` first, then
  the rest, each group in archive order (newest first). Foundational work (`foundational_work ==
  "Y"`) is never selected; fewer than three are shown instead. Publications keep their exact status
  and badge (In Review is a dashed outline, never the filled Published badge); a virtual talk reads
  `Virtual — hosted by <host>, <place>`. Each title links to its archive card
  (`/publications/#publication-<slug>`, `/talks/#talk-<slug>`).
- **Reach** reads "Across N countries and M hosting institutions": the distinct, documented
  `location_country` and `organization` values of all public talks, foundational work included (a
  virtual talk counts at its host; missing or blank values are not counted). These are the figures
  the Talks & Reach page shows without JavaScript. It never states an audience size.

### Metadata

Every page has a unique title and description, a canonical link (from `site-url`), Open Graph and
Twitter (summary) metadata, and the favicon `assets/images/favicon.svg`. The Home page's preview
image is the hero headshot (Quarto picks the page's first image); a site-wide social-preview image
is deferred. `includes/person-jsonld.html` adds `Person` structured data (name, URL, headshot,
position line and the three profile URLs; no email or telephone) to the Home and About pages only.
Publications add `ScholarlyArticle` data for published articles only, never for In Review ones.

### The CV PDF

The CV page links the PDF, with its size and "Last updated" date, **only if**
`assets/documents/Douglas_Fritz_CV.pdf` exists when the site is rendered. Otherwise it says that
the CV is generated from the same spreadsheet as this site and shows no link and no date. To publish
the approved PDF:

1. Use a copy without the phone number or an email address (never a PDF straight from `R_CV`).
2. Save it as `assets/documents/Douglas_Fritz_CV.pdf`.
3. Set `cv_updated` in `data/site.yml` to its date, for example `cv_updated: "2026-10-24"`. The
   render stops if the PDF is present without a valid date.
4. Run `quarto render` and the tests.
5. Before committing the PDF, run this in `assets/documents/`:
   `pdftotext Douglas_Fritz_CV.pdf - | grep -Ei '@|\+?[0-9][0-9 ()-]{8,}'`, and check that
   nothing real shows. The ORCID iD and DOIs may match; a phone number or an email address must not.
6. Commit the PDF and `data/site.yml`.

The copy on these pages is a draft, to be approved before launch: see "Launch checklist" under
"Publishing and updates".

## Browser tests

The tests need [Node.js](https://nodejs.org/) 22 or later. Install the pinned tools once:

```bash
npm ci                                  # Playwright, axe-core, http-server, js-yaml, Leaflet (exact versions)
npx playwright install chromium         # the browser Playwright drives
```

Then:

```bash
npm run test:unit                       # filter, map and pillar-link logic, vendored files, no innerHTML (node --test)
npm run data:fixture                    # build data/generated/ from the synthetic fixtures
quarto render                           # build _site/ from that data
npm run test:e2e                        # browser tests against _site/, with and without JavaScript
```

The browser tests read `data/generated/` and check the rendered pages against it, so they work
with fixture or live data. With fixture data they also require the cases they check to be present
(an In Review record, secondary pillars, foundational work, a virtual talk, a talk without
coordinates, two talks at one location, and so on); when testing live data that may lack them, set
`E2E_DATA=live`. The template-escaping tests render small scratch sites with hostile synthetic
records, so `quarto` must be on `PATH` (or set `QUARTO` to its path); the pillar component's
scratch site also runs its R chunk with this repository's renv library. Every browser test serves a
blank image for each OpenStreetMap tile, so the tests never contact the tile servers, and fails on
any script error, console error or failed request it did not cause on purpose. Failing tests are
never retried.

Site-wide checks: `accessibility.spec.mjs` (axe-core on every page and in interactive states, the
skip link, landmarks, the keyboard order and focus ring of every focusable element, link names,
link and request targets, forced colours, reduced motion and the pages without JavaScript),
`responsive.spec.mjs` (320 to 1280 px: no sideways scrolling, no control text cut off apart from
the known limitation below, 24 px targets) and `failure-states.spec.mjs` (empty results and every
map, data and script failure).

Known limitation: on screens narrower than 48rem (768 px) the archives' closed "Research pillar"
select cannot show a long pillar name in full, so the browser truncates the chosen option's text.
The full name is the control's value, read out by assistive technology, and appears in full in the
browser's own option list when the select is opened. The test allows this one case and nothing else.

The skip link (`includes/skip-link.html`) is the first element on every page. Quarto would place
included markup inside `<main>`, and its search index would pick up the link's text, so the link is
not given to Quarto: the project's post-render step, `scripts/post-render.R`, inserts it at the
start of `<body>` after every render, once the search index is written. `js/site.js` (included with
`includes/site-script.html`) makes its target focusable.
