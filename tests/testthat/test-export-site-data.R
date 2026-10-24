# Public website datasets (R/export_site_data.R): allowlists, inclusion,
# derived fields, serialization, map features, pillar summaries, metadata and
# atomic writes.

fixed_time <- as.POSIXct("2026-10-23 12:00:00", tz = "UTC")

build_fixture_data <- function(publications = publication_fixture(), talks = talk_fixture()) {
  build_public_data(publications, talks, generated_at = fixed_time)
}

# Keys the source marks public, selected independently of the exporter.
exact_y_keys <- function(x) x$key[x$website_include %in% "Y"]

feature_keys <- function(geojson) {
  vapply(geojson$features, function(x) x$properties$key, character(1))
}

# JSON-ready key arrays (lists) back to character vectors.
as_keys <- function(x) as.character(unlist(x))

generated_files <- c(
  "publications.yml", "talks.yml", "talks.geojson", "pillars.json",
  "build-metadata.json"
)

# Every field an exported record may carry: the allowlist, then derived fields.
expected_publication_fields <- c(
  "key", "status", "author", "year", "title", "preprint_journal",
  "preprint_doi", "journal", "volume", "page_number", "doi_url",
  "category", "featured", "primary_pillar", "secondary_pillar",
  "topic_tags", "foundational_work", "plain_summary", "image", "slug"
)

expected_talk_fields <- c(
  "key", "author", "title", "date", "year", "organization", "type",
  "location_city", "location_region", "location_country", "prize",
  "featured", "presented_by_me", "primary_pillar", "secondary_pillar",
  "topic_tags", "foundational_work", "latitude", "longitude",
  "virtual_status", "event_scope", "event_url", "slides_url",
  "poster_url", "recording_url", "short_description", "slug",
  "location_display"
)

expected_feature_properties <- c(
  "key", "title", "organization", "location", "virtual_status",
  "primary_pillar", "year"
)

list_dir <- function(path) list.files(path, all.files = TRUE, no.. = TRUE)

test_that("export allowlists prevent private fields", {
  built <- build_public_data(publication_fixture(), talk_fixture())
  expect_false("cv_include" %in% names(built$publications))
  expect_false("phone" %in% names(built$publications))
  expect_false("cv_include" %in% names(built$talks))
  expect_identical(names(built$publications), expected_publication_fields)
  expect_identical(names(built$talks), expected_talk_fields)
})

test_that("only exact-Y source rows are exported", {
  pubs <- publication_fixture()
  talks <- talk_fixture()
  built <- build_fixture_data(pubs, talks)

  expect_setequal(built$publications$key, exact_y_keys(pubs))
  expect_setequal(built$publications$key, c("pub-1", "pub-2", "pub-5"))
  expect_setequal(built$talks$key, exact_y_keys(talks))
  expect_setequal(built$talks$key, c("talk-1", "talk-2", "talk-3", "talk-4", "talk-7"))

  # The fixtures hold one N row and one blank row per tab; neither is exported.
  expect_identical(pubs$website_include[match(c("pub-3", "pub-4"), pubs$key)], c("N", NA))
  expect_false(any(c("pub-3", "pub-4") %in% built$publications$key))
  expect_identical(talks$website_include[match(c("talk-5", "talk-6"), talks$key)], c("N", NA))
  expect_false(any(c("talk-5", "talk-6") %in% built$talks$key))

  # Lowercase y is not Y.
  pubs$website_include[pubs$key == "pub-5"] <- "y"
  talks$website_include[talks$key == "talk-4"] <- "y"
  built <- build_fixture_data(pubs, talks)
  expect_setequal(built$publications$key, c("pub-1", "pub-2"))
  expect_setequal(built$talks$key, c("talk-1", "talk-2", "talk-3", "talk-7"))
})

test_that("records are sorted newest first, then by title", {
  pubs <- publication_fixture()
  talks <- talk_fixture()
  reversed <- build_fixture_data(pubs[rev(seq_len(nrow(pubs))), ], talks[rev(seq_len(nrow(talks))), ])
  expect_identical(reversed$publications$key, c("pub-2", "pub-1", "pub-5"))
  expect_identical(reversed$talks$key, c("talk-1", "talk-2", "talk-3", "talk-7", "talk-4"))

  # Equal years (publications) or dates (talks) fall back to the title.
  pubs$year[pubs$key %in% c("pub-1", "pub-5")] <- 2020L
  talks$date[talks$key == "talk-4"] <- talks$date[talks$key == "talk-1"]
  tied <- build_fixture_data(pubs[rev(seq_len(nrow(pubs))), ], talks)
  expect_identical(tied$publications$key, c("pub-2", "pub-1", "pub-5"))
  expect_identical(tied$talks$key, c("talk-4", "talk-1", "talk-2", "talk-3", "talk-7"))
})

test_that("derived fields: ISO dates, location text and tag arrays", {
  built <- build_fixture_data()
  talks <- built$talks
  pubs <- built$publications

  expect_type(talks$date, "character")
  expect_identical(talks$date[talks$key == "talk-1"], "2025-09-14")
  expect_type(pubs$year, "integer")
  expect_identical(talks$location_display[talks$key == "talk-1"], "Sampleton, North Example, Exampleland")
  expect_identical(talks$location_display[talks$key == "talk-2"], "Fixtureville, South Example, Testonia")
  expect_identical(talks$location_display[talks$key == "talk-3"], "Exampleland")

  expect_identical(pubs$topic_tags[[which(pubs$key == "pub-1")]], c("tag-alpha", "tag-beta"))
  expect_identical(pubs$topic_tags[[which(pubs$key == "pub-2")]], "tag-gamma")
  expect_identical(talks$topic_tags[[which(talks$key == "talk-3")]], character())

  expect_identical(pubs$slug, pubs$key)
  expect_identical(talks$slug, talks$key)
})

test_that("location text is absent when no location part is known", {
  talks <- talk_fixture()
  talks[talks$key == "talk-3", c("location_city", "location_region", "location_country")] <- NA
  built <- build_fixture_data(talks = talks)
  expect_true(is.na(built$talks$location_display[built$talks$key == "talk-3"]))
  record <- yaml::yaml.load(serialize_public_data(built)[["talks.yml"]])[[3]]
  expect_identical(record$key, "talk-3")
  expect_false(any(c("location_display", "location_country") %in% names(record)))
})

test_that("slugs lowercase keys and turn runs of other characters into one hyphen", {
  expect_identical(
    key_slugs(c("Fritz2024_Nature", "pub-1", "A  B..C", "-Edge-"), "publications"),
    c("fritz2024-nature", "pub-1", "a-b-c", "edge")
  )
  expect_error(key_slugs("---", "talks"), "talks: key '---' has no letters or digits for a URL slug")
})

test_that("public keys that collide as slugs fail the build", {
  pubs <- publication_fixture()
  pubs$key[pubs$key == "pub-2"] <- "PUB_1"
  err <- expect_error(build_fixture_data(pubs, talk_fixture()))
  expect_match(conditionMessage(err), "publications: keys .* share the URL slug 'pub-1'")
  expect_match(conditionMessage(err), "'PUB_1'", fixed = TRUE)
  expect_match(conditionMessage(err), "'pub-1'", fixed = TRUE)

  talks <- talk_fixture()
  talks$key[talks$key == "talk-4"] <- "Talk 1"
  expect_error(build_fixture_data(talks = talks), "talks: keys .* share the URL slug 'talk-1'")
})

test_that("slugs need only be unique among public records of one kind", {
  pubs <- publication_fixture()
  pubs$key[pubs$key == "pub-3"] <- "PUB_1" # excluded row
  talks <- talk_fixture()
  talks$key[talks$key == "talk-1"] <- "pub-1" # same slug, other kind
  built <- build_fixture_data(pubs, talks)
  expect_true("pub-1" %in% built$publications$slug)
  expect_true("pub-1" %in% built$talks$slug)
})

test_that("YAML records omit missing values and keep strings as strings", {
  pubs <- publication_fixture()
  pubs$key[pubs$key == "pub-5"] <- "2016"
  pubs$key[pubs$key == "pub-2"] <- "true"
  files <- serialize_public_data(build_fixture_data(pubs, talk_fixture()))
  pub_yaml <- files[["publications.yml"]]
  talk_yaml <- files[["talks.yml"]]

  # Quoted, so YAML 1.2 loaders (js-yaml) read dates, flags and numeric- or
  # boolean-looking keys as strings; years stay numbers.
  expect_match(talk_yaml, 'date: "2025-09-14"', fixed = TRUE)
  expect_match(talk_yaml, 'virtual_status: "Y"', fixed = TRUE)
  expect_match(pub_yaml, 'key: "2016"', fixed = TRUE)
  expect_match(pub_yaml, 'key: "true"', fixed = TRUE)
  expect_match(pub_yaml, 'featured: "N"', fixed = TRUE)
  expect_match(pub_yaml, "\n  year: 2025\n", fixed = TRUE)
  expect_match(talk_yaml, "\n  latitude: 12.3456\n", fixed = TRUE)
  expect_match(pub_yaml, '\n  topic_tags:\n  - "tag-gamma"\n', fixed = TRUE)
  expect_match(talk_yaml, "\n  topic_tags: []\n", fixed = TRUE)
  for (text in c(pub_yaml, talk_yaml)) {
    expect_no_match(text, "(?m):[ ]*(null|~|\\.na|NA)[ ]*$", perl = TRUE)
  }

  # Top-level sequences of records.
  pub_records <- yaml::yaml.load(pub_yaml)
  talk_records <- yaml::yaml.load(talk_yaml)
  expect_null(names(pub_records))
  expect_length(pub_records, 3)
  expect_length(talk_records, 5)

  # R's YAML 1.1 parser reads unquoted Y/N, true and 2016 as non-strings.
  keys <- vapply(pub_records, function(x) x$key, character(1))
  expect_identical(keys, c("true", "pub-1", "2016"))
  expect_identical(pub_records[[2]]$featured, "Y")
  expect_identical(pub_records[[2]]$year, 2025L)
  expect_identical(talk_records[[1]]$date, "2025-09-14")
  expect_identical(talk_records[[1]]$latitude, 12.3456)
  expect_identical(talk_records[[1]]$longitude, 45.6789)

  # Missing values are left out entirely.
  pub_2 <- pub_records[[1]]
  expect_false(any(c("doi_url", "plain_summary", "volume", "page_number", "image", "secondary_pillar") %in% names(pub_2)))
  expect_identical(pub_2$preprint_journal, "ExampleRxiv")
  talk_3 <- talk_records[[3]]
  expect_identical(talk_3$key, "talk-3")
  expect_false(any(c("latitude", "longitude", "event_url", "short_description", "location_city", "prize") %in% names(talk_3)))
  expect_identical(talk_3$location_display, "Exampleland")
})

test_that("coordinates survive the YAML round trip exactly", {
  talks <- talk_fixture()
  talks$latitude[talks$key == "talk-1"] <- 51.50735091234
  talks$longitude[talks$key == "talk-1"] <- -179.123456789012
  records <- yaml::yaml.load(serialize_public_data(build_fixture_data(talks = talks))[["talks.yml"]])
  expect_identical(records[[1]]$latitude, 51.50735091234)
  expect_identical(records[[1]]$longitude, -179.123456789012)
})

test_that("a publication record serializes to the expected YAML", {
  built <- build_fixture_data()
  pub_1 <- built$publications[built$publications$key == "pub-1", ]
  expect_identical(records_yaml(pub_1), readr::read_file(fixture_path("expected_publication.yml")))
})

test_that("unmappable talks remain in archive but not GeoJSON", {
  talks <- talk_fixture()
  talks$latitude[1] <- NA_real_
  talks$longitude[1] <- NA_real_
  built <- build_public_data(publication_fixture(), talks)
  expect_true("talk-1" %in% built$talks$key)
  geo_keys <- vapply(built$geojson$features, function(x) x$properties$key, character(1))
  expect_false("talk-1" %in% geo_keys)
})

test_that("only talks with an in-bounds coordinate pair are mapped", {
  built <- build_fixture_data()
  expect_identical(feature_keys(built$geojson), c("talk-1", "talk-2", "talk-7", "talk-4"))
  expect_true("talk-3" %in% built$talks$key)
  for (feature in built$geojson$features) {
    expect_identical(names(feature$properties), expected_feature_properties)
  }

  talks <- talk_fixture()
  talks$latitude[talks$key == "talk-1"] <- 95
  talks$longitude[talks$key == "talk-4"] <- NA
  built <- build_fixture_data(talks = talks)
  expect_identical(feature_keys(built$geojson), c("talk-2", "talk-7"))
  expect_setequal(built$talks$key, c("talk-1", "talk-2", "talk-3", "talk-4", "talk-7"))
})

test_that("a virtual talk with host coordinates is mapped at its host", {
  geojson <- jsonlite::parse_json(serialize_public_data(build_fixture_data())[["talks.geojson"]])
  expect_identical(geojson$type, "FeatureCollection")
  keys <- vapply(geojson$features, function(x) x$properties$key, character(1))
  feature <- geojson$features[[which(keys == "talk-2")]]

  expect_identical(feature, jsonlite::read_json(fixture_path("expected_talk_feature.json")))
  expect_identical(feature$properties$virtual_status, "Y")
  expect_identical(feature$properties$location, "Fixtureville, South Example, Testonia")
  expect_identical(feature$geometry$coordinates, list(151.1111, -33.3333)) # [lon, lat]
})

test_that("GeoJSON with no mappable talks is still a valid FeatureCollection", {
  talks <- talk_fixture()
  talks$latitude <- NA_real_
  talks$longitude <- NA_real_
  built <- build_fixture_data(talks = talks)
  geojson <- jsonlite::parse_json(serialize_public_data(built)[["talks.geojson"]])
  expect_identical(geojson, list(type = "FeatureCollection", features = list()))
  expect_identical(nrow(built$talks), 5L)
})

test_that("pillar summaries are keyed by exactly the four configured pillars", {
  built <- build_fixture_data()
  expect_identical(names(built$pillars), site_config$pillars)
  expect_length(built$pillars, 4)
  expect_identical(unname(vapply(built$pillars, function(p) p$number, integer(1))), 1:4)
  for (pillar in built$pillars) {
    expect_named(pillar, c("number", "publications", "talks"))
    expect_named(pillar$publications, c("primary", "any", "keys", "representative"))
    expect_named(pillar$talks, c("primary", "any", "keys", "representative"))
  }
  json <- jsonlite::parse_json(serialize_public_data(built)[["pillars.json"]])
  expect_identical(names(json), site_config$pillars)
})

test_that("pillar counts and keys come from the exported archive records", {
  built <- build_fixture_data()
  for (kind in c("publications", "talks")) {
    records <- built[[kind]]
    for (pillar in site_config$pillars) {
      summary <- built$pillars[[pillar]][[kind]]
      keys <- as_keys(summary$keys)
      in_pillar <- records$primary_pillar %in% pillar | records$secondary_pillar %in% pillar
      expect_identical(keys, records$key[in_pillar])
      expect_identical(summary$any, length(keys))
      expect_identical(summary$primary, sum(records$primary_pillar[match(keys, records$key)] %in% pillar))
    }
    primaries <- vapply(built$pillars, function(p) p[[kind]]$primary, integer(1))
    expect_identical(sum(primaries), nrow(records))
  }

  pillars <- unname(built$pillars)
  # pub-4 (blank flag, pillar 2) and talk-6 (blank flag, pillar 1) do not count.
  expect_identical(pillars[[1]]$publications[c("primary", "any")], list(primary = 1L, any = 2L))
  expect_identical(as_keys(pillars[[1]]$publications$keys), c("pub-1", "pub-5"))
  expect_identical(pillars[[2]]$publications[c("primary", "any")], list(primary = 0L, any = 1L))
  expect_identical(pillars[[1]]$talks[c("primary", "any")], list(primary = 1L, any = 1L))
  expect_identical(pillars[[3]]$talks[c("primary", "any")], list(primary = 1L, any = 2L))
  expect_identical(as_keys(pillars[[3]]$talks$keys), c("talk-2", "talk-3"))
  expect_identical(pillars[[4]]$talks[c("primary", "any")], list(primary = 2L, any = 2L))
  expect_identical(as_keys(pillars[[4]]$talks$keys), c("talk-7", "talk-4"))
})

test_that("representative records are primary-pillar records, featured first, then newest, at most three", {
  built <- build_fixture_data()
  pillars <- unname(built$pillars)
  expect_identical(as_keys(pillars[[1]]$publications$representative), "pub-1")
  expect_identical(as_keys(pillars[[2]]$publications$representative), character()) # pub-1 is only secondary
  expect_identical(as_keys(pillars[[3]]$talks$representative), "talk-3")

  talks <- talk_fixture()
  public <- talks$website_include %in% "Y"
  talks$primary_pillar[public] <- site_config$pillars[[1]]
  talks$secondary_pillar[public] <- NA
  talks$featured[public] <- "N"
  talks$featured[talks$key == "talk-3"] <- "Y"
  summary <- build_fixture_data(talks = talks)$pillars[[1]]$talks
  expect_identical(summary$primary, 5L)
  expect_identical(as_keys(summary$representative), c("talk-3", "talk-1", "talk-2"))
})

test_that("build metadata records counts and tab names but no source location", {
  built <- build_fixture_data()
  metadata <- built$metadata
  expect_named(metadata, c(
    "generated_at", "schema_version", "source_tabs", "inclusion_rule",
    "source_rows", "public_rows", "files"
  ))
  expect_identical(metadata$generated_at, "2026-10-23T12:00:00Z")
  expect_type(metadata$schema_version, "character")
  expect_identical(metadata$source_tabs, list(publications = "Journal Articles", talks = "Conferences"))
  expect_identical(metadata$inclusion_rule, "website_include == 'Y'")
  expect_identical(metadata$source_rows, list(publications = 5L, talks = 7L))
  expect_identical(metadata$public_rows, list(publications = 3L, talks = 5L))
  expect_identical(as_keys(metadata$files), generated_files)

  json <- serialize_public_data(built)[["build-metadata.json"]]
  for (secret in c(site_config$sheet_id, site_config$gids[["talks"]], "docs.google.com", "gid", "http")) {
    expect_false(grepl(secret, json, fixed = TRUE), info = secret)
  }

  london <- as.POSIXct("2026-07-01 13:30:00", tz = "Europe/London")
  expect_identical(
    build_public_data(publication_fixture(), talk_fixture(), generated_at = london)$metadata$generated_at,
    "2026-07-01T12:30:00Z"
  )
})

test_that("serialization is deterministic and independent of source row order", {
  pubs <- publication_fixture()
  talks <- talk_fixture()
  first <- serialize_public_data(build_fixture_data(pubs, talks))
  shuffled <- serialize_public_data(build_fixture_data(pubs[c(5, 3, 1, 4, 2), ], talks[c(4, 6, 7, 2, 1, 5, 3), ]))
  expect_named(first, generated_files)
  expect_identical(first, shuffled)
})

test_that("empty public data is refused", {
  built <- build_fixture_data()
  expect_identical(assert_nonempty_public_data(built), built)

  pubs <- publication_fixture()
  pubs$website_include <- "N"
  expect_error(
    assert_nonempty_public_data(build_fixture_data(pubs, talk_fixture())),
    "No public publications"
  )

  talks <- talk_fixture()
  talks$website_include <- NA_character_
  expect_error(assert_nonempty_public_data(build_fixture_data(talks = talks)), "No public talks")
})

test_that("writing creates the five files in a new directory with no staging left behind", {
  parent <- withr::local_tempdir()
  output_dir <- file.path(parent, "nested", "generated")
  built <- build_fixture_data()
  write_public_data(built, output_dir)

  expect_setequal(list_dir(output_dir), generated_files)
  expect_identical(list_dir(file.path(parent, "nested")), "generated")
  contents <- serialize_public_data(built)
  for (file in generated_files) {
    expect_identical(readr::read_file(file.path(output_dir, file)), contents[[file]], info = file)
  }
  expect_length(yaml::read_yaml(file.path(output_dir, "publications.yml")), 3)
  expect_length(yaml::read_yaml(file.path(output_dir, "talks.yml")), 5)
  expect_length(jsonlite::read_json(file.path(output_dir, "talks.geojson"))$features, 4)
  expect_named(jsonlite::read_json(file.path(output_dir, "pillars.json")), site_config$pillars)
  expect_identical(jsonlite::read_json(file.path(output_dir, "build-metadata.json"))$public_rows$talks, 5L)
})

test_that("writing into an existing directory replaces only the generated files", {
  parent <- withr::local_tempdir()
  output_dir <- file.path(parent, "generated")
  dir.create(output_dir)
  file.create(file.path(output_dir, ".gitkeep"))
  writeLines("keep me", file.path(output_dir, "sentinel.txt"))
  writeLines("previous build", file.path(output_dir, "publications.yml"))

  built <- build_fixture_data()
  write_public_data(built, output_dir)

  expect_setequal(list_dir(output_dir), c(".gitkeep", "sentinel.txt", generated_files))
  expect_identical(file.size(file.path(output_dir, ".gitkeep")), 0)
  expect_identical(readLines(file.path(output_dir, "sentinel.txt")), "keep me")
  expect_identical(
    readr::read_file(file.path(output_dir, "publications.yml")),
    serialize_public_data(built)[["publications.yml"]]
  )
  expect_identical(list_dir(parent), "generated")
})

test_that("a serialization failure leaves the output untouched", {
  parent <- withr::local_tempdir()
  output_dir <- file.path(parent, "generated")
  dir.create(output_dir)
  writeLines("previous build", file.path(output_dir, "publications.yml"))

  built <- build_fixture_data()
  built$metadata$unserializable <- new.env()
  expect_error(write_public_data(built, output_dir))
  expect_identical(list_dir(output_dir), "publications.yml")
  expect_identical(readLines(file.path(output_dir, "publications.yml")), "previous build")

  fresh_dir <- file.path(parent, "fresh")
  expect_error(write_public_data(built, fresh_dir))
  expect_false(dir.exists(fresh_dir))
  expect_identical(list_dir(parent), "generated")
})

test_that("a failure while installing files restores the previous output", {
  parent <- withr::local_tempdir()
  output_dir <- file.path(parent, "generated")
  staging <- file.path(parent, "staging")
  dir.create(output_dir)
  dir.create(staging)
  file.create(file.path(output_dir, ".gitkeep"))
  writeLines("old a", file.path(output_dir, "a.yml"))
  writeLines("old c", file.path(output_dir, "c.yml"))
  writeLines("new a", file.path(staging, "a.yml"))
  writeLines("new b", file.path(staging, "b.yml"))
  # c.yml is missing from staging, so installing it fails after a and b moved.

  expect_error(
    install_staged_files(staging, output_dir, c("a.yml", "b.yml", "c.yml")),
    "c.yml"
  )
  expect_setequal(list_dir(output_dir), c(".gitkeep", "a.yml", "c.yml"))
  expect_identical(readLines(file.path(output_dir, "a.yml")), "old a")
  expect_identical(readLines(file.path(output_dir, "c.yml")), "old c")
})

test_that("generated files hold no private fields, source locations or excluded rows", {
  output_dir <- file.path(withr::local_tempdir(), "generated")
  write_public_data(build_fixture_data(), output_dir)
  paths <- file.path(output_dir, generated_files)
  texts <- stats::setNames(vapply(paths, readr::read_file, character(1)), generated_files)

  pubs <- publication_fixture()
  talks <- talk_fixture()
  excluded_pubs <- pubs[!pubs$website_include %in% "Y", ]
  excluded_talks <- talks[!talks$website_include %in% "Y", ]
  excluded <- c(excluded_pubs$key, excluded_pubs$title, excluded_talks$key, excluded_talks$title)
  expect_length(excluded, 8)

  # CV-only sheet columns: their names, and their distinctive values.
  cv_pub_columns <- setdiff(names(pubs), site_config$source_columns$publications)
  cv_talk_columns <- setdiff(names(talks), site_config$source_columns$talks)
  expect_contains(cv_pub_columns, c("cv_include", "markdown", "markdown_name"))
  cv_values <- unique(unlist(c(pubs[cv_pub_columns], talks[cv_talk_columns]), use.names = FALSE))
  cv_values <- cv_values[!is.na(cv_values) & nchar(cv_values) >= 8]
  expect_contains(cv_values, "Fixture markdown body for the CV only.")

  forbidden <- unique(c(
    "cv_include", "phone", "docs.google.com", site_config$sheet_id,
    site_config$gids[["talks"]], excluded, cv_pub_columns, cv_talk_columns, cv_values
  ))
  for (file in generated_files) {
    for (text in forbidden) {
      expect_false(grepl(text, texts[[file]], fixed = TRUE), info = sprintf("%s contains '%s'", file, text))
    }
  }

  # Records carry exactly the allowlisted and derived fields, nothing else.
  pub_records <- yaml::read_yaml(file.path(output_dir, "publications.yml"))
  talk_records <- yaml::read_yaml(file.path(output_dir, "talks.yml"))
  expect_length(pub_records, 3)
  expect_length(talk_records, 5)
  expect_setequal(unique(unlist(lapply(pub_records, names))), expected_publication_fields)
  expect_setequal(unique(unlist(lapply(talk_records, names))), expected_talk_fields)
  features <- jsonlite::read_json(file.path(output_dir, "talks.geojson"))$features
  expect_length(features, 4)
  for (feature in features) {
    expect_identical(names(feature), c("type", "geometry", "properties"))
    expect_identical(names(feature$properties), expected_feature_properties)
  }
})
