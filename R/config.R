# Source location, controlled vocabularies and schema for the CV data.
site_config <- list(
  sheet_id = "1e9C-H-qXmPScZwefxmjSOm8jpEeYP-c5dVqJIZrHnTQ",
  gids = c(publications = "0", talks = "318960497"),
  pillars = c(
    "Infectious-disease biology, evolution and environment",
    "Quantitative and experimental biomedical discovery",
    "Clinical translation and health-system improvement",
    "Climate and planetary health in medicine"
  ),
  publication_statuses = c("Published", "In Review"),
  talk_scopes = c("local", "regional", "national", "international"),
  yes_no = c("Y", "N"),

  # Columns each tab must provide. Other sheet columns (cv_include, markdown,
  # bibtype, ...) may be present; they are carried through but never exported.
  source_columns = list(
    publications = c(
      "key", "status", "author", "year", "title", "preprint_journal",
      "preprint_doi", "journal", "volume", "page_number", "doi_url",
      "category", "website_include", "featured", "primary_pillar",
      "secondary_pillar", "topic_tags", "foundational_work",
      "plain_summary", "image"
    ),
    talks = c(
      "key", "author", "title", "date", "year", "organization", "type",
      "location_city", "location_region", "location_country", "prize",
      "website_include", "featured", "presented_by_me", "primary_pillar",
      "secondary_pillar", "topic_tags", "foundational_work", "latitude",
      "longitude", "virtual_status", "event_scope", "event_url",
      "slides_url", "poster_url", "recording_url", "short_description"
    )
  ),

  # Fields every included (exact "Y") record must fill (spec 9.1-9.3).
  required_fields = list(
    publications = c(
      "key", "title", "author", "year", "status", "journal",
      "primary_pillar", "foundational_work"
    ),
    talks = c(
      "key", "title", "author", "date", "year", "organization", "type",
      "virtual_status", "event_scope", "presented_by_me", "primary_pillar",
      "foundational_work"
    )
  ),

  yes_no_fields = list(
    publications = "foundational_work",
    talks = c("foundational_work", "presented_by_me", "virtual_status")
  ),

  # Link fields whose nonblank values must be https:// or mailto: (spec 16).
  url_fields = list(
    publications = "doi_url",
    talks = c("event_url", "slides_url", "poster_url", "recording_url")
  ),

  # Default build output, relative to the repository root.
  output_dir = file.path("data", "generated")
)
