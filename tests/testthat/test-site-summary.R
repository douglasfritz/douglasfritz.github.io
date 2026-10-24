# Home, About and CV content built from data (R/site_summary.R): Selected
# work, the reach summary, the hero, affiliations and profile links, the
# conditional CV download, escaping, and UTF-8 output in a C locale.

summary_site_path <- testthat::test_path("..", "..", "data", "site.yml")
summary_site <- read_site_config(summary_site_path)

# The public records as the pages read them: the serialized fixture data
# parsed back.
fixture_public_records <- function(publications = publication_fixture(), talks = talk_fixture()) {
  files <- serialize_public_data(build_public_data(publications, talks))
  list(publications = yaml::yaml.load(files[["publications.yml"]]), talks = yaml::yaml.load(files[["talks.yml"]]))
}

# A minimal public record, in archive order when listed newest first.
record <- function(key, featured = NULL, foundational = "N", ...) {
  Filter(Negate(is.null), list(key = key, title = paste("Title", key), slug = key, featured = featured, foundational_work = foundational, ...))
}
keys_of <- function(records) vapply(records, function(r) r$key, character(1))

# Element text as a browser reads it (tags dropped, references decoded).
text_of <- function(html) {
  text <- gsub("<[^>]*>", "", html)
  entities <- c("&lt;" = "<", "&gt;" = ">", "&quot;" = '"', "&#39;" = "'", "&#96;" = "`", "&#123;" = "{", "&#125;" = "}")
  for (entity in names(entities)) text <- gsub(entity, entities[[entity]], text, fixed = TRUE)
  trimws(gsub("\\s+", " ", gsub("&amp;", "&", text, fixed = TRUE)))
}
all_matches <- function(html, pattern) regmatches(html, gregexpr(pattern, html, perl = TRUE))[[1]]
group_html <- function(html, kind) all_matches(html, sprintf('(?s)<section class="selected-group" data-selected-kind="%s".*?</section>', kind))
item_html <- function(html) all_matches(html, "(?s)<li class=\"selected-item\".*?</li>")
item_keys <- function(html) sub('^.*data-key="([^"]*)".*$', "\\1", all_matches(html, '<li class="selected-item" data-key="[^"]*"'))

test_that("selection puts featured records first, then the newest, and leaves out foundational work", {
  # Archive order: newest first.
  records <- list(
    record("r6"), record("r5", featured = "Y"), record("r4", featured = "Y", foundational = "Y"),
    record("r3"), record("r2", featured = "Y"), record("r1"), record("r0", featured = "y")
  )
  expect_identical(keys_of(select_records(records)), c("r5", "r2", "r6"))
  expect_identical(keys_of(select_records(records, limit = 10)), c("r5", "r2", "r6", "r3", "r1", "r0"))
  # Fewer than three rather than foundational work.
  few <- list(record("a", foundational = "Y"), record("b"), record("c", featured = "Y", foundational = "Y"))
  expect_identical(keys_of(select_records(few)), "b")
  expect_length(select_records(list(record("x", foundational = "Y"))), 0)
  expect_length(select_records(list()), 0)
  # Only exact "Y" is featured, and only exact "Y" is foundational.
  expect_identical(keys_of(select_records(list(record("n1"), record("n2", featured = "yes"), record("n3", foundational = "y")))), c("n1", "n2", "n3"))
})

test_that("Selected work lists the public records with their exact status and links to their cards", {
  records <- fixture_public_records()
  html <- as.character(selected_work_html(records$publications, records$talks))
  for (kind in c("publications", "talks")) {
    group <- group_html(html, kind)
    expect_length(group, 1)
    expected <- select_records(records[[kind]])
    expect_gt(length(expected), 0)
    expect_lte(length(expected), 3)
    expect_identical(item_keys(group), keys_of(expected))
    items <- item_html(group)
    for (i in seq_along(expected)) {
      r <- expected[[i]]
      expect_false(identical(r$foundational_work, "Y"))
      card <- if (kind == "publications") "publication" else "talk"
      expect_match(items[[i]], sprintf('<a class="selected-title" href="/%s/#%s-%s">', kind, card, encode_uri_component(r$slug)), fixed = TRUE)
      expect_match(text_of(items[[i]]), r$title, fixed = TRUE)
    }
  }
  # The fixtures: pub-1 (featured, 2025) before the newer pub-2 (In Review);
  # the foundational pub-5 is left out, so only two are shown.
  expect_identical(item_keys(group_html(html, "publications")), c("pub-1", "pub-2"))
  expect_identical(item_keys(group_html(html, "talks")), c("talk-1", "talk-2", "talk-3"))
  expect_false(grepl("pub-5|talk-4", html))
  # Status is shown exactly; anything but Published gets the dashed badge.
  pubs <- item_html(group_html(html, "publications"))
  expect_match(pubs[[1]], '<span class="status-badge status-published" data-status="Published">Published</span>', fixed = TRUE)
  expect_match(pubs[[2]], '<span class="status-badge status-not-published" data-status="In Review">In Review</span>', fixed = TRUE)
  expect_false(grepl("status-published", pubs[[2]], fixed = TRUE))
  # Every heading is "no-anchor" and the order is h2, then h3s.
  headings <- all_matches(html, "<h[1-6][^>]*>")
  expect_identical(substr(headings, 1, 3), c("<h2", "<h3", "<h3"))
  expect_true(all(grepl("no-anchor", headings, fixed = TRUE)))
})

test_that("a selected virtual talk says it was virtual and where its host is, never travel", {
  records <- fixture_public_records()
  talks <- item_html(group_html(as.character(selected_work_html(records$publications, records$talks)), "talks"))
  by_key <- stats::setNames(select_records(records$talks), item_keys(paste(talks, collapse = "")))
  expect_true(any(vapply(by_key, function(r) identical(r$virtual_status, "Y"), logical(1))))
  for (i in seq_along(talks)) {
    r <- by_key[[i]]
    location <- text_of(all_matches(talks[[i]], '(?s)<p class="selected-meta talk-location">.*?</p>'))
    place <- if (is.null(r$location_display)) "" else paste0(", ", r$location_display)
    if (identical(r$virtual_status, "Y")) {
      expect_identical(location, paste0("Virtual — hosted by ", r$organization, place))
      expect_match(talks[[i]], '<span class="virtual-badge">Virtual</span>', fixed = TRUE)
    } else {
      expect_identical(location, paste0(r$organization, place))
      expect_false(grepl("hosted by|Virtual", talks[[i]]))
    }
    expect_match(talks[[i]], sprintf('<time class="record-date" datetime="%s">%s</time>', r$date, short_date(r$date)), fixed = TRUE)
  }
  expect_identical(short_date("2024-05-02"), "2 May 2024")
  expect_identical(long_date("2026-10-04"), "4 October 2026")
})

test_that("an archive with nothing to select gets an honest empty state", {
  html <- as.character(selected_work_html(list(record("p", foundational = "Y")), list()))
  expect_match(html, '<p class="selected-none">No publications to feature yet.</p>', fixed = TRUE)
  expect_match(html, '<p class="selected-none">No talks to feature yet.</p>', fixed = TRUE)
  expect_false(grepl("selected-item", html, fixed = TRUE))
})

test_that("reach counts documented countries and hosts only, never an audience", {
  talks <- list(
    list(organization = "Host A", location_country = "Exampleland"),
    list(organization = "Host A", location_country = "Testonia"),
    list(organization = " Host B ", location_country = " Exampleland "),
    list(organization = "Host C"),
    list(organization = "Host D", location_country = ""),
    list(organization = "Host E", location_country = "   "),
    list(organization = "", location_country = NA_character_)
  )
  expect_identical(talk_reach(talks), list(presentations = 7L, countries = 2L, hosts = 5L))
  expect_identical(talk_reach(list()), list(presentations = 0L, countries = 0L, hosts = 0L))

  html <- as.character(reach_summary_html(talks))
  expect_identical(text_of(all_matches(html, '(?s)<p class="home-reach-line">.*?</p>')), "Across 2 countries and 5 hosting institutions.")
  expect_match(html, '<strong data-reach="countries">2</strong>', fixed = TRUE)
  expect_match(html, '<strong data-reach="hosts">5</strong>', fixed = TRUE)
  expect_match(html, '<strong data-reach="presentations">7</strong>', fixed = TRUE)
  expect_match(text_of(html), "These are not audience figures.", fixed = TRUE)
  expect_false(grepl("audience of|attendees|people reached|viewers", text_of(html), ignore.case = TRUE))

  one <- as.character(reach_summary_html(list(list(organization = "Host", location_country = "Exampleland"))))
  expect_identical(text_of(all_matches(one, '(?s)<p class="home-reach-line">.*?</p>')), "Across 1 country and 1 hosting institution.")
  expect_match(text_of(one), "all 1 public talk, foundational work included", fixed = TRUE)
  no_country <- as.character(reach_summary_html(list(list(organization = "Host"), list(organization = "Other"))))
  expect_identical(text_of(all_matches(no_country, '(?s)<p class="home-reach-line">.*?</p>')), "Across 2 hosting institutions.")
  expect_false(grepl('data-reach="countries"', no_country, fixed = TRUE))
  none <- as.character(reach_summary_html(list()))
  expect_identical(text_of(all_matches(none, '(?s)<p class="home-reach-line">.*?</p>')), "No public talks are listed yet.")

  # The fixture talks, foundational work included: the Talks page's counts.
  records <- fixture_public_records()
  expect_identical(talk_reach(records$talks), list(
    presentations = length(records$talks),
    countries = length(unique(unlist(lapply(records$talks, function(r) r$location_country)))),
    hosts = length(unique(vapply(records$talks, function(r) r$organization, character(1))))
  ))
  expect_gte(talk_reach(records$talks)$countries, 2)
})

test_that("the hero, affiliations and profile links come from data/site.yml", {
  hero <- as.character(home_hero_html(summary_site))
  expect_match(hero, '^<header class="quarto-title-block home-hero-header">')
  expect_length(all_matches(hero, "<h1"), 1)
  expect_match(hero, '<h1 class="home-name no-anchor">Douglas Fritz</h1>', fixed = TRUE)
  expect_match(hero, sprintf('<p class="home-umbrella">%s</p>', summary_site$umbrella), fixed = TRUE)
  expect_match(hero, sprintf('<p class="home-training">%s</p>', summary_site$training_context), fixed = TRUE)
  expect_match(hero, sprintf(
    '<img class="home-headshot" src="/%s" alt="%s" width="%d" height="%d"/>',
    summary_site$headshot$src, summary_site$headshot$alt, summary_site$headshot$width, summary_site$headshot$height
  ), fixed = TRUE)

  connect <- as.character(home_connect_html(summary_site))
  links <- all_matches(connect, "<a [^>]*>[^<]*</a>")
  expect_identical(links, c(
    '<a href="/cv/">Full CV</a>',
    '<a href="https://github.com/douglasfritz" aria-label="Douglas Fritz on GitHub" data-profile="github">GitHub</a>',
    '<a href="https://orcid.org/0000-0001-8822-4639" aria-label="Douglas Fritz on ORCID" data-profile="orcid">ORCID</a>',
    '<a href="https://www.linkedin.com/in/douglas-fritz" aria-label="Douglas Fritz on LinkedIn" data-profile="linkedin">LinkedIn</a>'
  ))
  items <- text_of(all_matches(connect, "(?s)<li>.*?</li>"))
  expected <- vapply(summary_site$affiliations, function(a) paste(c(a$title, a$organization), collapse = ", "), character(1))
  expect_identical(items[seq_along(expected)], expected)
  expect_match(connect, '<h2 class="no-anchor" id="home-connect-heading">', fixed = TRUE)
})

test_that("the CV download appears only when the approved PDF exists, with its size and real date", {
  root <- withr::local_tempdir()
  site <- summary_site
  site$cv_updated <- "2026-10-04"

  absent <- as.character(cv_download_html(site, root))
  expect_match(absent, 'data-cv-pdf="absent"', fixed = TRUE)
  expect_false(grepl("[.]pdf|Last updated|<time|Download", absent))
  expect_match(text_of(absent), "The CV is a PDF generated from the same spreadsheet as this site.", fixed = TRUE)

  dir.create(file.path(root, "assets", "documents"), recursive = TRUE)
  writeBin(as.raw(rep(0x25, 3 * 1024 + 100)), file.path(root, site$cv_pdf))
  present <- as.character(cv_download_html(site, root))
  expect_match(present, 'data-cv-pdf="present"', fixed = TRUE)
  expect_match(present, '<a href="/assets/documents/Douglas_Fritz_CV.pdf" type="application/pdf">Download the CV <span class="cv-file-hint">(PDF, 3 KB)</span></a>', fixed = TRUE)
  expect_match(present, '<p class="cv-updated">Last updated: <time datetime="2026-10-04">4 October 2026</time></p>', fixed = TRUE)
  expect_identical(file_size_text(5.5 * 1024^2), "5.5 MB")
  expect_identical(file_size_text(1.25 * 1024^2), "1.3 MB")
  expect_identical(file_size_text(244.5 * 1024), "245 KB")
  expect_identical(file_size_text(10), "1 KB")

  site$cv_updated <- NULL
  expect_error(cv_download_html(site, root), "set cv_updated")
})

test_that("the blocks read data/site.yml and the generated data from the project root", {
  root <- withr::local_tempdir()
  dir.create(file.path(root, "data"))
  file.copy(summary_site_path, file.path(root, "data", "site.yml"))
  expect_error(home_evidence_block(root), "missing data/generated/publications.yml, talks.yml")
  write_public_data(build_public_data(publication_fixture(), talk_fixture()), file.path(root, "data", "generated"))
  records <- fixture_public_records()
  expect_identical(
    home_evidence_block(root),
    paste0("```{=html}\n", as.character(htmltools::tagList(
      selected_work_html(records$publications, records$talks), reach_summary_html(records$talks)
    )), "\n```\n")
  )
  expect_match(home_hero_block(root), "^```\\{=html\\}\n<header class=\"quarto-title-block home-hero-header\">")
  expect_match(cv_download_block(root), 'data-cv-pdf="absent"', fixed = TRUE)
  expect_match(about_affiliations_block(root), "^```\\{=html\\}\n<ul class=\"affiliation-list\">")
  expect_match(profile_links_block(root), "^```\\{=html\\}\n<ul class=\"profile-links\">")
  expect_match(home_connect_block(root), "Douglas Fritz on ORCID", fixed = TRUE)
  # Every raw-HTML heading is "no-anchor" (Quarto adds "#" links otherwise):
  # the hero h1, Selected work's h2 and two h3s, and the reach and links h2s.
  blocks <- paste(home_hero_block(root), home_evidence_block(root), home_connect_block(root), about_affiliations_block(root), profile_links_block(root), cv_download_block(root))
  headings <- all_matches(blocks, "<h[1-6][^>]*>")
  expect_identical(substr(headings, 1, 3), c("<h1", "<h2", "<h3", "<h3", "<h2", "<h2"))
  expect_true(all(grepl("\\bno-anchor\\b", headings, perl = TRUE)))
})

test_that("spreadsheet text renders as text, never as markup, script, shortcode or fence", {
  hostile <- paste(
    '<img src=x onerror="alert(1)"> \'single\' "double" & </script><script>alert(2)</script>',
    "``` {{< meta title >}} {=html}"
  )
  hostile_slug <- 'k"><img src=x onerror=alert(3)>'
  pub <- record(hostile_slug, status = "In Review <b>", year = 2026L, journal = hostile)
  pub$title <- hostile
  talk <- record("t", date = "2026-01-02", type = hostile, organization = hostile, location_display = hostile, virtual_status = "Y")
  talk$title <- hostile
  site <- summary_site
  site$name <- hostile
  site$affiliations <- list(list(title = hostile, organization = hostile))
  html <- protect_raw_html(as.character(htmltools::tagList(
    selected_work_html(list(pub), list(talk)), reach_summary_html(list(talk)),
    home_hero_html(site), home_connect_html(site)
  )))
  # The only image is the headshot.
  expect_identical(all_matches(html, "<img[^>]*"), sprintf('<img class="home-headshot" src="/%s" alt="%s" width="%d" height="%d"/', site$headshot$src, site$headshot$alt, site$headshot$width, site$headshot$height))
  for (raw in c("<script", "</script", "<b>", "`", "{", "}", "onerror=alert(3)>")) {
    expect_false(grepl(raw, html, fixed = TRUE), info = raw)
  }
  expect_gte(length(gregexpr(hostile, text_of(html), fixed = TRUE)[[1]]), 8)
  expect_match(html, sprintf('href="/publications/#publication-%s"', encode_uri_component(hostile_slug)), fixed = TRUE)
  expect_match(html, 'data-key="k&quot;&gt;&lt;img src=x onerror=alert(3)&gt;"', fixed = TRUE)
  expect_match(html, 'aria-label="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;', fixed = TRUE)
  expect_match(html, 'data-status="In Review &lt;b&gt;">In Review &lt;b&gt;</span>', fixed = TRUE)
  block <- raw_html_block(html)
  expect_identical(sum(grepl("^`", strsplit(block, "\n", fixed = TRUE)[[1]])), 2L)
  # Inline text is escaped too; tags are kept as they are.
  expect_identical(
    as.character(inline("a < b & \"c\"", NULL, htmltools::tags$b("x <y>"))),
    "a &lt; b &amp; \"c\"<b>x &lt;y&gt;</b>"
  )
  # Every page block is escaped this way.
  expect_identical(
    site_block(htmltools::tags$p("```\n{{< meta title >}}")),
    "```{=html}\n<p>&#96;&#96;&#96;\n&#123;&#123;&lt; meta title &gt;&#125;&#125;</p>\n```\n"
  )
})

test_that("non-ASCII text survives the page chunks in a C locale", {
  repo <- normalizePath(testthat::test_path("..", ".."))
  root <- withr::local_tempdir()
  dir.create(file.path(root, "R"))
  file.copy(file.path(repo, "R", c("config.R", "pillar_cards.R", "site_summary.R")), file.path(root, "R"))
  dir.create(file.path(root, "data"))
  file.copy(file.path(repo, "data", c("site.yml", "pillar-copy.yml")), file.path(root, "data"))

  pubs <- publication_fixture()
  pubs$title[pubs$key == "pub-1"] <- "García Müller 中 study"
  pubs$author[pubs$key == "pub-1"] <- "García, J.; Müller, R.; 中"
  pubs$topic_tags[pubs$key == "pub-1"] <- "tag-alpha; Müller-tag; 中"
  talks <- talk_fixture()
  talks$title[talks$key == "talk-2"] <- "Virtual talk for Müller 中"
  talks$organization[talks$key == "talk-2"] <- "Universität García"
  write_public_data(build_public_data(pubs, talks), file.path(root, "data", "generated"))

  out <- file.path(root, "out")
  dir.create(out)
  script <- file.path(root, "knit.R")
  writeLines(c(
    sprintf(".libPaths(%s)", paste(deparse(.libPaths()), collapse = "")),
    "if (isTRUE(l10n_info()[['UTF-8']])) stop('expected a non-UTF-8 locale')",
    sprintf("repo <- %s; out <- %s", deparse(repo), deparse(out)),
    "for (page in c('index.qmd', 'about/index.qmd', 'cv/index.qmd', '_pillars.qmd')) {",
    "  knitr::knit(file.path(repo, page), output = file.path(out, gsub('/', '-', page)), quiet = TRUE, encoding = 'UTF-8', envir = new.env())",
    "}",
    "env <- new.env()",
    "for (file in c('config.R', 'pillar_cards.R', 'site_summary.R')) sys.source(file.path(Sys.getenv('QUARTO_PROJECT_DIR'), 'R', file), envir = env)",
    "author <- env$read_public_records(Sys.getenv('QUARTO_PROJECT_DIR'))$publications",
    "author <- Filter(function(r) r$key == 'pub-1', author)[[1]]$author",
    "writeBin(charToRaw(enc2utf8(author)), file.path(out, 'author.txt'))"
  ), script)
  log <- system2(
    file.path(R.home("bin"), "Rscript"), c("--vanilla", shQuote(script)),
    env = c("LC_ALL=C", "LANG=C", paste0("QUARTO_PROJECT_DIR=", shQuote(root))),
    stdout = TRUE, stderr = TRUE
  )
  expect_null(attr(log, "status"), info = paste(log, collapse = "\n"))

  read_utf8 <- function(file) paste(readLines(file.path(out, file), encoding = "UTF-8", warn = FALSE), collapse = "\n")
  home <- read_utf8("index.qmd")
  pillars <- read_utf8("_pillars.qmd")
  about <- read_utf8("about-index.qmd")
  cv <- read_utf8("cv-index.qmd")
  # Selected work: the publication title and the virtual talk's title and
  # host; the hero and affiliations (site.yml has an en dash).
  expect_match(home, "García Müller 中 study", fixed = TRUE)
  expect_match(home, "Virtual talk for Müller 中", fixed = TRUE)
  expect_match(home, "hosted by <span class=\"talk-host\">Universität García</span>", fixed = TRUE)
  expect_match(home, "NIH Oxford–Cambridge Scholar", fixed = TRUE)
  expect_match(about, "NIH Oxford–Cambridge Scholar", fixed = TRUE)
  expect_match(cv, 'data-cv-pdf="absent"', fixed = TRUE)
  # The pillar component: the title and the tags.
  expect_match(pillars, "García Müller 中 study", fixed = TRUE)
  expect_match(pillars, "<li>Müller-tag</li>", fixed = TRUE)
  expect_match(pillars, "<li>中</li>", fixed = TRUE)
  for (text in list(home, pillars, about, cv)) {
    expect_false(grepl("<U+", text, fixed = TRUE))
    # A UTF-8 byte pair written as escapes (as cat() writes it in a C locale).
    expect_false(grepl("<(c[2-9a-f]|d[0-9a-f]|e[0-9a-f]|f[0-4])><[89ab][0-9a-f]>", text, perl = TRUE))
    expect_true(validUTF8(text))
  }
  expect_identical(readBin(file.path(out, "author.txt"), "raw", 100), charToRaw(enc2utf8("García, J.; Müller, R.; 中")))
})
