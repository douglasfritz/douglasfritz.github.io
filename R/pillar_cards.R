# The research-pillar component, rendered to static HTML at build time, so
# that every description, count, selected output and archive link is in the
# page without JavaScript. _pillars.qmd (included by research/index.qmd and
# index.qmd) calls pillar_component_block(); js/pillars.js only enhances the
# markup (one pillar open at a time).
#
# Inputs: data/generated/{pillars.json, publications.yml, talks.yml} (the
# same public records the archives list) and data/pillar-copy.yml (each
# pillar's role and the questions it includes). Every value from them is
# HTML-escaped: the markup is built with htmltools tags, which escape text and
# attribute values (htmltools::htmlEscape), and protect_raw_html() then
# escapes backticks and braces (see there).
#
# Markup contract (js/pillars.js, styles/_components.scss, tests/e2e):
#   section.pillar-component#research-pillars[data-pillar-component]
#     div.pillar-hub                    h2.pillar-umbrella: the umbrella identity
#                                       (text, never a control)
#     article.pillar-card#pillar-N[data-pillar][data-pillar-number]  N = 1..4
#       h3 > button.pillar-toggle#pillar-N-toggle[aria-expanded][aria-controls=pillar-N-panel]
#       div.pillar-panel#pillar-N-panel role, includes, topic tags, counts,
#                                       archive links, selected outputs

# The umbrella identity explains how the four pillars relate. It is text only:
# never a fifth pillar, control or filter value.
pillar_umbrella <- "Translational physician-scientist for public health"

# Archive pages and their card-id prefixes (templates/*.ejs.md: cards are
# publication-<slug> and talk-<slug>).
pillar_archives <- list(
  publications = list(base = "/publications/", card = "publication", nouns = c("publication", "publications")),
  talks = list(base = "/talks/", card = "talk", nouns = c("talk", "talks"))
)

# Characters JavaScript's encodeURIComponent leaves as they are.
uri_component_safe <- utf8ToInt(paste0(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "-_.!~*'()"
))

# The same encoding as JavaScript's encodeURIComponent: UTF-8 bytes, each
# outside the safe set written as %XX (upper-case hex).
encode_uri_component <- function(x) {
  vapply(enc2utf8(as.character(x)), function(value) {
    bytes <- as.integer(charToRaw(value))
    safe <- bytes %in% uri_component_safe
    encoded <- sprintf("%%%02X", bytes)
    encoded[safe] <- intToUtf8(bytes[safe], multiple = TRUE)
    paste(encoded, collapse = "")
  }, character(1), USE.NAMES = FALSE)
}

# A pillar's archive link: every record with the pillar as primary or
# secondary, foundational work included, so the archive lists exactly `any`
# records. The query keys are the archives' (js/filter-core.js); pillarHref()
# in js/pillars.js builds the same link.
pillar_archive_href <- function(base, pillar) {
  paste0(base, "?pillar=", encode_uri_component(pillar), "&foundational=include")
}

# A record's card on its archive page, with foundational work included so
# that the card is shown even when the record is foundational.
record_card_href <- function(kind, slug) {
  archive <- pillar_archives[[kind]]
  paste0(archive$base, "?foundational=include#", archive$card, "-", encode_uri_component(slug))
}

# The final HTML goes into a raw-HTML block of Quarto markdown. Quarto expands
# {{< shortcodes >}} even inside raw blocks, and a line of backticks would end
# the block, so braces and backticks become character references. (The
# component's own markup uses neither.)
protect_raw_html <- function(html) {
  html <- gsub("`", "&#96;", html, fixed = TRUE)
  html <- gsub("{", "&#123;", html, fixed = TRUE)
  gsub("}", "&#125;", html, fixed = TRUE)
}

stop_pillars <- function(...) stop(paste0("pillar component: ", ...), call. = FALSE)

is_copy_text <- function(x) is.character(x) && length(x) == 1 && !is.na(x) && nzchar(trimws(x))

# data/pillar-copy.yml: exactly the configured pillars, in order, each with a
# nonempty `role` and `includes`.
read_pillar_copy <- function(path, pillars = site_config$pillars) {
  copy <- yaml::read_yaml(path)
  if (!identical(names(copy), pillars)) {
    stop_pillars(path, " must have exactly the four configured pillars as keys, in canonical order")
  }
  for (pillar in pillars) {
    entry <- copy[[pillar]]
    if (!identical(names(entry), c("role", "includes")) || !is_copy_text(entry$role) || !is_copy_text(entry$includes)) {
      stop_pillars(path, ": '", pillar, "' needs a nonempty role and includes, and nothing else")
    }
  }
  copy
}

# Reads the generated data and the copy from the project root.
read_pillar_inputs <- function(root) {
  generated <- file.path(root, "data", "generated")
  files <- c(summary = "pillars.json", publications = "publications.yml", talks = "talks.yml")
  missing <- files[!file.exists(file.path(generated, files))]
  if (length(missing) > 0) {
    stop_pillars(
      "missing data/generated/", paste(missing, collapse = ", "),
      ". Run `npm run data:fixture` (or the live data build) first."
    )
  }
  list(
    summary = jsonlite::read_json(file.path(generated, files[["summary"]])),
    publications = yaml::read_yaml(file.path(generated, files[["publications"]])),
    talks = yaml::read_yaml(file.path(generated, files[["talks"]])),
    copy = read_pillar_copy(file.path(root, "data", "pillar-copy.yml"))
  )
}

pillar_noun <- function(n, nouns) if (identical(as.integer(n), 1L)) nouns[[1]] else nouns[[2]]

# One kind's line in the evidence list: the primary-pillar count, and the
# archive link, whose text states how many records it lists (`any`).
pillar_evidence <- function(kind, pillar, number, entry) {
  archive <- pillar_archives[[kind]]
  label <- if (kind == "publications") "Publications" else "Talks"
  htmltools::tags$div(
    class = "pillar-fact", `data-pillar-kind` = kind,
    htmltools::tags$dt(label),
    htmltools::tags$dd(
      htmltools::tags$span(class = "pillar-primary-count", `data-primary-count` = NA, entry$primary),
      " with this as primary pillar"
    ),
    htmltools::tags$dd(htmltools::tags$a(
      class = "pillar-archive-link", `data-pillar-archive` = kind,
      href = pillar_archive_href(archive$base, pillar),
      sprintf("View %d %s in Pillar %d", entry$any, pillar_noun(entry$any, archive$nouns), number)
    ))
  )
}

# Up to three selected outputs of one kind, linked to their archive cards.
# Secondary-pillar records (the last representative_secondary keys) are
# labelled as such.
pillar_outputs <- function(kind, entry, records, number) {
  archive <- pillar_archives[[kind]]
  heading <- if (kind == "publications") "Selected publications" else "Selected talks"
  keys <- as.character(unlist(entry$representative))
  secondary <- entry$representative_secondary
  if (!is.numeric(secondary) || length(secondary) != 1 || secondary < 0 || secondary > length(keys)) {
    stop_pillars("pillar ", number, " ", kind, ": representative_secondary must be 0 to ", length(keys))
  }
  items <- lapply(seq_along(keys), function(i) {
    record <- records[[keys[[i]]]]
    if (is.null(record)) stop_pillars("pillar ", number, " ", kind, ": representative key '", keys[[i]], "' is not a public record")
    htmltools::tags$li(
      class = "pillar-output", `data-key` = record$key,
      htmltools::tags$a(href = record_card_href(kind, record$slug), record$title),
      htmltools::tags$span(class = "pillar-output-year", record$year),
      if (i > length(keys) - secondary) {
        htmltools::tags$span(class = "pillar-output-secondary", "also tagged (secondary pillar)")
      }
    )
  })
  htmltools::tagList(
    htmltools::tags$h4(class = "pillar-subheading no-anchor", heading),
    if (length(items) > 0) {
      htmltools::tags$ul(class = "pillar-outputs", `data-pillar-outputs` = kind, items)
    } else {
      htmltools::tags$p(class = "pillar-none", `data-pillar-outputs` = kind, sprintf("No public %s in this pillar yet.", archive$nouns[[2]]))
    }
  )
}

pillar_card <- function(pillar, number, entry, copy, records) {
  id <- paste0("pillar-", number)
  topic_tags <- as.character(unlist(entry$topic_tags))
  htmltools::tags$article(
    class = paste0("pillar-card pillar-card-", number), id = id,
    `aria-labelledby` = paste0(id, "-toggle"),
    `data-pillar` = pillar, `data-pillar-number` = number,
    # Headings are "no-anchor": Quarto would otherwise add "#" links to them.
    htmltools::tags$h3(
      class = "pillar-heading no-anchor",
      # Expanded in the static page, where every panel is shown;
      # js/pillars.js collapses them and makes the buttons work.
      htmltools::tags$button(
        type = "button", class = "pillar-toggle", id = paste0(id, "-toggle"),
        `aria-expanded` = "true", `aria-controls` = paste0(id, "-panel"),
        `aria-describedby` = paste0(id, "-role"),
        htmltools::tags$span(
          class = paste0("pillar-badge pillar-", number),
          htmltools::tags$span(class = "visually-hidden", "Pillar ", .noWS = "after"), number,
          .noWS = "inside"
        ),
        htmltools::tags$span(class = "pillar-toggle-name", pillar),
        htmltools::tags$span(class = "pillar-toggle-state", `aria-hidden` = "true")
      )
    ),
    htmltools::tags$div(
      class = "pillar-panel", id = paste0(id, "-panel"),
      htmltools::tags$p(
        class = "pillar-role", id = paste0(id, "-role"),
        htmltools::tags$span(class = "pillar-label", "Role:"), copy$role
      ),
      htmltools::tags$p(
        class = "pillar-includes",
        htmltools::tags$span(class = "pillar-label", "Includes:"), copy$includes
      ),
      htmltools::tags$dl(
        class = "pillar-facts",
        if (length(topic_tags) > 0) {
          htmltools::tags$div(
            class = "pillar-fact pillar-topics",
            htmltools::tags$dt("Topic tags"),
            htmltools::tags$dd(htmltools::tags$ul(class = "record-tags", lapply(topic_tags, htmltools::tags$li)))
          )
        },
        pillar_evidence("publications", pillar, number, entry$publications),
        pillar_evidence("talks", pillar, number, entry$talks)
      ),
      htmltools::tags$p(
        class = "pillar-note",
        "The archive links list every public record with this as its primary or secondary pillar, foundational work included."
      ),
      pillar_outputs("publications", entry$publications, records$publications, number),
      pillar_outputs("talks", entry$talks, records$talks, number)
    )
  )
}

# The component's HTML. `summary` is pillars.json; `publications` and
# `talks` are the archive records (lists, as read from the YAML); `copy` is
# data/pillar-copy.yml.
pillar_component_html <- function(summary, publications, talks, copy, pillars = site_config$pillars) {
  if (!identical(names(summary), pillars)) {
    stop_pillars("pillars.json must have exactly the four configured pillars, in canonical order")
  }
  if (!identical(names(copy), pillars)) {
    stop_pillars("the pillar copy must have exactly the four configured pillars, in canonical order")
  }
  by_key <- function(records) stats::setNames(records, vapply(records, function(r) r$key, character(1)))
  records <- list(publications = by_key(publications), talks = by_key(talks))

  cards <- lapply(seq_along(pillars), function(i) {
    if (!identical(as.integer(summary[[i]]$number), i)) stop_pillars("pillar '", pillars[[i]], "' must be number ", i)
    pillar_card(pillars[[i]], i, summary[[i]], copy[[i]], records)
  })
  component <- htmltools::tags$section(
    class = "pillar-component", id = "research-pillars",
    `aria-labelledby` = "research-pillars-heading", `data-pillar-component` = NA,
    htmltools::tags$div(
      class = "pillar-hub",
      htmltools::tags$p(class = "pillar-hub-kicker", "Umbrella identity"),
      htmltools::tags$h2(
        class = "pillar-umbrella no-anchor",
        htmltools::tags$span(id = "research-pillars-heading", pillar_umbrella),
        .noWS = "inside"
      ),
      htmltools::tags$p(
        class = "pillar-hub-text",
        "Four numbered research pillars organize the work. Each publication and talk has one primary pillar and may also be tagged with a secondary pillar."
      ),
      htmltools::tags$p(class = "pillar-hint", "Select a pillar to show its role, topics, public evidence and archive links.")
    ),
    cards
  )
  protect_raw_html(as.character(component))
}

# The component as a raw-HTML block of Quarto markdown (for a chunk with
# results: asis), from the data under the project root `root`.
pillar_component_block <- function(root) {
  inputs <- read_pillar_inputs(root)
  paste0("```{=html}\n", do.call(pillar_component_html, inputs), "\n```\n")
}
