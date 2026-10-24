# Content of the Home, About and CV pages that comes from data, rendered to
# static HTML at build time (functions only; the pages call them from small
# R chunks):
#   - identity, affiliations, headshot and profile links from data/site.yml;
#   - "Selected work" and the reach summary from the public generated data
#     (data/generated/publications.yml and talks.yml, the records the
#     archives list), never from hand-typed bibliographic text;
#   - the CV download, only when the approved PDF exists at build time.
#
# Uses encode_uri_component(), protect_raw_html(), raw_html_block() and
# read_yaml_utf8() from R/pillar_cards.R. Markup is built with htmltools tags,
# which escape every text child and attribute value (htmltools::htmlEscape);
# protect_raw_html() then escapes backticks and braces, so spreadsheet text
# cannot close the raw-HTML fence or become a Quarto shortcode.

stop_site <- function(...) stop(paste0("site content: ", ...), call. = FALSE)

# data/site.yml: its keys, and the profile links in display order.
site_keys <- c(
  "name", "umbrella", "position", "training_context", "affiliations",
  "headshot", "profiles", "cv_pdf", "cv_updated"
)
site_profiles <- list(
  github = list(label = "GitHub"),
  orcid = list(label = "ORCID"),
  linkedin = list(label = "LinkedIn")
)

# Selected work: at most this many publications and this many talks.
selected_limit <- 3L

is_site_text <- function(x) is.character(x) && length(x) == 1 && !is.na(x) && nzchar(trimws(x))

is_iso_date <- function(x) {
  is_site_text(x) && grepl("^\\d{4}-\\d{2}-\\d{2}$", x) &&
    identical(format(as.Date(x, format = "%Y-%m-%d")), x)
}

# Reads and checks data/site.yml: exactly the documented keys (so nothing
# such as a phone number or an email address can be added unnoticed), every
# text value nonempty, https profile links, and a CV path inside
# assets/documents/.
read_site_config <- function(path) {
  site <- read_yaml_utf8(path)
  if (!is.list(site) || !setequal(names(site), site_keys) || length(site) != length(site_keys)) {
    stop_site(path, " must have exactly the keys ", paste(site_keys, collapse = ", "))
  }
  for (key in c("name", "umbrella", "position", "training_context")) {
    if (!is_site_text(site[[key]])) stop_site(path, ": '", key, "' must be nonempty text")
  }
  if (!is.list(site$affiliations) || length(site$affiliations) == 0) {
    stop_site(path, ": 'affiliations' must list at least one current role")
  }
  for (entry in site$affiliations) {
    fields <- names(entry)
    if (!is.list(entry) || !("title" %in% fields) || !all(fields %in% c("title", "organization")) ||
      !all(vapply(entry, is_site_text, logical(1)))) {
      stop_site(path, ": each affiliation needs a nonempty 'title' and may have an 'organization', nothing else")
    }
  }
  headshot <- site$headshot
  if (!is.list(headshot) || !setequal(names(headshot), c("src", "alt", "width", "height")) ||
    !is_site_text(headshot$src) || grepl("^[a-z]+:|^/|\\.\\.", headshot$src) || !is_site_text(headshot$alt) ||
    !all(vapply(headshot[c("width", "height")], function(v) is.numeric(v) && length(v) == 1 && v > 0, logical(1)))) {
    stop_site(path, ": 'headshot' needs a project-relative src, nonempty alt text and a positive width and height")
  }
  if (!identical(names(site$profiles), names(site_profiles))) {
    stop_site(path, ": 'profiles' must be exactly ", paste(names(site_profiles), collapse = ", "), ", in that order")
  }
  for (key in names(site_profiles)) {
    if (!is_site_text(site$profiles[[key]]) || !grepl("^https://[^[:space:]]+$", site$profiles[[key]])) {
      stop_site(path, ": profile '", key, "' must be an https:// URL")
    }
  }
  if (!is_site_text(site$cv_pdf) || !grepl("^assets/documents/[A-Za-z0-9._-]+[.]pdf$", site$cv_pdf)) {
    stop_site(path, ": 'cv_pdf' must be a .pdf file name in assets/documents/")
  }
  if (!is.null(site$cv_updated) && !is_iso_date(site$cv_updated)) {
    stop_site(path, ": 'cv_updated' must be empty (~) or a date written YYYY-MM-DD")
  }
  site
}

site_config_path <- function(root) file.path(root, "data", "site.yml")

# The public records the archives list, read from the project root.
read_public_records <- function(root) {
  generated <- file.path(root, "data", "generated")
  files <- c(publications = "publications.yml", talks = "talks.yml")
  missing <- files[!file.exists(file.path(generated, files))]
  if (length(missing) > 0) {
    stop_site(
      "missing data/generated/", paste(missing, collapse = ", "),
      ". Run `npm run data:fixture` (or the live data build) first."
    )
  }
  list(
    publications = read_yaml_utf8(file.path(generated, files[["publications"]])) %||% list(),
    talks = read_yaml_utf8(file.path(generated, files[["talks"]])) %||% list()
  )
}

# ---- Selected work and reach ---------------------------------------------

# Up to `limit` records for "Selected work": foundational work is left out
# (fewer are shown rather than filling with it); featured records ("Y") come
# first, then the rest; each group keeps the archive order (newest first), so
# the order is the archives' own.
select_records <- function(records, limit = selected_limit) {
  eligible <- Filter(function(record) !identical(record$foundational_work, "Y"), records)
  featured <- vapply(eligible, function(record) identical(record$featured, "Y"), logical(1))
  utils::head(c(eligible[featured], eligible[!featured]), limit)
}

# Distinct documented values of one field: missing, empty and blank values
# are not counted, and values are compared after trimming. (The exporter
# already trims values and drops blank ones, so this equals the Talks page's
# counts: templates/talk.ejs.md and summarizeReach in js/filter-core.js.)
documented_values <- function(records, field) {
  values <- trimws(as.character(unlist(lapply(records, function(record) record[[field]]))))
  unique(values[!is.na(values) & nzchar(values)])
}

# Reach over every public talk, foundational work included: the number of
# talks and of documented hosting countries and institutions. A virtual talk
# counts at its host. Never an audience figure.
talk_reach <- function(talks) {
  list(
    presentations = length(talks),
    countries = length(documented_values(talks, "location_country")),
    hosts = length(documented_values(talks, "organization"))
  )
}

# Inline content: text (escaped) and tags joined as they are, without the
# line breaks htmltools puts between children (they would show as a space
# before a comma). NULL parts are skipped.
inline <- function(...) {
  parts <- Filter(Negate(is.null), list(...))
  htmltools::HTML(paste(vapply(parts, function(part) {
    if (is.character(part)) htmltools::htmlEscape(part) else as.character(part)
  }, character(1)), collapse = ""))
}

noun_for <- function(n, one, many) if (identical(as.integer(n), 1L)) one else many

# "14 Sep 2025", as the talk archive writes dates (templates/talk.ejs.md);
# month.abb and month.name are English in every locale.
short_date <- function(iso) {
  date <- as.Date(iso, format = "%Y-%m-%d")
  paste(as.integer(format(date, "%d")), month.abb[as.integer(format(date, "%m"))], format(date, "%Y"))
}
long_date <- function(iso) {
  date <- as.Date(iso, format = "%Y-%m-%d")
  paste(as.integer(format(date, "%d")), month.name[as.integer(format(date, "%m"))], format(date, "%Y"))
}

# Archive cards (templates/*.ejs.md): publication-<slug> and talk-<slug>.
# Selected work is never foundational, so the default archive view shows it.
selected_href <- function(kind, slug) {
  archive <- pillar_archives[[kind]]
  paste0(archive$base, "#", archive$card, "-", encode_uri_component(slug))
}

selected_publication <- function(record) {
  published <- identical(record$status, "Published")
  htmltools::tags$li(
    class = "selected-item", `data-key` = record$key,
    htmltools::tags$p(
      class = "record-kicker",
      # The exact status text; anything but Published gets the dashed
      # outline badge, so "In Review" never looks published.
      htmltools::tags$span(
        class = paste("status-badge", if (published) "status-published" else "status-not-published"),
        `data-status` = record$status, record$status
      ),
      htmltools::tags$span(class = "record-year", record$year)
    ),
    htmltools::tags$a(class = "selected-title", href = selected_href("publications", record$slug), record$title),
    htmltools::tags$p(class = "selected-meta", htmltools::tags$cite(record$journal))
  )
}

selected_talk <- function(record) {
  place <- record$location_display
  # As on the talk card (templates/talk.ejs.md): a virtual talk reads
  # "Virtual -- hosted by <host>, <place>" (an em dash) and is never
  # presented as travel.
  virtual <- identical(record$virtual_status, "Y")
  where <- htmltools::tags$p(
    class = "selected-meta talk-location",
    inline(
      if (virtual) htmltools::tags$span(class = "virtual-badge", "Virtual"),
      if (virtual) " \u2014 hosted by ",
      htmltools::tags$span(class = "talk-host", record$organization),
      if (!is.null(place)) ", ",
      if (!is.null(place)) htmltools::tags$span(class = "talk-place", place)
    )
  )
  htmltools::tags$li(
    class = "selected-item", `data-key` = record$key,
    htmltools::tags$p(
      class = "record-kicker",
      htmltools::tags$time(class = "record-date", datetime = record$date, short_date(record$date)),
      htmltools::tags$span(class = "selected-type", record$type)
    ),
    htmltools::tags$a(class = "selected-title", href = selected_href("talks", record$slug), record$title),
    where
  )
}

selected_group <- function(kind, records) {
  heading <- if (kind == "publications") "Publications" else "Talks"
  item <- if (kind == "publications") selected_publication else selected_talk
  noun <- pillar_archives[[kind]]$nouns[[2]]
  id <- paste0("selected-", kind, "-heading")
  # A section without an accessible name, so not a region landmark of its
  # own inside the Selected work region (no nested landmarks).
  htmltools::tags$section(
    class = "selected-group", `data-selected-kind` = kind,
    htmltools::tags$h3(class = "selected-heading no-anchor", id = id, heading),
    if (length(records) > 0) {
      htmltools::tags$ul(class = "selected-list", lapply(records, item))
    } else {
      htmltools::tags$p(class = "selected-none", sprintf("No %s to feature yet.", noun))
    },
    htmltools::tags$p(
      class = "selected-more",
      htmltools::tags$a(href = pillar_archives[[kind]]$base, sprintf("All %s", noun))
    )
  )
}

# "Selected work": up to three publications and up to three talks, chosen
# separately, each linked to its archive card.
selected_work_html <- function(publications, talks) {
  htmltools::tags$section(
    class = "selected-work", id = "selected-work", `aria-labelledby` = "selected-work-heading",
    htmltools::tags$h2(class = "no-anchor", id = "selected-work-heading", "Selected work"),
    htmltools::tags$p(
      class = "section-note",
      "From the public archives: featured work first, then the most recent. Foundational work is listed in the archives."
    ),
    htmltools::tags$div(
      class = "selected-groups",
      selected_group("publications", select_records(publications)),
      selected_group("talks", select_records(talks))
    )
  )
}

# The compact reach summary: documented hosting locations of every public
# talk, worded as places and institutions, never as an audience.
reach_summary_html <- function(talks) {
  reach <- talk_reach(talks)
  figure <- function(name, n) htmltools::tags$strong(`data-reach` = name, n)
  line <- if (reach$presentations == 0) {
    "No public talks are listed yet."
  } else {
    inline(
      "Across ",
      if (reach$countries > 0) figure("countries", reach$countries),
      if (reach$countries > 0) noun_for(reach$countries, " country and ", " countries and "),
      figure("hosts", reach$hosts),
      noun_for(reach$hosts, " hosting institution.", " hosting institutions.")
    )
  }
  htmltools::tags$section(
    class = "home-reach", id = "home-reach", `aria-labelledby` = "home-reach-heading",
    htmltools::tags$h2(class = "no-anchor", id = "home-reach-heading", "Talks and reach"),
    htmltools::tags$p(class = "home-reach-line", line),
    htmltools::tags$p(
      class = "section-note",
      # (No "all 0 public talks" when there are none.)
      if (reach$presentations == 0) {
        "Counted from the documented hosting locations of public talks, foundational work included. A virtual talk counts where its host is. These are not audience figures."
      } else {
        inline(
          "Counted from the documented hosting locations of all ",
          figure("presentations", reach$presentations),
          noun_for(reach$presentations, " public talk", " public talks"),
          ", foundational work included. A virtual talk counts where its host is. These are not audience figures."
        )
      }
    ),
    htmltools::tags$p(class = "selected-more", htmltools::tags$a(href = "/talks/", "All talks, with the map"))
  )
}

# ---- Identity, affiliations and profile links (data/site.yml) -------------

# The Home page's title block: name (the page's only h1), umbrella identity,
# training context and headshot. It is a header.quarto-title-block, so Quarto
# adds no title block of its own and leaves the h1 in place.
home_hero_html <- function(site) {
  headshot <- site$headshot
  htmltools::tags$header(
    class = "quarto-title-block home-hero-header",
    htmltools::tags$div(
      class = "home-identity",
      htmltools::tags$h1(class = "home-name no-anchor", site$name),
      htmltools::tags$p(class = "home-umbrella", site$umbrella),
      htmltools::tags$p(class = "home-training", site$training_context)
    ),
    htmltools::tags$img(
      class = "home-headshot", src = paste0("/", headshot$src), alt = headshot$alt,
      width = headshot$width, height = headshot$height
    )
  )
}

affiliation_items <- function(site) {
  lapply(site$affiliations, function(entry) {
    htmltools::tags$li(inline(
      htmltools::tags$span(class = "affiliation-title", entry$title),
      if (!is.null(entry$organization)) ", ",
      if (!is.null(entry$organization)) htmltools::tags$span(class = "affiliation-organization", entry$organization)
    ))
  })
}

affiliations_html <- function(site) {
  htmltools::tags$ul(class = "affiliation-list", affiliation_items(site))
}

profile_links_html <- function(site) {
  htmltools::tags$ul(
    class = "profile-links",
    lapply(names(site_profiles), function(key) {
      label <- site_profiles[[key]]$label
      htmltools::tags$li(htmltools::tags$a(
        href = site$profiles[[key]], `aria-label` = paste(site$name, "on", label), `data-profile` = key, label
      ))
    })
  )
}

# The end of the Home page: current affiliations, the CV and profile links.
home_connect_html <- function(site) {
  htmltools::tags$section(
    class = "home-connect", id = "home-connect", `aria-labelledby` = "home-connect-heading",
    htmltools::tags$h2(class = "no-anchor", id = "home-connect-heading", "Current affiliations and links"),
    affiliations_html(site),
    htmltools::tags$p(class = "selected-more", htmltools::tags$a(href = "/cv/", "Full CV")),
    profile_links_html(site)
  )
}

# ---- CV download -----------------------------------------------------------

# "245 KB" or "1.2 MB", rounding halves up (as JavaScript's Math.round).
file_size_text <- function(bytes) {
  if (bytes < 1024^2) {
    sprintf("%d KB", max(1L, as.integer(floor(bytes / 1024 + 0.5))))
  } else {
    sprintf("%.1f MB", floor(bytes / 1024^2 * 10 + 0.5) / 10)
  }
}

# The CV download, its size and its date, only when the approved PDF exists
# under `root`; otherwise an honest note and no link.
cv_download_html <- function(site, root) {
  pdf <- file.path(root, site$cv_pdf)
  if (!file.exists(pdf)) {
    return(htmltools::tags$div(
      class = "cv-download", `data-cv-pdf` = "absent",
      htmltools::tags$p(inline(
        "The CV is a PDF generated from the same spreadsheet as this site. A downloadable copy is not published here at the moment; the ",
        htmltools::tags$a(href = "/publications/", "Publications"), " and ",
        htmltools::tags$a(href = "/talks/", "Talks & Reach"),
        " pages list the public records from that spreadsheet."
      ))
    ))
  }
  if (is.null(site$cv_updated)) {
    stop_site("data/site.yml: set cv_updated (YYYY-MM-DD) to the date of ", site$cv_pdf)
  }
  htmltools::tags$div(
    class = "cv-download", `data-cv-pdf` = "present",
    htmltools::tags$p(
      class = "cv-download-link",
      htmltools::tags$a(
        href = paste0("/", site$cv_pdf), type = "application/pdf",
        inline("Download the CV ", htmltools::tags$span(class = "cv-file-hint", sprintf("(PDF, %s)", file_size_text(file.size(pdf)))))
      )
    ),
    htmltools::tags$p(
      class = "cv-updated",
      inline("Last updated: ", htmltools::tags$time(datetime = site$cv_updated, long_date(site$cv_updated)))
    )
  )
}

# ---- Quarto blocks (for chunks with results: asis) -------------------------

site_block <- function(tag) raw_html_block(protect_raw_html(as.character(tag)))

home_hero_block <- function(root) site_block(home_hero_html(read_site_config(site_config_path(root))))

home_evidence_block <- function(root) {
  records <- read_public_records(root)
  site_block(htmltools::tagList(
    selected_work_html(records$publications, records$talks),
    reach_summary_html(records$talks)
  ))
}

home_connect_block <- function(root) site_block(home_connect_html(read_site_config(site_config_path(root))))

about_affiliations_block <- function(root) site_block(affiliations_html(read_site_config(site_config_path(root))))

profile_links_block <- function(root) site_block(profile_links_html(read_site_config(site_config_path(root))))

cv_download_block <- function(root) site_block(cv_download_html(read_site_config(site_config_path(root)), root))
