# Retrieval of the two public CV sheet tabs as raw, all-character tibbles.

sheet_csv_url <- function(sheet_id, gid) {
  sprintf(
    "https://docs.google.com/spreadsheets/d/%s/export?format=csv&gid=%s",
    sheet_id, gid
  )
}

# Reads one tab from its public CSV export, or from `override` (a local CSV
# path or URL) when given. Every column is read as character so types are
# decided by normalization, never by readr's guessing. Any read error, read
# warning (e.g. a failed connection) or malformed CSV row stops with
# "Unable to read CV source".
read_public_sheet <- function(sheet_id, gid, override = NULL, label = NULL) {
  source <- override %||% sheet_csv_url(sheet_id, gid)
  what <- if (is.null(label)) "CV source" else sprintf("CV source (%s)", label)
  fail <- function(message) stop("Unable to read ", what, ": ", message, call. = FALSE)

  x <- tryCatch(
    withCallingHandlers(
      readr::read_csv(
        source,
        col_types = readr::cols(.default = readr::col_character()),
        na = c("", "NA"),
        show_col_types = FALSE,
        progress = FALSE
      ),
      # Malformed rows are reported from problems() below instead.
      vroom_parse_issue = function(w) invokeRestart("muffleWarning")
    ),
    error = function(e) fail(conditionMessage(e)),
    warning = function(w) fail(conditionMessage(w))
  )

  problems <- readr::problems(x)
  if (nrow(problems) > 0) {
    fail(sprintf(
      "%d CSV parsing problem(s), first on line %d", nrow(problems), problems$row[[1]]
    ))
  }
  x
}

# Loads both tabs. `publications` and `talks` are optional local CSV overrides;
# NULL fetches the public sheet export. Returns list(publications, talks) only
# after both have loaded, so callers never act on a half-imported source.
import_cv_data <- function(publications = NULL, talks = NULL, config = site_config) {
  list(
    publications = read_public_sheet(
      config$sheet_id, config$gids[["publications"]], publications, "publications"
    ),
    talks = read_public_sheet(
      config$sheet_id, config$gids[["talks"]], talks, "talks"
    )
  )
}
