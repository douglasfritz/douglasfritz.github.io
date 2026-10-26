# The final check of the public output, scripts/verify_generated_public_data.R,
# run over small synthetic roots in temporary directories: data/generated/,
# _site/ and includes/skip-link.html. Every record here is invented.

verify <- new.env()
sys.source(testthat::test_path("..", "..", "scripts", "verify_generated_public_data.R"), envir = verify)
skip_link_file <- testthat::test_path("..", "..", "includes", "skip-link.html")
skip_link_markup <- read_skip_link(skip_link_file)

synthetic_publications <- function() list(
  list(
    key = "pub-a", status = "Published", year = 2025L,
    # Contact-like text that is not contact data: it must pass.
    title = "Tel: a synthetic title that starts like a contact line",
    doi_url = "https://doi.org/10.1073/pnas.1912345116", preprint_doi = "10.1073/pnas.1912345116",
    plain_summary = "A fictional study of telephone follow-up.",
    topic_tags = list("tag-a"), slug = "pub-a"
  ),
  list(key = "pub-b", status = "In Review", year = 2026L, title = "A second synthetic publication", topic_tags = list(), slug = "pub-b")
)

synthetic_talks <- function() list(
  list(
    key = "talk-a", title = "A synthetic talk", date = "2025-01-02", latitude = 10.5, longitude = 20.25,
    slides_url = "https://docs.google.com/presentation/d/FAKE/edit", topic_tags = list("tag-a"), slug = "talk-a"
  ),
  list(key = "talk-b", title = "Tel: another synthetic talk", date = "2024-03-04", topic_tags = list(), slug = "talk-b")
)

synthetic_geojson <- function() list(
  type = "FeatureCollection",
  features = list(list(
    type = "Feature",
    geometry = list(type = "Point", coordinates = c(20.25, 10.5)),
    properties = list(key = "talk-a", title = "A synthetic talk")
  ))
)

synthetic_pillars <- function() {
  stats::setNames(lapply(seq_along(site_config$pillars), function(i) list(number = i)), site_config$pillars)
}

synthetic_metadata <- function(publications = 2L, talks = 2L) list(
  inclusion_rule = "website_include == 'Y'",
  public_rows = list(publications = publications, talks = talks)
)

write_file <- function(root, path, text) {
  target <- file.path(root, path)
  dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
  writeBin(charToRaw(enc2utf8(text)), target)
}
read_file <- function(root, path) rawToChar(readBin(file.path(root, path), "raw", file.size(file.path(root, path))))
write_json <- function(root, path, x) write_file(root, path, jsonlite::toJSON(x, auto_unbox = TRUE, digits = NA, pretty = TRUE))
write_yaml <- function(root, path, x) write_file(root, path, yaml::as.yaml(x))
# Replaces the one occurrence of `old` in a file.
edit_file <- function(root, path, old, new) {
  text <- read_file(root, path)
  stopifnot(grepl(old, text, fixed = TRUE))
  write_file(root, path, sub(old, new, text, fixed = TRUE))
}

page_html <- function(title) {
  paste0(
    "<!DOCTYPE html>\n<html lang=\"en\"><head><title>", title, "</title></head>\n<body>\n", skip_link_markup, "\n",
    "<main id=\"quarto-document-content\"><h1>", title, "</h1>\n",
    "<p>DOI 10.1073/pnas.1912345116. Tel: a synthetic title.</p>\n",
    "<a href=\"https://docs.google.com/presentation/d/FAKE/edit\">Slides</a>\n</main>\n</body></html>\n"
  )
}

# A complete, valid synthetic root; returns its path.
synthetic_root <- function(env = parent.frame()) {
  root <- withr::local_tempdir(.local_envir = env)
  write_yaml(root, "data/generated/publications.yml", synthetic_publications())
  write_yaml(root, "data/generated/talks.yml", synthetic_talks())
  write_json(root, "data/generated/talks.geojson", synthetic_geojson())
  write_json(root, "data/generated/pillars.json", synthetic_pillars())
  write_json(root, "data/generated/build-metadata.json", synthetic_metadata())
  write_file(root, "includes/skip-link.html", paste0(skip_link_markup, "\n"))
  for (route in verify$routes) write_file(root, file.path("_site", route), page_html(route))
  write_file(root, "_site/search.json", "[{\"title\": \"Home\", \"text\": \"telephone follow-up\"}]\n")
  write_file(root, "_site/js/app.js", "export const answer = 42;\n")
  writeBin(as.raw(c(0x89, 0x50, 0x4e, 0x47, 0x00, 0x00)), file.path(root, "_site", "js", "pixel.png"))
  write_file(root, "_site/robots.txt", "Sitemap: https://douglasfritz.github.io/sitemap.xml\n")
  write_file(root, "_site/sitemap.xml", paste0(
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset>\n",
    paste0("<url><loc>https://douglasfritz.github.io/", verify$routes, "</loc></url>\n", collapse = ""),
    "</urlset>\n"
  ))
  root
}

issues_of <- function(root) verify$public_output_issues(root)$issues

test_that("a valid root passes, including contact-like text that is not contact data", {
  root <- synthetic_root()
  expect_identical(issues_of(root), character())
  output <- capture.output(ok <- verify$verify_public_output(root))
  expect_true(ok)
  expect_match(output[[1]], "Public output verified: 2 publications, 2 talks (1 on the map), 4 pillars", fixed = TRUE)
})

# Each mutation is applied to a fresh valid root; the issues must include the
# expected message, naming the file (and the record key and field).
mutations <- list(
  "cv_include in a page" = list(
    function(root) edit_file(root, "_site/about/index.html", "</main>", "<!-- cv_include --></main>"),
    "_site/about/index.html: contains the string 'cv_include'"),
  "cv_include in generated data" = list(
    function(root) edit_file(root, "data/generated/talks.yml", "title: A synthetic talk", "title: A synthetic talk cv_include"),
    "data/generated/talks.yml: contains the string 'cv_include'"),
  "a field named phone" = list(
    function(root) { t <- synthetic_talks(); t[[1]]$phone <- "SECRET-VALUE"; write_yaml(root, "data/generated/talks.yml", t) },
    "data/generated/talks.yml: record 'talk-a' has a field named 'phone'"),
  "a field named email" = list(
    function(root) { p <- synthetic_publications(); p[[2]]$email <- "SECRET-VALUE"; write_yaml(root, "data/generated/publications.yml", p) },
    "data/generated/publications.yml: record 'pub-b' has a field named 'email'"),
  "a field named markdown" = list(
    function(root) { p <- synthetic_publications(); p[[1]]$markdown <- "SECRET-VALUE"; write_yaml(root, "data/generated/publications.yml", p) },
    "data/generated/publications.yml: record 'pub-a' has a field named 'markdown'"),
  "a field named website_include" = list(
    function(root) { t <- synthetic_talks(); t[[2]]$website_include <- "Y"; write_yaml(root, "data/generated/talks.yml", t) },
    "data/generated/talks.yml: record 'talk-b' has a field named 'website_include'"),
  "a nested email field in pillars.json" = list(
    function(root) { p <- synthetic_pillars(); p[[1]]$email <- "SECRET-VALUE"; write_json(root, "data/generated/pillars.json", p) },
    "data/generated/pillars.json: has a field named"),
  "the sheet ID in a script" = list(
    function(root) write_file(root, "_site/js/app.js", paste0("const id = '", site_config$sheet_id, "';\n")),
    "_site/js/app.js: contains the source sheet's ID"),
  "the sheet ID in JSON" = list(
    function(root) edit_file(root, "_site/search.json", "telephone follow-up", site_config$sheet_id),
    "_site/search.json: contains the source sheet's ID"),
  "the sheet ID in a page" = list(
    function(root) edit_file(root, "_site/index.html", "</main>", paste0(site_config$sheet_id, "</main>")),
    "_site/index.html: contains the source sheet's ID"),
  "a Google Sheets link" = list(
    function(root) edit_file(root, "_site/talks/index.html", "</main>", "<a href=\"https://docs.google.com/spreadsheets/d/FAKE\">x</a></main>"),
    "_site/talks/index.html: contains a Google Sheets link"),
  "a mailto: link in a page" = list(
    function(root) edit_file(root, "_site/publications/index.html", "</main>", "<a href=\"mailto:someone@example.invalid\">x</a></main>"),
    "_site/publications/index.html: links to a mailto: or tel: address"),
  "a tel: link in a page" = list(
    function(root) edit_file(root, "_site/index.html", "</main>", "<a href='tel:+10000000000'>x</a></main>"),
    "_site/index.html: links to a mailto: or tel: address"),
  "a mailto: value in a link field" = list(
    function(root) { t <- synthetic_talks(); t[[1]]$event_url <- "mailto:someone@example.invalid"; write_yaml(root, "data/generated/talks.yml", t) },
    "data/generated/talks.yml: record 'talk-a' field 'event_url' is a mailto: or tel: link"),
  "a tel: value in a link field" = list(
    function(root) { p <- synthetic_publications(); p[[1]]$doi_url <- "tel:+10000000000"; write_yaml(root, "data/generated/publications.yml", p) },
    "data/generated/publications.yml: record 'pub-a' field 'doi_url' is a mailto: or tel: link"),
  "a missing route" = list(
    function(root) unlink(file.path(root, "_site", "cv", "index.html")),
    "_site/cv/index.html: missing"),
  "a duplicate skip link" = list(
    function(root) edit_file(root, "_site/research/index.html", "</main>", paste0(skip_link_markup, "</main>")),
    "_site/research/index.html: expected exactly one skip link; found 2"),
  "a missing skip link" = list(
    function(root) edit_file(root, "_site/talks/index.html", skip_link_markup, ""),
    "_site/talks/index.html: expected exactly one skip link; found 0"),
  "the skip link's text in search.json" = list(
    function(root) edit_file(root, "_site/search.json", "telephone follow-up", "Skip to main content"),
    "_site/search.json: contains the skip link's text"),
  "no robots.txt" = list(
    function(root) unlink(file.path(root, "_site", "robots.txt")),
    "_site/robots.txt: missing"),
  "no sitemap.xml" = list(
    function(root) unlink(file.path(root, "_site", "sitemap.xml")),
    "_site/sitemap.xml: missing"),
  "a page asking not to be indexed" = list(
    function(root) edit_file(root, "_site/about/index.html", "</head>", "<meta name=\"robots\" content=\"noindex\"></head>"),
    "_site/about/index.html: asks search engines not to index it"),
  "zero publications" = list(
    function(root) write_file(root, "data/generated/publications.yml", "[]\n"),
    "data/generated/publications.yml: has no records"),
  "zero talks" = list(
    function(root) write_file(root, "data/generated/talks.yml", "[]\n"),
    "data/generated/talks.yml: has no records"),
  "counts that differ from build-metadata.json" = list(
    function(root) write_json(root, "data/generated/build-metadata.json", synthetic_metadata(talks = 3L)),
    "data/generated/build-metadata.json: public_rows.talks does not match the 2 records in talks.yml"),
  "another inclusion rule" = list(
    function(root) { m <- synthetic_metadata(); m$inclusion_rule <- "website_include != 'N'"; write_json(root, "data/generated/build-metadata.json", m) },
    "data/generated/build-metadata.json: inclusion_rule is not"),
  "a duplicate key" = list(
    function(root) { t <- synthetic_talks(); t[[2]]$key <- "talk-a"; write_yaml(root, "data/generated/talks.yml", t) },
    "data/generated/talks.yml: key 'talk-a' appears 2 times"),
  "an unknown pillar key" = list(
    function(root) { p <- synthetic_pillars(); names(p)[[4]] <- "A fifth idea"; write_json(root, "data/generated/pillars.json", p) },
    "data/generated/pillars.json: its keys must be exactly the four pillars"),
  "a feature that is not a public talk" = list(
    function(root) { g <- synthetic_geojson(); g$features[[1]]$properties$key <- "talk-z"; write_json(root, "data/generated/talks.geojson", g) },
    "data/generated/talks.geojson: feature #1 is not a public talk"),
  "a geometry that is not an object" = list(
    function(root) { g <- synthetic_geojson(); g$features[[1]]$geometry <- "POINT(20 10)"; write_json(root, "data/generated/talks.geojson", g) },
    "data/generated/talks.geojson: feature 'talk-a' is not a valid [lon, lat] point"),
  "coordinates out of range" = list(
    function(root) { g <- synthetic_geojson(); g$features[[1]]$geometry$coordinates <- c(200, 10.5); write_json(root, "data/generated/talks.geojson", g) },
    "data/generated/talks.geojson: feature 'talk-a' is not a valid [lon, lat] point"),
  "a feature at [lat, lon]" = list(
    function(root) { g <- synthetic_geojson(); g$features[[1]]$geometry$coordinates <- c(10.5, 20.25); write_json(root, "data/generated/talks.geojson", g) },
    "data/generated/talks.geojson: feature 'talk-a' is not at [longitude, latitude]"),
  "invalid UTF-8" = list(
    function(root) writeBin(as.raw(c(0x2d, 0x20, 0xff, 0x0a)), file.path(root, "data", "generated", "talks.yml")),
    "data/generated/talks.yml: is not valid UTF-8"),
  "a missing generated file" = list(
    function(root) unlink(file.path(root, "data", "generated", "pillars.json")),
    "data/generated/pillars.json: missing"),
  "no _site" = list(
    function(root) unlink(file.path(root, "_site"), recursive = TRUE),
    "_site/: missing"),
  "an invalid skip link include" = list(
    function(root) write_file(root, "includes/skip-link.html", "<p>not a link</p>\n"),
    "includes/skip-link.html: could not be checked")
)

test_that("each kind of problem is reported, naming the file, key and field", {
  for (name in names(mutations)) {
    root <- synthetic_root()
    mutations[[name]][[1]](root)
    issues <- issues_of(root)
    expect_true(any(startsWith(issues, mutations[[name]][[2]])), info = paste0(name, ": ", paste(issues, collapse = " | ")))
    # Record values never appear in a message.
    expect_false(any(grepl("SECRET-VALUE", issues, fixed = TRUE)), info = name)
    expect_false(isTRUE(suppressMessages(verify$verify_public_output(root))), info = name)
  }
})

test_that("every problem in one root is reported; a check that fails to run does not hide the others", {
  root <- synthetic_root()
  chosen <- c(
    "an invalid skip link include", "a geometry that is not an object", "a field named phone",
    "cv_include in a page", "a mailto: link in a page", "a missing route", "zero publications",
    "an unknown pillar key", "no robots.txt", "the sheet ID in a script"
  )
  for (name in chosen) mutations[[name]][[1]](root)
  issues <- issues_of(root)
  for (name in chosen) {
    expect_true(any(startsWith(issues, mutations[[name]][[2]])), info = name)
  }
  messages <- capture.output(ok <- verify$verify_public_output(root), type = "message")
  expect_false(ok)
  expect_match(messages[[1]], sprintf("public output verification failed (%d problems)", length(issues)), fixed = TRUE)
  expect_length(grep("^- ", messages), length(issues))
})
