# Validation of normalized CV tabs. Each check_*() returns issue strings; the
# validate_*() functions collect them and stop once, naming every record.
# Inclusion flags and key uniqueness are checked on all rows. Every other rule
# applies only to included (exact "Y") rows, so unfinished excluded rows never
# break the build. Warnings (collect_build_warnings) never stop the build.

abort_if_issues <- function(issues) {
  issues <- unlist(issues, use.names = FALSE)
  if (length(issues)) stop(paste(c("CV data validation failed:", paste0("- ", issues)), collapse = "\n"), call. = FALSE)
}

prefix_issues <- function(label, issues) {
  if (length(issues)) paste0(label, ": ", issues) else character()
}

assert_columns <- function(x, columns, label) {
  missing <- setdiff(columns, names(x))
  if (length(missing)) {
    abort_if_issues(sprintf("%s: missing column(s) %s", label, paste(missing, collapse = ", ")))
  }
  invisible(x)
}

# Identifies records in messages: the key, or the spreadsheet row number
# (data row + 1 for the header) when the key is blank. A `.record` column, set
# before subsetting, keeps row numbers relative to the full source.
record_ids <- function(x) {
  if (!is.null(x[[".record"]])) return(x[[".record"]])
  ids <- as.character(x$key)
  blank <- is.na(ids)
  ids[blank] <- sprintf("row %d (blank key)", which(blank) + 1L)
  ids
}

check_inclusion_flags <- function(x) {
  bad <- !is.na(x$website_include) & !x$website_include %in% site_config$yes_no
  sprintf(
    "%s has unexpected website_include value '%s' (allowed: Y, N or blank)",
    record_ids(x)[bad], x$website_include[bad]
  )
}

check_unique_keys <- function(x) {
  keys <- x$key[!is.na(x$key)]
  duplicates <- unique(keys[duplicated(keys)])
  vapply(duplicates, function(key) {
    sprintf("duplicate key '%s' in rows %s", key, paste(which(x$key == key) + 1L, collapse = ", "))
  }, character(1), USE.NAMES = FALSE)
}

check_required <- function(x, fields) {
  as.character(unlist(lapply(fields, function(field) {
    sprintf("%s is missing required field %s", record_ids(x)[is.na(x[[field]])], field)
  })))
}

# Nonblank values of `fields` must be in `allowed`; blanks are left to
# check_required().
check_allowed <- function(x, fields, allowed, allowed_text = paste(allowed, collapse = ", ")) {
  as.character(unlist(lapply(fields, function(field) {
    value <- x[[field]]
    bad <- !is.na(value) & !value %in% allowed
    sprintf("%s has %s '%s' (allowed: %s)", record_ids(x)[bad], field, value[bad], allowed_text)
  })))
}

check_pillars <- function(x) {
  same <- !is.na(x$primary_pillar) & !is.na(x$secondary_pillar) &
    x$primary_pillar == x$secondary_pillar
  c(
    check_allowed(
      x, c("primary_pillar", "secondary_pillar"), site_config$pillars,
      "one of the four research pillars in R/config.R"
    ),
    sprintf("%s has identical primary_pillar and secondary_pillar", record_ids(x)[same])
  )
}

# Link URL rules (README, "Link URLs"). Pure string checks, no network access.

# TRUE for a DNS host name: two or more dot-separated labels of 1-63 letters,
# digits or hyphens (Unicode letters are allowed for internationalised names),
# no label starting or ending with a hyphen, and a last label that is not all
# digits. This rejects bare names (`localhost`), IPv4 addresses, empty labels
# and userinfo (`user@host`). NA in, NA out.
is_dns_host <- function(host) {
  label <- "[\\p{L}\\p{M}0-9](?:[\\p{L}\\p{M}0-9-]{0,61}[\\p{L}\\p{M}0-9])?"
  stringr::str_detect(host, paste0("^(?:", label, "\\.)+", label, "$")) &
    !stringr::str_detect(host, "\\.[0-9]+$")
}

# TRUE for `host` or `host:port` with a numeric port of 1-65535. This is what
# makes `doi:10.1016` (from a mistyped `https://doi:10.1016/...`) invalid.
is_valid_authority <- function(authority) {
  parts <- stringr::str_match(authority, "^([^:]*)(?::([0-9]{1,5}))?$")
  port <- as.integer(parts[, 3])
  is_dns_host(parts[, 2]) & (is.na(port) | (port >= 1L & port <= 65535L))
}

# Links the site may publish: one token (no whitespace, control or invisible
# characters) that is either https://host[:port][/path][?query][#fragment]
# without userinfo, or mailto:local@host[?query]. Everything else (http:,
# javascript:, scheme-less, malformed hosts) is invalid. NA input is not valid.
is_valid_link_url <- function(x) {
  one_token <- !stringr::str_detect(x, "[\\s\\p{C}]")
  https_authority <- stringr::str_match(x, "^https://([^/?#]*)(?:[/?#].*)?$")[, 2]
  mailto_host <- stringr::str_match(
    x, "^mailto:[A-Za-z0-9_%+-]+(?:\\.[A-Za-z0-9_%+-]+)*@([^?]*)(?:\\?.*)?$"
  )[, 2]
  (one_token & (is_valid_authority(https_authority) | is_dns_host(mailto_host))) %in% TRUE
}

# Nonblank link fields must be valid URLs; blanks are optional (a missing link
# only produces a build warning).
check_urls <- function(x, fields) {
  as.character(unlist(lapply(fields, function(field) {
    value <- x[[field]]
    bad <- !is.na(value) & !is_valid_link_url(value)
    sprintf('%s: %s is not a valid URL: "%s"', record_ids(x)[bad], field, value[bad])
  })))
}

# Returns issue strings (does not stop); validate_talks() calls it.
validate_coordinates <- function(x) {
  bad_lat <- !is.na(x$latitude) & (x$latitude < -90 | x$latitude > 90)
  bad_lon <- !is.na(x$longitude) & (x$longitude < -180 | x$longitude > 180)
  c(
    sprintf("%s has invalid latitude %s (must be -90 to 90)", record_ids(x)[bad_lat], x$latitude[bad_lat]),
    sprintf("%s has invalid longitude %s (must be -180 to 180)", record_ids(x)[bad_lon], x$longitude[bad_lon]),
    sprintf("%s has latitude without longitude", record_ids(x)[!is.na(x$latitude) & is.na(x$longitude)]),
    sprintf("%s has longitude without latitude", record_ids(x)[is.na(x$latitude) & !is.na(x$longitude)])
  )
}

check_date_year <- function(x) {
  bad <- !is.na(x$date) & !is.na(x$year) & lubridate::year(x$date) != x$year
  sprintf(
    "%s has date %s, which conflicts with year %s",
    record_ids(x)[bad], format(x$date[bad]), x$year[bad]
  )
}

publication_issues <- function(x) {
  assert_columns(x, site_config$source_columns$publications, "publications")
  x$.record <- record_ids(x)
  included <- select_website_rows(x)
  prefix_issues("publications", c(
    check_inclusion_flags(x),
    check_unique_keys(x),
    check_required(included, site_config$required_fields$publications),
    check_allowed(included, "status", site_config$publication_statuses),
    check_allowed(included, site_config$yes_no_fields$publications, site_config$yes_no),
    check_pillars(included),
    check_urls(included, site_config$url_fields$publications)
  ))
}

talk_issues <- function(x) {
  assert_columns(x, site_config$source_columns$talks, "talks")
  x$.record <- record_ids(x)
  included <- select_website_rows(x)
  prefix_issues("talks", c(
    check_inclusion_flags(x),
    check_unique_keys(x),
    check_required(included, site_config$required_fields$talks),
    check_allowed(included, site_config$yes_no_fields$talks, site_config$yes_no),
    check_allowed(included, "event_scope", site_config$talk_scopes),
    check_pillars(included),
    check_urls(included, site_config$url_fields$talks),
    validate_coordinates(included),
    check_date_year(included)
  ))
}

# Stops if any nonblank website_include value is not exactly "Y" or "N".
validate_inclusion_flags <- function(x) {
  abort_if_issues(check_inclusion_flags(x))
  invisible(x)
}

# Full check of one normalized tab; stops listing every issue, else returns
# `x` invisibly.
validate_publications <- function(x) {
  abort_if_issues(publication_issues(x))
  invisible(x)
}

validate_talks <- function(x) {
  abort_if_issues(talk_issues(x))
  invisible(x)
}

# Full check of both normalized tabs, reporting issues from both in one error.
validate_cv_data <- function(publications, talks) {
  abort_if_issues(c(publication_issues(publications), talk_issues(talks)))
  invisible(list(publications = publications, talks = talks))
}

# Non-fatal gaps in included records (spec 9.4): missing optional links,
# missing summaries, and talks that cannot be mapped. Returns a character
# vector, one message per gap.
collect_build_warnings <- function(publications, talks) {
  publications$.record <- record_ids(publications)
  talks$.record <- record_ids(talks)
  pubs <- select_website_rows(publications)
  talks <- select_website_rows(talks)
  no_links <- rowSums(!is.na(talks[site_config$url_fields$talks])) == 0
  unmapped <- is.na(talks$latitude) | is.na(talks$longitude)
  c(
    prefix_issues("publications", c(
      sprintf("%s has no doi_url", pubs$.record[is.na(pubs$doi_url)]),
      sprintf("%s has no plain_summary", pubs$.record[is.na(pubs$plain_summary)])
    )),
    prefix_issues("talks", c(
      sprintf("%s has no short_description", talks$.record[is.na(talks$short_description)]),
      sprintf("%s has no event, slides, poster or recording link", talks$.record[no_links]),
      sprintf("%s has no verified coordinates and will be omitted from the map", talks$.record[unmapped])
    ))
  )
}
