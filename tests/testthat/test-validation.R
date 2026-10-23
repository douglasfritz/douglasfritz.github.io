excluded_rows <- function(x) is.na(x$website_include) | x$website_include == "N"

test_that("unexpected inclusion values identify the record", {
  x <- publication_fixture()
  x$website_include[1] <- "YES"
  expect_error(validate_inclusion_flags(x), "pub-1.*YES")
})

test_that("unexpected inclusion values fail on every row, not only public ones", {
  x <- talk_fixture()
  x$website_include[x$key == "talk-5"] <- "y"
  expect_error(validate_talks(x), "talk-5 has unexpected website_include value 'y'")
})

test_that("date and year conflicts fail", {
  x <- talk_fixture()
  x$date[1] <- as.Date("2026-03-25")
  x$year[1] <- 2025L
  expect_error(validate_talks(x), "talk-1.*date.*year")
})

test_that("missing coordinates do not invalidate an archive record", {
  x <- talk_fixture()
  x$latitude <- NA_real_
  x$longitude <- NA_real_
  expect_silent(validate_talks(x))
})

test_that("the fixtures pass full validation", {
  expect_silent(validate_cv_data(publication_fixture(), talk_fixture()))
})

test_that("duplicate keys fail, including among excluded rows", {
  pubs <- publication_fixture()
  pubs$key[pubs$key == "pub-2"] <- "pub-1"
  expect_error(validate_publications(pubs), "duplicate key 'pub-1'")

  talks <- talk_fixture()
  talks$key[talks$key == "talk-6"] <- "talk-5"
  expect_error(validate_talks(talks), "duplicate key 'talk-5'")
})

test_that("every required publication field is enforced for included records", {
  for (field in setdiff(site_config$required_fields$publications, "key")) {
    x <- publication_fixture()
    x[[field]][1] <- NA
    expect_error(
      validate_publications(x),
      paste0("pub-1 is missing required field ", field),
      info = field
    )
  }
})

test_that("every required talk field is enforced for included records", {
  for (field in setdiff(site_config$required_fields$talks, "key")) {
    x <- talk_fixture()
    x[[field]][1] <- NA
    expect_error(
      validate_talks(x),
      paste0("talk-1 is missing required field ", field),
      info = field
    )
  }
})

test_that("an included record with a blank key is reported by its sheet row", {
  x <- talk_fixture()
  x$key[1] <- NA
  expect_error(validate_talks(x), "row 2 \\(blank key\\) is missing required field key")
})

test_that("a published publication without a journal fails", {
  x <- publication_fixture()
  expect_equal(x$status[1], "Published")
  x$journal[1] <- NA
  expect_error(validate_publications(x), "pub-1 is missing required field journal")
})

test_that("publication status must be an approved value, exactly as written", {
  x <- publication_fixture()
  x$status[1] <- "Accepted"
  expect_error(validate_publications(x), "pub-1 has status 'Accepted'")
  x$status[1] <- "published"
  expect_error(validate_publications(x), "pub-1 has status 'published'")
})

test_that("pillars must be controlled values", {
  x <- publication_fixture()
  x$primary_pillar[1] <- "Umbrella identity"
  expect_error(validate_publications(x), "pub-1 has primary_pillar 'Umbrella identity'")

  x <- talk_fixture()
  x$secondary_pillar[1] <- "Pillar five"
  expect_error(validate_talks(x), "talk-1 has secondary_pillar 'Pillar five'")
})

test_that("primary and secondary pillars must differ", {
  x <- publication_fixture()
  x$secondary_pillar[1] <- x$primary_pillar[1]
  expect_error(validate_publications(x), "pub-1 has identical primary_pillar and secondary_pillar")

  x <- talk_fixture()
  x$secondary_pillar[2] <- x$primary_pillar[2]
  expect_error(validate_talks(x), "talk-2 has identical primary_pillar and secondary_pillar")
})

test_that("Y/N and scope fields only accept controlled values", {
  x <- publication_fixture()
  x$foundational_work[1] <- "Yes"
  expect_error(validate_publications(x), "pub-1 has foundational_work 'Yes'")

  x <- talk_fixture()
  x$presented_by_me[1] <- "y"
  expect_error(validate_talks(x), "talk-1 has presented_by_me 'y'")

  x <- talk_fixture()
  x$virtual_status[1] <- "Virtual"
  expect_error(validate_talks(x), "talk-1 has virtual_status 'Virtual'")

  x <- talk_fixture()
  x$event_scope[1] <- "global"
  expect_error(validate_talks(x), "talk-1 has event_scope 'global'")
})

test_that("links must use https or mailto", {
  x <- publication_fixture()
  x$doi_url[1] <- "http://doi.org/10.0000/example.0001"
  expect_error(validate_publications(x), "pub-1 has a disallowed URL in doi_url")

  for (field in site_config$url_fields$talks) {
    x <- talk_fixture()
    x[[field]][1] <- "javascript:alert(1)"
    expect_error(validate_talks(x), paste0("talk-1 has a disallowed URL in ", field), info = field)
  }

  for (bad in c("example.org/no-scheme", "https:example.org", "https://example.org/a b")) {
    x <- talk_fixture()
    x$event_url[1] <- bad
    expect_error(validate_talks(x), "talk-1 has a disallowed URL in event_url", info = bad)
  }

  x <- talk_fixture()
  x$event_url[1] <- "mailto:events@example.org"
  x$slides_url[1] <- "https://example.org/slides/talk-1.pdf"
  expect_silent(validate_talks(x))
})

test_that("coordinates must be within bounds and come in pairs", {
  x <- talk_fixture()
  x$latitude[1] <- 95
  expect_error(validate_talks(x), "talk-1 has invalid latitude")

  x <- talk_fixture()
  x$longitude[1] <- -190
  expect_error(validate_talks(x), "talk-1 has invalid longitude")

  x <- talk_fixture()
  x$longitude[1] <- NA
  expect_error(validate_talks(x), "talk-1 has latitude without longitude")
})

test_that("excluded rows may be unfinished without failing the build", {
  pubs <- publication_fixture()
  out <- excluded_rows(pubs)
  pubs$primary_pillar[out] <- "Not a pillar"
  pubs$journal[out] <- NA
  pubs$status[out] <- "Draft"
  pubs$doi_url[out] <- "http://example.org/draft"

  talks <- talk_fixture()
  out <- excluded_rows(talks)
  talks$organization[out] <- NA
  talks$event_scope[out] <- "galactic"
  talks$latitude[out] <- 500
  talks$longitude[out] <- NA
  talks$date[out] <- as.Date("2020-01-01")
  talks$year[out] <- 1999L

  expect_silent(validate_cv_data(pubs, talks))
})

test_that("validate_cv_data reports every problem from both sources at once", {
  pubs <- publication_fixture()
  pubs$key[2] <- "pub-1"
  talks <- talk_fixture()
  talks$primary_pillar[1] <- "Pillar five"

  err <- expect_error(validate_cv_data(pubs, talks))
  expect_match(conditionMessage(err), "publications: duplicate key 'pub-1'")
  expect_match(conditionMessage(err), "talks: talk-1 has primary_pillar 'Pillar five'")
})

test_that("build warnings flag incomplete included records only", {
  expect_setequal(
    collect_build_warnings(publication_fixture(), talk_fixture()),
    c(
      "publications: pub-2 has no doi_url",
      "publications: pub-2 has no plain_summary",
      "talks: talk-3 has no short_description",
      "talks: talk-3 has no event, slides, poster or recording link",
      "talks: talk-3 has no verified coordinates and will be omitted from the map"
    )
  )
})

test_that("an included talk without coordinates warns but stays valid", {
  talks <- talk_fixture()
  talks$latitude[1] <- NA
  talks$longitude[1] <- NA
  expect_silent(validate_talks(talks))
  expect_contains(
    collect_build_warnings(publication_fixture(), talks),
    "talks: talk-1 has no verified coordinates and will be omitted from the map"
  )
})
