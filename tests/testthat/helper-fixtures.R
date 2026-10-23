# Synthetic fixtures. Every title, author, organisation, URL and coordinate in
# tests/fixtures/*.csv is invented; never copy rows from the real CV sheet.
#
# journal_articles.csv: pub-1 (Published, Y), pub-2 (In Review, Y, no DOI or
# summary), pub-3 (N, unfinished), pub-4 (blank flag), pub-5 (foundational, Y).
# conferences.csv: talk-1 (in person, Y), talk-2 (virtual with host
# coordinates and a secondary pillar, Y), talk-3 (no coordinates, links or
# description, Y), talk-4 (foundational, Y), talk-5 (N, unfinished),
# talk-6 (blank flag). Both files pass full validation.

# Full header of each sheet tab, including CV-only columns that must never be
# exported, so privacy tests see the same shape as the real source.
publication_sheet_columns <- c(
  "key", "bibtype", "status", "author", "year", "title", "preprint_journal",
  "preprint_doi", "journal", "volume", "page_number", "doi_url", "category",
  "website_include", "featured", "primary_pillar", "plain_summary", "image",
  "markdown_name", "markdown_date", "cv_include", "markdown",
  "secondary_pillar", "topic_tags", "foundational_work"
)

talk_sheet_columns <- c(
  "key", "bibtype", "author", "title", "date", "year", "month",
  "organization", "type", "location_city", "location_region",
  "location_country", "prize", "website_include", "featured",
  "presented_by_me", "primary_pillar", "latitude", "longitude",
  "virtual_status", "event_scope", "event_url", "slides_url", "poster_url",
  "recording_url", "short_description", "conference_name_date",
  "markdown_name", "markdown_date", "cv_include", "markdown",
  "secondary_pillar", "topic_tags", "foundational_work"
)

fixture_path <- function(file) testthat::test_path("..", "fixtures", file)

# Raw (all-character) fixture tabs, read through the production import path.
fixture_sources <- function() {
  import_cv_data(
    publications = fixture_path("journal_articles.csv"),
    talks = fixture_path("conferences.csv")
  )
}

# Normalized tibbles, the shape validation and export receive.
publication_fixture <- function() normalize_publications(fixture_sources()$publications)

talk_fixture <- function() normalize_talks(fixture_sources()$talks)
