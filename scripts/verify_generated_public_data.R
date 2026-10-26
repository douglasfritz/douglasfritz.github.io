#!/usr/bin/env Rscript
# Final check of the public output, after `quarto render` and the tests and
# before the site is published (.github/workflows/publish.yml):
# - the five files in data/generated/ parse as UTF-8 YAML/JSON, with public
#   publications and talks whose counts match build-metadata.json, unique
#   keys, the exact-"Y" inclusion rule recorded, exactly the four pillars,
#   and map features that are public talks at their [lon, lat] points;
# - no generated record has a field named phone, email, cv_include, markdown
#   or website_include, and no link field is a mailto: or tel: link;
# - no file under data/generated/ and no text file under _site/ contains
#   "cv_include", a Google Sheets link or the source sheet's ID;
# - no page links to a mailto: or tel: address or asks not to be indexed;
# - every route exists with exactly one skip link, the search index does not
#   contain the skip link's text, and robots.txt and sitemap.xml are in place.
#
# Usage, from anywhere: Rscript scripts/verify_generated_public_data.R
# Lists every problem (by file, record key and field; never other record
# content) and exits 1, or prints a short summary and exits 0. A check that
# cannot run (an unreadable file, unexpected structure) is one more problem;
# it never hides the others. tests/testthat/test-verify-public-data.R sources
# the functions below.

site_url <- "https://douglasfritz.github.io/"
routes <- c("index.html", file.path(c("research", "publications", "talks", "about", "cv"), "index.html"))
generated_files <- c("publications.yml", "talks.yml", "talks.geojson", "pillars.json", "build-metadata.json")
inclusion_rule <- "website_include == 'Y'"
forbidden_fields <- c("phone", "email", "cv_include", "markdown", "website_include")
# Never scanned as text. Any other file that contains a NUL byte is skipped too.
binary_extensions <- c("png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "pdf", "woff", "woff2", "ttf", "otf", "eot", "zip", "gz")

# Repository root: one level above this script when run with Rscript.
verify_root <- function() {
  file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (!length(file_arg)) return(getwd())
  dirname(dirname(normalizePath(sub("^--file=", "", file_arg[[1]]))))
}

# Runs one check; an error in it becomes one more problem, about `what`.
attempt <- function(what, issue, expr) {
  tryCatch(expr, error = function(e) {
    issue(sprintf("%s: could not be checked (%s)", what, conditionMessage(e)))
    NULL
  })
}

read_bytes <- function(path) readBin(path, "raw", file.size(path))

# A file's text; an error if it is not valid UTF-8.
read_utf8 <- function(path) {
  bytes <- read_bytes(path)
  if (any(bytes == as.raw(0))) stop("contains a NUL byte", call. = FALSE)
  text <- rawToChar(bytes)
  Encoding(text) <- "UTF-8"
  if (!validUTF8(text)) stop("is not valid UTF-8", call. = FALSE)
  text
}

regex_escape <- function(x) gsub("([][{}()+*^$|\\\\?.])", "\\\\\\1", x)

count_fixed <- function(pattern, text) {
  sum(gregexpr(pattern, text, fixed = TRUE, useBytes = TRUE)[[1]] > 0)
}

# Every key in a parsed tree, as its path ("a/b/name").
tree_fields <- function(x, path = character()) {
  if (!is.list(x)) return(character())
  keys <- names(x) %||% rep("", length(x))
  unlist(lapply(seq_along(x), function(i) {
    here <- c(path, if (nzchar(keys[[i]])) keys[[i]] else sprintf("[%d]", i))
    c(if (nzchar(keys[[i]])) paste(here, collapse = "/"), tree_fields(x[[i]], here))
  }), use.names = FALSE)
}

forbidden_paths <- function(x) {
  paths <- tree_fields(x)
  paths[tolower(basename(paths)) %in% forbidden_fields]
}

record_keys <- function(records) {
  vapply(seq_along(records), function(i) {
    key <- records[[i]]$key
    if (is.character(key) && length(key) == 1 && nzchar(key)) key else sprintf("#%d (no key)", i)
  }, character(1))
}

# The keys of a parsed list of public records (publications or talks), after
# reporting its problems; NULL if it is not a list of records. Only the link
# fields of R/config.R (`link_fields`) are checked for mailto: and tel: links:
# a title or summary may start with any word.
check_records <- function(records, file, link_fields, issue) {
  if (!is.list(records) || !is.null(names(records)) || !all(vapply(records, is.list, logical(1)))) {
    issue(sprintf("%s: is not a list of records", file))
    return(NULL)
  }
  if (length(records) == 0) issue(sprintf("%s: has no records (the site must never be published empty)", file))
  keys <- record_keys(records)
  for (key in unique(keys[duplicated(keys)])) {
    issue(sprintf("%s: key '%s' appears %d times", file, key, sum(keys == key)))
  }
  for (i in seq_along(records)) {
    for (field in forbidden_paths(records[[i]])) {
      issue(sprintf("%s: record '%s' has a field named '%s'", file, keys[[i]], field))
    }
    for (field in intersect(link_fields, names(records[[i]]))) {
      value <- records[[i]][[field]]
      if (is.character(value) && any(grepl("^\\s*(mailto|tel):", value, ignore.case = TRUE))) {
        issue(sprintf("%s: record '%s' field '%s' is a mailto: or tel: link (the site lists no email address or phone number)", file, keys[[i]], field))
      }
    }
  }
  keys
}

valid_point <- function(coordinates) {
  is.numeric(coordinates) && length(coordinates) == 2 && all(is.finite(coordinates)) &&
    abs(coordinates[[1]]) <= 180 && abs(coordinates[[2]]) <= 90
}

# Returns the number of features. `talks` is NULL when talks.yml could not be
# read: the features are then checked on their own, not against the talks.
check_geojson <- function(geojson, talks, file, issue) {
  if (!is.list(geojson) || !identical(geojson$type, "FeatureCollection") || !is.list(geojson$features)) {
    issue(sprintf("%s: is not a GeoJSON FeatureCollection", file))
    return(NA_integer_)
  }
  if (!is.null(talks)) talks <- stats::setNames(talks, record_keys(talks))
  keys <- character()
  for (i in seq_along(geojson$features)) {
    feature <- geojson$features[[i]]
    if (!is.list(feature)) feature <- list()
    properties <- if (is.list(feature$properties)) feature$properties else list()
    key <- properties$key
    if (!is.character(key) || length(key) != 1 || (!is.null(talks) && !key %in% names(talks))) {
      issue(sprintf("%s: feature #%d is not a public talk", file, i))
      next
    }
    keys <- c(keys, key)
    geometry <- if (is.list(feature$geometry)) feature$geometry else list()
    coordinates <- unlist(geometry$coordinates)
    if (!identical(geometry$type, "Point") || !valid_point(coordinates)) {
      issue(sprintf("%s: feature '%s' is not a valid [lon, lat] point", file, key))
    } else if (!is.null(talks) && !isTRUE(all.equal(coordinates, c(talks[[key]]$longitude, talks[[key]]$latitude)))) {
      issue(sprintf("%s: feature '%s' is not at [longitude, latitude] of that talk in talks.yml", file, key))
    }
  }
  for (key in unique(keys[duplicated(keys)])) {
    issue(sprintf("%s: talk '%s' has more than one feature", file, key))
  }
  length(geojson$features)
}

# Problems with the five files in data/generated/; returns counts for the summary.
check_generated <- function(root, issue) {
  rel <- function(file) file.path("data", "generated", file)
  parsed <- list()
  for (file in generated_files) {
    path <- file.path(root, rel(file))
    if (!file.exists(path)) {
      issue(sprintf("%s: missing (run scripts/build_data.R first)", rel(file)))
      next
    }
    text <- tryCatch(read_utf8(path), error = function(e) {
      issue(sprintf("%s: %s", rel(file), conditionMessage(e)))
      NULL
    })
    if (is.null(text)) next
    # Parser messages can quote the file's content: only the position is kept.
    parsed[file] <- list(tryCatch(
      if (grepl("[.]yml$", file)) yaml::yaml.load(text) else jsonlite::fromJSON(text, simplifyVector = FALSE),
      error = function(e) {
        where <- regmatches(conditionMessage(e), regexpr("line [0-9]+(, column [0-9]+)?", conditionMessage(e)))
        issue(sprintf("%s: cannot be parsed%s", rel(file), if (length(where)) paste0(" (error at ", where, ")") else ""))
        NULL
      }
    ))
  }

  counts <- c(publications = NA_integer_, talks = NA_integer_)
  talks <- NULL
  for (kind in names(counts)) {
    file <- paste0(kind, ".yml")
    if (is.null(parsed[[file]])) next
    keys <- attempt(rel(file), issue, check_records(parsed[[file]], rel(file), site_config$url_fields[[kind]], issue))
    if (is.null(keys)) next
    counts[[kind]] <- length(parsed[[file]])
    if (kind == "talks") talks <- parsed[[file]]
  }

  metadata <- parsed[["build-metadata.json"]]
  if (!is.null(metadata)) attempt(rel("build-metadata.json"), issue, {
    if (!is.list(metadata) || !identical(metadata$inclusion_rule, inclusion_rule)) {
      issue(sprintf("%s: inclusion_rule is not \"%s\"", rel("build-metadata.json"), inclusion_rule))
    }
    for (kind in names(counts)) {
      recorded <- if (is.list(metadata) && is.list(metadata$public_rows)) metadata$public_rows[[kind]]
      if (!is.na(counts[[kind]]) && !identical(as.integer(recorded), counts[[kind]])) {
        issue(sprintf("%s: public_rows.%s does not match the %d records in %s.yml", rel("build-metadata.json"), kind, counts[[kind]], kind))
      }
    }
  })

  pillars <- parsed[["pillars.json"]]
  if (!is.null(pillars) && !identical(names(pillars), site_config$pillars)) {
    issue(sprintf("%s: its keys must be exactly the four pillars of R/config.R, in order", rel("pillars.json")))
  }

  mapped <- NA_integer_
  if (!is.null(parsed[["talks.geojson"]])) {
    mapped <- attempt(rel("talks.geojson"), issue, check_geojson(parsed[["talks.geojson"]], talks, rel("talks.geojson"), issue))
  }

  # Field names in the files that are not lists of records.
  for (file in c("talks.geojson", "pillars.json", "build-metadata.json")) {
    attempt(rel(file), issue, for (field in forbidden_paths(parsed[[file]])) {
      issue(sprintf("%s: has a field named '%s'", rel(file), field))
    })
  }

  list(counts = counts, mapped = mapped %||% NA_integer_, pillars = length(pillars))
}

# Problems in the text of every file under data/generated/ and _site/;
# returns how many files were scanned and skipped.
check_text_files <- function(root, issue) {
  forbidden <- c(
    "the string 'cv_include'" = "cv_include",
    "a Google Sheets link (docs.google.com/spreadsheets)" = "docs.google.com/spreadsheets",
    "the source sheet's ID" = site_config$sheet_id
  )
  files <- unlist(lapply(c(file.path("data", "generated"), "_site"), function(dir) {
    file.path(dir, list.files(file.path(root, dir), recursive = TRUE, all.files = TRUE))
  }))
  scanned <- 0L
  for (file in files) attempt(file, issue, {
    bytes <- if (!tolower(tools::file_ext(file)) %in% binary_extensions) read_bytes(file.path(root, file))
    if (!is.null(bytes) && !any(bytes == as.raw(0))) {
      scanned <- scanned + 1L
      check_text(file, rawToChar(bytes), forbidden, issue)
    }
  })
  c(scanned = scanned, skipped = length(files) - scanned)
}

# Problems in the text of one file (`file`, relative to the root).
check_text <- function(file, text, forbidden, issue) {
  for (what in names(forbidden)) {
    if (grepl(regex_escape(forbidden[[what]]), text, ignore.case = TRUE, useBytes = TRUE)) {
      issue(sprintf("%s: contains %s", file, what))
    }
  }
  if (grepl("[.]html?$", file)) {
    if (grepl("href\\s*=\\s*[\"']?\\s*(mailto|tel):", text, ignore.case = TRUE, perl = TRUE, useBytes = TRUE)) {
      issue(sprintf("%s: links to a mailto: or tel: address (the site lists no email address or phone number)", file))
    }
    if (grepl("<meta\\b[^>]*\\bnoindex\\b", text, ignore.case = TRUE, perl = TRUE, useBytes = TRUE)) {
      issue(sprintf("%s: asks search engines not to index it (noindex)", file))
    }
  }
}

# Problems with the rendered routes, the search index, robots.txt and the sitemap.
check_site <- function(root, issue) {
  site <- file.path(root, "_site")
  link <- attempt("includes/skip-link.html", issue, read_skip_link(file.path(root, "includes", "skip-link.html")))
  for (route in routes) attempt(file.path("_site", route), issue, {
    if (!file.exists(file.path(site, route))) {
      issue(sprintf("_site/%s: missing", route))
    } else {
      html <- rawToChar(read_bytes(file.path(site, route)))
      any_class <- lengths(regmatches(html, gregexpr("class=[\"'][^\"']*\\bskip-link\\b", html, perl = TRUE, useBytes = TRUE)))
      exact <- if (is.null(link)) any_class else count_fixed(link, html)
      if (exact != 1 || any_class != 1) {
        issue(sprintf("_site/%s: expected exactly one skip link; found %d as in includes/skip-link.html and %d elements of class skip-link", route, exact, any_class))
      }
    }
  })

  attempt("_site/search.json", issue, {
    search <- file.path(site, "search.json")
    if (!file.exists(search)) {
      issue("_site/search.json: missing (site search is on)")
    } else if (!is.null(link)) {
      link_text <- sub("^<a [^>]*>([^<]*)</a>$", "\\1", link)
      if (count_fixed(link_text, rawToChar(read_bytes(search))) > 0) {
        issue(sprintf("_site/search.json: contains the skip link's text \"%s\"", link_text))
      }
    }
  })

  attempt("_site/robots.txt", issue, {
    robots <- file.path(site, "robots.txt")
    if (!file.exists(robots)) {
      issue("_site/robots.txt: missing")
    } else {
      lines <- trimws(readLines(robots, warn = FALSE, encoding = "UTF-8"))
      if (!any(grepl(paste0("^sitemap:\\s*", regex_escape(site_url), "sitemap[.]xml$"), lines, ignore.case = TRUE))) {
        issue(sprintf("_site/robots.txt: does not point to %ssitemap.xml", site_url))
      }
      if (any(grepl("^disallow:\\s*/\\s*$", lines, ignore.case = TRUE))) {
        issue("_site/robots.txt: disallows the whole site")
      }
    }
  })

  attempt("_site/sitemap.xml", issue, {
    sitemap <- file.path(site, "sitemap.xml")
    if (!file.exists(sitemap)) {
      issue("_site/sitemap.xml: missing")
    } else {
      xml <- rawToChar(read_bytes(sitemap))
      for (url in paste0(site_url, routes)) {
        listed <- c(url, sub("index[.]html$", "", url))
        if (!any(vapply(paste0("<loc>", listed, "</loc>"), count_fixed, numeric(1), text = xml) > 0)) {
          issue(sprintf("_site/sitemap.xml: does not list %s", url))
        }
      }
    }
  })
}

# Every problem with the output in `root` (`issues`, empty if none) and the
# figures for the summary.
public_output_issues <- function(root) {
  found <- character()
  issue <- function(message) found <<- c(found, message)
  data <- check_generated(root, issue)
  text <- check_text_files(root, issue)
  if (dir.exists(file.path(root, "_site"))) {
    check_site(root, issue)
  } else {
    issue("_site/: missing (run quarto render first)")
  }
  list(issues = found, data = data, text = text)
}

megabytes <- function(bytes) sprintf("%.1f MB", bytes / 1024^2)

# TRUE if the output in `root` passes every check; otherwise reports every
# problem and returns FALSE.
verify_public_output <- function(root) {
  result <- public_output_issues(root)
  found <- result$issues
  if (length(found)) {
    message(sprintf("ERROR: public output verification failed (%d problem%s):", length(found), if (length(found) == 1) "" else "s"))
    message(paste0("- ", found, collapse = "\n"))
    return(FALSE)
  }

  files <- list.files(file.path(root, "_site"), recursive = TRUE, all.files = TRUE)
  sizes <- file.size(file.path(root, "_site", files))
  cat(sprintf(
    paste0(
      "Public output verified: %d publications, %d talks (%d on the map), %d pillars; ",
      "%d routes with one skip link each; robots.txt and sitemap.xml in place; ",
      "%d text files scanned, %d binary files skipped.\n",
      "_site/ is %s in %d files (largest: %s, %s).\n"
    ),
    result$data$counts[["publications"]], result$data$counts[["talks"]], result$data$mapped, result$data$pillars,
    length(routes), result$text[["scanned"]], result$text[["skipped"]],
    megabytes(sum(sizes)), length(files), files[[which.max(sizes)]], megabytes(max(sizes))
  ))
  TRUE
}

if (sys.nframe() == 0L) {
  root <- verify_root()
  source(file.path(root, "R", "config.R"))
  source(file.path(root, "R", "skip_link.R"))
  ok <- tryCatch(verify_public_output(root), error = function(e) {
    message("ERROR: public output verification stopped: ", conditionMessage(e))
    FALSE
  })
  quit(save = "no", status = if (isTRUE(ok)) 0L else 1L)
}
