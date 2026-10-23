# Export of the public website datasets. Only exact-"Y" rows and explicitly
# allowlisted fields leave this file. The derived fields are slug, plus
# location_display for talks. Records are sorted deterministically. All five
# files are serialized before any is written, then installed together
# (write_public_data()).

publication_public_fields <- c(
  "key", "status", "author", "year", "title", "preprint_journal",
  "preprint_doi", "journal", "volume", "page_number", "doi_url",
  "category", "featured", "primary_pillar", "secondary_pillar",
  "topic_tags", "foundational_work", "plain_summary", "image"
)

talk_public_fields <- c(
  "key", "author", "title", "date", "year", "organization", "type",
  "location_city", "location_region", "location_country", "prize",
  "featured", "presented_by_me", "primary_pillar", "secondary_pillar",
  "topic_tags", "foundational_work", "latitude", "longitude",
  "virtual_status", "event_scope", "event_url", "slides_url",
  "poster_url", "recording_url", "short_description"
)

site_data_schema_version <- "1.0.0"

# Output files, in write order: build-metadata.json goes last.
site_data_files <- c(
  publications = "publications.yml",
  talks = "talks.yml",
  geojson = "talks.geojson",
  pillars = "pillars.json",
  metadata = "build-metadata.json"
)

# Display names of the sheet tabs, for build-metadata.json. The sheet ID and
# tab GIDs are never exported.
source_tab_names <- c(publications = "Journal Articles", talks = "Conferences")

# URL slugs: the lowercased key, with each run of characters other than a-z
# and 0-9 turned into one hyphen and edge hyphens removed. A slug must be
# nonempty and unique within its kind, or the build stops.
key_slugs <- function(keys, label) {
  slugs <- stringr::str_replace_all(tolower(keys), "[^a-z0-9]+", "-")
  slugs <- stringr::str_remove_all(slugs, "^-+|-+$")
  shared <- unique(slugs[duplicated(slugs) & nzchar(slugs)])
  abort_if_issues(prefix_issues(label, c(
    sprintf("key '%s' has no letters or digits for a URL slug", keys[!nzchar(slugs)]),
    vapply(shared, function(slug) {
      sprintf(
        "keys %s share the URL slug '%s'",
        paste0("'", keys[slugs == slug], "'", collapse = ", "), slug
      )
    }, character(1), USE.NAMES = FALSE)
  )))
  slugs
}

# Known parts joined by ", ", or NA when none is known.
join_known <- function(...) {
  parts <- list(...)
  joined <- vapply(seq_along(parts[[1]]), function(i) {
    values <- vapply(parts, function(part) part[[i]], character(1))
    paste(values[!is.na(values)], collapse = ", ")
  }, character(1))
  dplyr::na_if(joined, "")
}

public_publications <- function(publications) {
  x <- select_website_rows(publications)
  x <- dplyr::arrange(x, dplyr::desc(.data$year), .data$title, .data$key)
  x <- dplyr::select(x, dplyr::all_of(publication_public_fields))
  x$topic_tags <- lapply(x$topic_tags, split_tags)
  x$slug <- key_slugs(x$key, "publications")
  x
}

public_talks <- function(talks) {
  x <- select_website_rows(talks)
  x <- dplyr::arrange(x, dplyr::desc(.data$date), .data$title, .data$key)
  x <- dplyr::select(x, dplyr::all_of(talk_public_fields))
  x$date <- format(x$date, "%Y-%m-%d")
  x$topic_tags <- lapply(x$topic_tags, split_tags)
  x$slug <- key_slugs(x$key, "talks")
  # For a virtual talk this is the host institution's location.
  x$location_display <- join_known(x$location_city, x$location_region, x$location_country)
  x
}

# Removes scalar NA entries, so records never carry nulls.
drop_missing <- function(x) {
  Filter(function(value) !(length(value) == 1 && is.na(value)), x)
}

is_mappable <- function(latitude, longitude) {
  !is.na(latitude) & !is.na(longitude) &
    abs(latitude) <= 90 & abs(longitude) <= 180
}

talk_to_feature <- function(row) {
  list(
    type = "Feature",
    geometry = list(type = "Point", coordinates = c(row$longitude, row$latitude)),
    properties = drop_missing(list(
      key = row$key,
      title = row$title,
      organization = row$organization,
      location = row$location_display,
      virtual_status = row$virtual_status,
      primary_pillar = row$primary_pillar,
      year = row$year
    ))
  )
}

talks_geojson <- function(talks) {
  mapped <- talks[is_mappable(talks$latitude, talks$longitude), ]
  list(
    type = "FeatureCollection",
    features = lapply(seq_len(nrow(mapped)), function(i) talk_to_feature(as.list(mapped[i, ])))
  )
}

# Records assigned to `pillar` as primary or secondary (`keys`, in archive
# order), and up to three representative records chosen from those with it
# as primary pillar: featured first, then newest.
pillar_records <- function(x, pillar) {
  primary <- x$primary_pillar %in% pillar
  assigned <- primary | x$secondary_pillar %in% pillar
  featured <- x$featured %in% "Y"
  representative <- c(x$key[primary & featured], x$key[primary & !featured])
  list(
    primary = sum(primary),
    any = sum(assigned),
    keys = as.list(x$key[assigned]),
    representative = as.list(utils::head(representative, 3))
  )
}

# Named by the four configured pillars, in canonical order.
pillar_summary <- function(publications, talks, pillars = site_config$pillars) {
  summary <- lapply(seq_along(pillars), function(i) {
    list(
      number = i,
      publications = pillar_records(publications, pillars[[i]]),
      talks = pillar_records(talks, pillars[[i]])
    )
  })
  stats::setNames(summary, pillars)
}

build_metadata <- function(sources, public, generated_at) {
  list(
    generated_at = format(generated_at, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    schema_version = site_data_schema_version,
    source_tabs = as.list(source_tab_names),
    inclusion_rule = "website_include == 'Y'",
    source_rows = lapply(sources, nrow),
    public_rows = lapply(public, nrow),
    files = as.list(unname(site_data_files))
  )
}

# Normalized full-source tabs -> the public datasets: list(publications,
# talks, geojson, pillars, metadata). publications and talks are tibbles of
# the allowlisted and derived fields; the rest are JSON-ready lists.
build_public_data <- function(publications, talks, generated_at = Sys.time()) {
  public <- list(
    publications = public_publications(publications),
    talks = public_talks(talks)
  )
  list(
    publications = public$publications,
    talks = public$talks,
    geojson = talks_geojson(public$talks),
    pillars = pillar_summary(public$publications, public$talks),
    metadata = build_metadata(
      list(publications = publications, talks = talks), public, generated_at
    )
  )
}

# The site must never be published empty (spec 19).
assert_nonempty_public_data <- function(built) {
  empty <- c(publications = nrow(built$publications), talks = nrow(built$talks)) == 0
  if (any(empty)) {
    stop(sprintf(
      "No public %s (no rows with website_include == 'Y'); refusing to write empty site data.",
      paste(names(empty)[empty], collapse = " or ")
    ), call. = FALSE)
  }
  invisible(built)
}

# Double-quotes every string, so that YAML 1.2 loaders such as js-yaml (used
# by Quarto) never read a date, Y/N flag or number-like key as another type.
quote_strings <- function(x) {
  if (is.list(x)) return(lapply(x, quote_strings))
  if (is.character(x)) attr(x, "quoted") <- TRUE
  x
}

# A tibble of public records -> YAML text: a top-level sequence of records,
# missing values left out and topic_tags always a sequence.
records_yaml <- function(x) {
  records <- lapply(seq_len(nrow(x)), function(i) {
    record <- drop_missing(lapply(x, function(column) column[[i]]))
    record$topic_tags <- as.list(record$topic_tags)
    quote_strings(record)
  })
  # precision = 12 writes coordinates such as 51.50735091234 exactly.
  yaml::as.yaml(records, precision = 12)
}

site_json <- function(x) {
  paste0(jsonlite::toJSON(x, auto_unbox = TRUE, digits = NA, pretty = TRUE), "\n")
}

# Named character vector: file name -> file contents, in write order.
serialize_public_data <- function(built) {
  contents <- c(
    publications = records_yaml(built$publications),
    talks = records_yaml(built$talks),
    geojson = site_json(built$geojson),
    pillars = site_json(built$pillars),
    metadata = site_json(built$metadata)
  )
  stats::setNames(contents[names(site_data_files)], site_data_files)
}

write_utf8 <- function(text, path) {
  writeBin(charToRaw(enc2utf8(text)), path)
}

rename_or_fail <- function(from, to) {
  if (!suppressWarnings(file.rename(from, to))) {
    stop(sprintf("Unable to move '%s' to '%s'.", from, to), call. = FALSE)
  }
}

# Moves `files` from `staging` into the existing `output_dir`, replacing
# files of the same name and leaving every other file there alone. If any
# move fails, the files already moved are taken out again and the previous
# versions are put back before the error is re-raised.
install_staged_files <- function(staging, output_dir, files) {
  previous <- file.path(staging, ".previous")
  dir.create(previous, showWarnings = FALSE)
  installed <- character()
  saved <- character()
  tryCatch(
    for (file in files) {
      target <- file.path(output_dir, file)
      if (file.exists(target)) {
        rename_or_fail(target, file.path(previous, file))
        saved <- c(saved, file)
      }
      rename_or_fail(file.path(staging, file), target)
      installed <- c(installed, file)
    },
    error = function(e) {
      unlink(file.path(output_dir, installed))
      for (file in saved) file.rename(file.path(previous, file), file.path(output_dir, file))
      stop(e)
    }
  )
  invisible(file.path(output_dir, files))
}

# Serializes all five files in memory, writes them into a staging directory
# beside `output_dir`, then moves them in. A new output directory is created
# by renaming the staging directory. Any failure leaves an existing output
# directory as it was, and never creates a new one.
write_public_data <- function(built, output_dir) {
  contents <- serialize_public_data(built)
  parent <- dirname(output_dir)
  dir.create(parent, recursive = TRUE, showWarnings = FALSE)
  staging <- tempfile(paste0(".", basename(output_dir), "-staging-"), tmpdir = parent)
  if (!dir.create(staging, showWarnings = FALSE)) {
    stop(sprintf("Unable to create a staging directory in '%s'.", parent), call. = FALSE)
  }
  on.exit(unlink(staging, recursive = TRUE), add = TRUE)

  for (file in names(contents)) write_utf8(contents[[file]], file.path(staging, file))

  if (dir.exists(output_dir)) {
    install_staged_files(staging, output_dir, names(contents))
  } else {
    rename_or_fail(staging, output_dir)
  }
  invisible(file.path(output_dir, names(contents)))
}
