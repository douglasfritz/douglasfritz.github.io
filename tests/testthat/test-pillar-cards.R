# The research-pillar component (R/pillar_cards.R): copy file, archive links,
# the static markup built from the generated data, and escaping.

umbrella <- "Translational physician-scientist for public health"
pillar_copy_path <- testthat::test_path("..", "..", "data", "pillar-copy.yml")

# The component's inputs as _pillars.qmd reads them: the serialized public
# data parsed back, and the real copy file.
fixture_pillar_inputs <- function(publications = publication_fixture(), talks = talk_fixture()) {
  files <- serialize_public_data(build_public_data(publications, talks))
  list(
    summary = jsonlite::parse_json(files[["pillars.json"]]),
    publications = yaml::yaml.load(files[["publications.yml"]]),
    talks = yaml::yaml.load(files[["talks.yml"]]),
    copy = read_pillar_copy(pillar_copy_path)
  )
}

render_inputs <- function(inputs) do.call(pillar_component_html, inputs)

# The markup of each pillar card, in document order.
card_chunks <- function(html) {
  starts <- gregexpr("<article", html, fixed = TRUE)[[1]]
  ends <- c(starts[-1] - 1, nchar(html))
  substring(html, starts, ends)
}

matches_of <- function(html, pattern) regmatches(html, gregexpr(pattern, html, perl = TRUE))[[1]]

first_group <- function(html, pattern) {
  vapply(regmatches(html, gregexpr(pattern, html, perl = TRUE))[[1]], function(m) {
    sub(pattern, "\\1", m, perl = TRUE)
  }, character(1), USE.NAMES = FALSE)
}

# Element text as a browser reads it: tags dropped, the references the
# renderer writes decoded, whitespace collapsed.
html_text <- function(html) {
  text <- gsub("<[^>]*>", " ", html)
  entities <- c("&lt;" = "<", "&gt;" = ">", "&quot;" = '"', "&#39;" = "'", "&#96;" = "`", "&#123;" = "{", "&#125;" = "}", "&#13;" = "\r", "&#10;" = "\n", "&#9;" = "\t")
  for (entity in names(entities)) text <- gsub(entity, entities[[entity]], text, fixed = TRUE)
  text <- gsub("&amp;", "&", text, fixed = TRUE)
  trimws(gsub("\\s+", " ", text))
}

attr_decode <- function(value) html_text(value)

test_that("the pillar copy is keyed by exactly the configured pillars", {
  raw <- yaml::read_yaml(pillar_copy_path)
  expect_identical(names(raw), site_config$pillars)
  expect_false(umbrella %in% names(raw))
  copy <- read_pillar_copy(pillar_copy_path)
  for (pillar in site_config$pillars) {
    expect_named(copy[[pillar]], c("role", "includes"))
    expect_true(nzchar(copy[[pillar]]$role) && nzchar(copy[[pillar]]$includes), info = pillar)
  }

  bad <- withr::local_tempfile(fileext = ".yml")
  write_copy <- function(x) yaml::write_yaml(x, bad)
  write_copy(raw[c(2, 1, 3, 4)])
  expect_error(read_pillar_copy(bad), "exactly the four configured pillars")
  write_copy(c(raw, stats::setNames(list(list(role = "x", includes = "y")), umbrella)))
  expect_error(read_pillar_copy(bad), "exactly the four configured pillars")
  write_copy(raw[1:3])
  expect_error(read_pillar_copy(bad), "exactly the four configured pillars")
  renamed <- raw
  names(renamed)[4] <- "Climate and planetary health"
  write_copy(renamed)
  expect_error(read_pillar_copy(bad), "exactly the four configured pillars")
  blank <- raw
  blank[[3]]$includes <- " "
  write_copy(blank)
  expect_error(read_pillar_copy(bad), "needs a nonempty role and includes")
  extra <- raw
  extra[[1]]$summary <- "x"
  write_copy(extra)
  expect_error(read_pillar_copy(bad), "needs a nonempty role and includes")
})

test_that("archive links encode the pillar exactly as encodeURIComponent does", {
  # Generated with JavaScript's encodeURIComponent; tests/js/pillars.test.mjs
  # checks pillarHref() against the same file.
  rows <- jsonlite::read_json(fixture_path("pillar_links.json"))
  expect_gte(length(rows), 10)
  expect_true(all(site_config$pillars %in% vapply(rows, function(r) r$pillar, character(1))))
  for (row in rows) {
    expect_identical(pillar_archive_href(row$base, row$pillar), row$href, info = row$pillar)
  }
  expect_identical(encode_uri_component(c("a b", "", "é")), c("a%20b", "", "%C3%A9"))
  expect_identical(
    record_card_href("publications", "pub-1"),
    "/publications/?foundational=include#publication-pub-1"
  )
  expect_identical(record_card_href("talks", "talk-2"), "/talks/?foundational=include#talk-talk-2")
})

test_that("the component shows the umbrella as text and exactly four numbered pillar controls", {
  html <- render_inputs(fixture_pillar_inputs())

  buttons <- matches_of(html, "(?s)<button.*?</button>")
  expect_length(buttons, 4)
  expect_identical(
    vapply(buttons, html_text, character(1), USE.NAMES = FALSE),
    paste("Pillar", 1:4, site_config$pillars)
  )
  for (i in 1:4) {
    expect_match(buttons[[i]], sprintf('aria-controls="pillar-%d-panel"', i), fixed = TRUE)
    expect_match(buttons[[i]], 'aria-expanded="true"', fixed = TRUE)
    expect_match(html, sprintf('<article class="pillar-card pillar-card-%d" id="pillar-%d" aria-labelledby="pillar-%d-toggle"', i, i, i), fixed = TRUE)
    expect_match(buttons[[i]], sprintf('id="pillar-%d-toggle"', i), fixed = TRUE)
    expect_match(html, sprintf('<div class="pillar-panel" id="pillar-%d-panel">', i), fixed = TRUE)
  }
  expect_identical(attr_decode(first_group(html, 'data-pillar="([^"]*)"')), site_config$pillars)
  expect_identical(first_group(html, 'data-pillar-number="([^"]*)"'), as.character(1:4))

  # The umbrella is the component's heading: text, not a control or value.
  expect_match(html, sprintf('<h2 class="pillar-umbrella no-anchor"><span id="research-pillars-heading">%s</span></h2>', umbrella), fixed = TRUE)
  expect_match(html, 'aria-labelledby="research-pillars-heading"', fixed = TRUE)
  # Every heading is "no-anchor", so Quarto adds no "#" links to them.
  headings <- matches_of(html, "<h[1-6][^>]*>")
  expect_length(headings, 1 + 4 + 4 * 2)
  expect_true(all(grepl('class="[^"]*\\bno-anchor\\b', headings)))
  expect_false(any(grepl(umbrella, buttons, fixed = TRUE)))
  expect_false(grepl("<(select|option|input|form)\\b", html, perl = TRUE))
  expect_false(grepl(paste0('data-pillar="', umbrella), html, fixed = TRUE))
  expect_length(matches_of(html, "<article"), 4)
})

test_that("each card shows its copy, topic tags, counts, archive links and selected outputs", {
  inputs <- fixture_pillar_inputs()
  html <- render_inputs(inputs)
  cards <- card_chunks(html)
  expect_length(cards, 4)
  records <- list(publications = inputs$publications, talks = inputs$talks)
  bases <- c(publications = "/publications/", talks = "/talks/")
  secondary_labels <- 0

  for (i in 1:4) {
    pillar <- site_config$pillars[[i]]
    entry <- inputs$summary[[pillar]]
    card <- cards[[i]]
    expect_match(card, sprintf('data-pillar="%s"', pillar), fixed = TRUE)
    expect_match(html_text(card), paste("Role:", inputs$copy[[pillar]]$role), fixed = TRUE)
    expect_match(html_text(card), paste("Includes:", inputs$copy[[pillar]]$includes), fixed = TRUE)

    tags <- unlist(entry$topic_tags)
    expect_gt(length(tags), 0)
    expect_identical(first_group(card, "<li>([^<]*)</li>"), tags)

    for (kind in c("publications", "talks")) {
      summary <- entry[[kind]]
      fact <- matches_of(card, sprintf('(?s)<div class="pillar-fact" data-pillar-kind="%s">.*?</div>', kind))
      expect_length(fact, 1)
      expect_identical(first_group(fact, "<span class=\"pillar-primary-count\" data-primary-count>([^<]*)</span>"), as.character(summary$primary))
      expect_match(html_text(fact), paste(summary$primary, "with this as primary pillar"), fixed = TRUE)
      noun <- if (summary$any == 1) sub("s$", "", kind) else kind
      link <- matches_of(fact, "(?s)<a .*?</a>")
      expect_length(link, 1)
      expect_identical(html_text(link), sprintf("View %d %s in Pillar %d", summary$any, noun, i))
      expect_identical(attr_decode(first_group(link, 'href="([^"]*)"')), pillar_archive_href(bases[[kind]], pillar))

      # Selected outputs: the representative keys, in order, linked to their
      # cards; secondary-pillar records labelled, checked against the records.
      outputs <- matches_of(card, sprintf('(?s)<ul class="pillar-outputs" data-pillar-outputs="%s">.*?</ul>', kind))
      keys <- unlist(summary$representative)
      expect_identical(length(outputs), as.integer(length(keys) > 0))
      if (length(keys) == 0) {
        expect_match(card, sprintf('data-pillar-outputs="%s">No public %s in this pillar yet.', kind, kind), fixed = TRUE)
        next
      }
      items <- matches_of(outputs, "(?s)<li.*?</li>")
      expect_identical(first_group(outputs, 'data-key="([^"]*)"'), keys)
      for (j in seq_along(keys)) {
        record <- Filter(function(r) r$key == keys[[j]], records[[kind]])[[1]]
        expect_identical(
          attr_decode(first_group(items[[j]], 'href="([^"]*)"')),
          sprintf("%s?foundational=include#%s-%s", bases[[kind]], sub("s$", "", kind), record$slug)
        )
        expect_match(html_text(items[[j]]), paste(record$title, record$year), fixed = TRUE)
        is_secondary <- !identical(record$primary_pillar, pillar)
        expect_identical(grepl("also tagged (secondary pillar)", items[[j]], fixed = TRUE), is_secondary)
        secondary_labels <- secondary_labels + is_secondary
      }
      expect_identical(sum(grepl("also tagged", items, fixed = TRUE)), as.integer(summary$representative_secondary))
    }
  }
  # The fixtures exercise the secondary-pillar label.
  expect_gte(secondary_labels, 2)
})

test_that("a pillar without records still gets its card, links and an empty state", {
  pubs <- publication_fixture()
  pubs$secondary_pillar <- NA # pillar 2 then has no publications
  inputs <- fixture_pillar_inputs(pubs)
  expect_identical(inputs$summary[[2]]$publications$any, 0L)
  card <- card_chunks(render_inputs(inputs))[[2]]
  expect_match(html_text(card), "View 0 publications in Pillar 2", fixed = TRUE)
  expect_match(card, 'data-pillar-outputs="publications">No public publications in this pillar yet.', fixed = TRUE)
  expect_match(card, 'href="/publications/?pillar=Quantitative%20and%20experimental%20biomedical%20discovery&amp;foundational=include"', fixed = TRUE)
})

test_that("spreadsheet text renders as text, never as markup, script, shortcode or fence", {
  inputs <- fixture_pillar_inputs()
  hostile_title <- paste(
    '<img src=x onerror="alert(1)"> \'single\' "double" & </script><script>alert(2)</script>',
    "``` {{< meta title >}} {=html}"
  )
  hostile_tag <- '<b>tag</b> "x" `y` {{< env HOME >}}'
  hostile_key <- 'k"><img src=x onerror=alert(3)>'
  # pub-1: selected for pillar 1 (primary) and pillar 2 (secondary).
  pub_1 <- which(vapply(inputs$publications, function(r) r$key, character(1)) == "pub-1")
  expect_length(pub_1, 1)
  inputs$publications[[pub_1]]$title <- hostile_title
  inputs$publications[[pub_1]]$key <- hostile_key
  inputs$publications[[pub_1]]$slug <- hostile_key
  for (i in seq_along(inputs$summary)) {
    rep <- unlist(inputs$summary[[i]]$publications$representative)
    inputs$summary[[i]]$publications$representative <- as.list(replace(rep, rep == "pub-1", hostile_key))
  }
  inputs$summary[[1]]$topic_tags <- list(hostile_tag)
  html <- render_inputs(inputs)

  # (Quotes need no escaping in element text; attribute values escape them.)
  for (raw in c("<img", "<script", "</script", "<b>", "`", "{", "}", "onerror=alert(3)>")) {
    expect_false(grepl(raw, html, fixed = TRUE), info = raw)
  }
  text <- html_text(html)
  expect_match(text, hostile_title, fixed = TRUE)
  expect_match(text, hostile_tag, fixed = TRUE)
  # The key stays inside its attribute and the link inside its href.
  expect_match(html, 'data-key="k&quot;&gt;&lt;img src=x onerror=alert(3)&gt;"', fixed = TRUE)
  expect_true(hostile_key %in% attr_decode(first_group(html, 'data-key="([^"]*)"')))
  expect_true(paste0("/publications/?foundational=include#publication-", encode_uri_component(hostile_key)) %in%
    attr_decode(first_group(html, 'href="([^"]*)"')))
  # The pub-1 title appears once per pillar that selects it (1 and 2).
  expect_length(matches_of(html, '&lt;img src=x onerror="alert\\(1\\)"&gt;'), 2)

  # In the Quarto block, nothing can close the raw fence early.
  block <- paste0("```{=html}\n", html, "\n```\n")
  expect_identical(sum(grepl("^`", strsplit(block, "\n", fixed = TRUE)[[1]])), 2L)
})

test_that("inconsistent data stops the render with a clear message", {
  inputs <- fixture_pillar_inputs()

  swapped <- inputs
  swapped$summary <- inputs$summary[c(2, 1, 3, 4)]
  expect_error(render_inputs(swapped), "pillars.json must have exactly the four configured pillars")

  fifth <- inputs
  fifth$summary[[umbrella]] <- inputs$summary[[1]]
  expect_error(render_inputs(fifth), "pillars.json must have exactly the four configured pillars")

  unknown <- inputs
  unknown$summary[[1]]$talks$representative <- list("no-such-talk")
  expect_error(render_inputs(unknown), "representative key 'no-such-talk' is not a public record")

  missing_count <- inputs
  missing_count$summary[[1]]$publications$representative_secondary <- NULL
  expect_error(render_inputs(missing_count), "representative_secondary must be 0 to 2")

  renumbered <- inputs
  renumbered$summary[[3]]$number <- 4L
  expect_error(render_inputs(renumbered), "must be number 3")
})

test_that("the Quarto block reads the generated data and the copy from the project root", {
  root <- withr::local_tempdir()
  dir.create(file.path(root, "data"))
  expect_error(pillar_component_block(root), "missing data/generated/pillars.json, publications.yml, talks.yml")

  write_public_data(build_public_data(publication_fixture(), talk_fixture()), file.path(root, "data", "generated"))
  file.copy(pillar_copy_path, file.path(root, "data", "pillar-copy.yml"))
  block <- pillar_component_block(root)
  expect_identical(block, paste0("```{=html}\n", render_inputs(fixture_pillar_inputs()), "\n```\n"))
  expect_match(block, "^```\\{=html\\}\n<section class=\"pillar-component\"")
})
