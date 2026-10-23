# Normalization of raw sheet tabs: whitespace, blanks, typed columns and the
# exact-"Y" website inclusion rule.

normalize_text <- function(x) {
  x <- stringr::str_squish(as.character(x))
  dplyr::na_if(x, "")
}

# The website inclusion rule: TRUE only for exactly "Y" (never "y", "N",
# blank or NA). Values are compared after whitespace trimming.
is_website_row <- function(website_include) {
  !is.na(website_include) & website_include == "Y"
}

select_website_rows <- function(x) {
  dplyr::filter(x, is_website_row(.data$website_include))
}

split_tags <- function(x) {
  if (is.na(x) || !nzchar(x)) return(character())
  tags <- stringr::str_squish(strsplit(x, ";", fixed = TRUE)[[1]])
  unique(tags[nzchar(tags)])
}

# Strict parsers: anything that is not exactly the expected form becomes NA.
parse_year <- function(x) {
  valid <- stringr::str_detect(x, "^[0-9]{4}$") %in% TRUE
  as.integer(ifelse(valid, x, NA_character_))
}

parse_iso_date <- function(x) {
  valid <- stringr::str_detect(x, "^[0-9]{4}-[0-9]{2}-[0-9]{2}$") %in% TRUE
  as.Date(ifelse(valid, x, NA_character_), format = "%Y-%m-%d")
}

parse_decimal <- function(x) {
  valid <- stringr::str_detect(x, "^[-+]?([0-9]+([.][0-9]*)?|[.][0-9]+)$") %in% TRUE
  as.numeric(ifelse(valid, x, NA_character_))
}

# Squishes every column to trimmed text (blank -> NA), then parses `typed`
# columns, given as field = list(parser, expected form). A nonblank value that
# fails to parse is an error for an included row and becomes NA for an
# excluded row, so unfinished excluded rows never stop the build.
normalize_source <- function(x, label, typed) {
  assert_columns(x, site_config$source_columns[[label]], label)
  x <- dplyr::mutate(x, dplyr::across(dplyr::everything(), normalize_text))
  ids <- record_ids(x)
  included <- is_website_row(x$website_include)

  issues <- character()
  for (field in names(typed)) {
    raw <- x[[field]]
    parsed <- typed[[field]][[1]](raw)
    bad <- included & !is.na(raw) & is.na(parsed)
    issues <- c(issues, sprintf(
      "%s has invalid %s '%s' (expected %s)",
      ids[bad], field, raw[bad], typed[[field]][[2]]
    ))
    x[[field]] <- parsed
  }
  abort_if_issues(prefix_issues(label, issues))
  x
}

# Raw publications tab -> normalized tibble (all text squished, year integer).
normalize_publications <- function(x) {
  normalize_source(x, "publications", list(
    year = list(parse_year, "a four-digit year")
  ))
}

# Raw talks tab -> normalized tibble (year integer, date Date, coordinates
# numeric).
normalize_talks <- function(x) {
  normalize_source(x, "talks", list(
    year = list(parse_year, "a four-digit year"),
    date = list(parse_iso_date, "a YYYY-MM-DD date"),
    latitude = list(parse_decimal, "a decimal number"),
    longitude = list(parse_decimal, "a decimal number")
  ))
}
