test_that("only exact Y is public", {
  x <- tibble::tibble(
    key = paste0("k", 1:5),
    website_include = c("Y", "N", "", "y", NA_character_)
  )
  expect_equal(select_website_rows(x)$key, "k1")
})

test_that("normalization trims text and turns blanks into NA", {
  raw <- fixture_sources()$talks
  raw$title[1] <- "  An   example   title  "
  raw$prize[1] <- "   "
  raw$website_include[1] <- " Y "
  x <- normalize_talks(raw)
  expect_equal(x$title[1], "An example title")
  expect_true(is.na(x$prize[1]))
  expect_equal(x$website_include[1], "Y")
})

test_that("normalization keeps authored capitalisation and never upper-cases flags", {
  raw <- fixture_sources()$publications
  raw$title[1] <- "mRNA profiling of an Example DNA library"
  raw$website_include[1] <- "y"
  x <- normalize_publications(raw)
  expect_equal(x$title[1], "mRNA profiling of an Example DNA library")
  expect_equal(x$website_include[1], "y")
  expect_false("pub-1" %in% select_website_rows(x)$key)
})

test_that("normalization parses years, dates and coordinates", {
  pubs <- publication_fixture()
  talks <- talk_fixture()
  expect_type(pubs$year, "integer")
  expect_type(talks$year, "integer")
  expect_s3_class(talks$date, "Date")
  expect_type(talks$latitude, "double")
  expect_type(talks$longitude, "double")
  expect_equal(pubs$year[pubs$key == "pub-1"], 2025L)
  expect_equal(talks$date[talks$key == "talk-1"], as.Date("2025-09-14"))
  expect_equal(talks$latitude[talks$key == "talk-1"], 12.3456)
  expect_equal(talks$longitude[talks$key == "talk-1"], 45.6789)
})

test_that("unparseable values in included rows fail normalization with the key", {
  raw <- fixture_sources()$talks

  impossible_date <- raw
  impossible_date$date[1] <- "2025-02-30"
  expect_error(normalize_talks(impossible_date), "talk-1 has invalid date '2025-02-30'")

  non_iso_date <- raw
  non_iso_date$date[1] <- "14/09/2025"
  expect_error(normalize_talks(non_iso_date), "talk-1 has invalid date '14/09/2025'")

  word_latitude <- raw
  word_latitude$latitude[1] <- "north"
  expect_error(normalize_talks(word_latitude), "talk-1 has invalid latitude 'north'")

  pubs <- fixture_sources()$publications
  pubs$year[1] <- "2025a"
  expect_error(normalize_publications(pubs), "pub-1 has invalid year '2025a'")
})

test_that("unparseable values in excluded rows become NA without failing", {
  raw <- fixture_sources()$talks
  excluded <- which(raw$key == "talk-5")
  raw$date[excluded] <- "sometime in 2026"
  raw$latitude[excluded] <- "unknown"
  x <- normalize_talks(raw)
  expect_true(is.na(x$date[excluded]))
  expect_true(is.na(x$latitude[excluded]))
})

test_that("a source missing an expected column is rejected by name", {
  raw <- fixture_sources()$publications
  raw$website_include <- NULL
  expect_error(normalize_publications(raw), "publications.*missing column.*website_include")
})

test_that("topic tags split on semicolons into unique trimmed values", {
  expect_equal(
    split_tags(" tag-alpha; tag-beta ;; tag-alpha; "),
    c("tag-alpha", "tag-beta")
  )
  expect_equal(split_tags(NA_character_), character())
  expect_equal(split_tags(""), character())
})

test_that("fixtures carry the full sheet schema", {
  sources <- fixture_sources()
  expect_identical(names(sources$publications), publication_sheet_columns)
  expect_identical(names(sources$talks), talk_sheet_columns)
  expect_identical(names(publication_fixture()), publication_sheet_columns)
  expect_identical(names(talk_fixture()), talk_sheet_columns)
})

test_that("fixtures cover the inclusion, status, map and pillar cases", {
  pubs <- publication_fixture()
  talks <- talk_fixture()
  expect_equal(pubs$key[1], "pub-1")
  expect_equal(talks$key[1], "talk-1")

  for (x in list(pubs, talks)) {
    expect_true("N" %in% x$website_include)
    expect_true(anyNA(x$website_include))
  }

  public_pubs <- select_website_rows(pubs)
  expect_setequal(public_pubs$status, c("Published", "In Review"))

  public_talks <- select_website_rows(talks)
  virtual <- public_talks[public_talks$virtual_status == "Y", ]
  expect_true(any(!is.na(virtual$latitude) & !is.na(virtual$longitude)))
  expect_true(any(is.na(public_talks$latitude) & is.na(public_talks$longitude)))
  expect_true("Y" %in% public_talks$foundational_work)
  expect_true(any(!is.na(public_talks$secondary_pillar)))
  expect_gte(length(unique(public_talks$year)), 3)
})
