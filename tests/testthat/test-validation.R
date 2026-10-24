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

# Link URL rules. Every link field of both tabs, with the fixture and validator
# it belongs to; the first record of each fixture is included ("Y").
link_targets <- function() {
  target <- function(field, key, fixture, validate) {
    list(field = field, key = key, fixture = fixture, validate = validate)
  }
  c(
    lapply(site_config$url_fields$publications, target, "pub-1", publication_fixture(), validate_publications),
    lapply(site_config$url_fields$talks, target, "talk-1", talk_fixture(), validate_talks)
  )
}

set_link <- function(target, value, row = 1) {
  x <- target$fixture
  x[[target$field]][row] <- value
  x
}

# One bullet, naming the tab, record, field and the value as written in the sheet.
invalid_url_message <- function(tab, key, field, value) {
  sprintf('CV data validation failed:\n- %s: %s: %s is not a valid URL: "%s"', tab, key, field, value)
}

valid_link_urls <- c(
  "https://doi.org/10.1016/j.cell.2020.04.015",
  "https://example.org/search?q=a+b&page=2#results",
  "https://sub.example.org/a/b?x=1#y",
  "https://example.org:8443/talks/2026",
  "https://my-site.example.org:65535/",
  "https://example.org",
  "https://example.org?x=1",
  "https://www.zürich.ch/vortrag",
  "https://xn--bcher-kva.example/",
  "mailto:events@example.org",
  "mailto:first.last+talks@sub.example.org?subject=Hello%20there"
)

invalid_link_urls <- c(
  # host
  "https://doi:10.1016/j.ebiom.2023.104693",
  "https:///x",
  "https://",
  "https://example",
  "https://localhost/",
  "https://1.2.3.4/",
  "https://example.123/",
  "https://.com",
  "https://example..org",
  "https://-bad.com",
  "https://bad-.com",
  "https://exa_mple.org/",
  "https://[::1]/",
  paste0("https://", strrep("a", 64), ".org/"),
  # userinfo and port
  "https://user:pass@example.org/",
  "https://user@example.org/",
  "https://@example.org/",
  "https://example.org:abc/",
  "https://example.org:99999/",
  "https://example.org:0/",
  "https://example.org:/",
  # whitespace, control and invisible characters
  "https://exa mple.com",
  "https://example.org/a b",
  "https://example.org/a\tb",
  "https://example.org/a\nb",
  "https://example.org/a\u0001b",
  "https://example.org/​",
  "https://exa mple.org",
  # scheme
  "http://doi.org/10.0000/example.0001",
  "javascript:alert(1)",
  "data:text/html,hello",
  "HTTPS://example.org/",
  "example.org/no-scheme",
  "https:example.org",
  # mailto
  "mailto:",
  "mailto:events",
  "mailto:@example.org",
  "mailto:events@",
  "mailto:events@example",
  "mailto:a b@example.org",
  "mailto:a@b@example.org",
  "mailto:events@example.org,other@example.org"
)

test_that("is_valid_link_url accepts well-formed links and rejects malformed ones", {
  expect_equal(is_valid_link_url(valid_link_urls), rep(TRUE, length(valid_link_urls)))
  expect_equal(is_valid_link_url(invalid_link_urls), rep(FALSE, length(invalid_link_urls)))
  expect_false(is_valid_link_url(NA_character_))
})

test_that("well-formed links pass in every link field", {
  targets <- link_targets()
  expect_length(targets, 5)
  for (target in targets) {
    expect_equal(target$fixture$website_include[1], "Y")
    for (url in valid_link_urls) {
      expect_silent(target$validate(set_link(target, url)))
    }
  }
})

test_that("a malformed link fails with the record, field and value, in every link field", {
  for (target in link_targets()) {
    for (url in invalid_link_urls) {
      tab <- if (identical(target$validate, validate_publications)) "publications" else "talks"
      err <- expect_error(
        target$validate(set_link(target, url)),
        info = paste(target$field, url)
      )
      expect_identical(
        conditionMessage(err),
        invalid_url_message(tab, target$key, target$field, url),
        info = paste(target$field, url)
      )
    }
  }
})

test_that("the mistyped DOI link from the live sheet fails the build data", {
  x <- publication_fixture()
  x$doi_url[1] <- "https://doi:10.1016/j.ebiom.2023.104693"
  err <- expect_error(validate_publications(x))
  expect_identical(
    conditionMessage(err),
    invalid_url_message("publications", "pub-1", "doi_url", "https://doi:10.1016/j.ebiom.2023.104693")
  )
  # The corrected link is accepted.
  x$doi_url[1] <- "https://doi.org/10.1016/j.ebiom.2023.104693"
  expect_silent(validate_publications(x))
})

test_that("every malformed link is reported at once, across both tabs", {
  pubs <- publication_fixture()
  pubs$doi_url[1] <- "https://doi:10.1016/j.example.0001"
  pubs$doi_url[5] <- "http://doi.org/10.0000/example.0005"
  talks <- talk_fixture()
  talks$slides_url[1] <- "https://example"

  err <- expect_error(validate_cv_data(pubs, talks))
  expect_identical(
    conditionMessage(err),
    paste(
      "CV data validation failed:",
      '- publications: pub-1: doi_url is not a valid URL: "https://doi:10.1016/j.example.0001"',
      '- publications: pub-5: doi_url is not a valid URL: "http://doi.org/10.0000/example.0005"',
      '- talks: talk-1: slides_url is not a valid URL: "https://example"',
      sep = "\n"
    )
  )
})

test_that("malformed links on excluded rows do not fail, and are not reported", {
  pubs <- publication_fixture()
  out_pubs <- excluded_rows(pubs)
  expect_gt(sum(out_pubs), 0)
  pubs$doi_url[out_pubs] <- "https://doi:10.1016/x"

  talks <- talk_fixture()
  out_talks <- excluded_rows(talks)
  expect_gt(sum(out_talks), 0)
  for (field in site_config$url_fields$talks) talks[[field]][out_talks] <- "not a url"

  expect_silent(validate_cv_data(pubs, talks))

  # The same bad values on an included row still fail, and only that row.
  pubs$doi_url[1] <- "https://doi:10.1016/x"
  err <- expect_error(validate_cv_data(pubs, talks))
  expect_identical(
    conditionMessage(err),
    invalid_url_message("publications", "pub-1", "doi_url", "https://doi:10.1016/x")
  )
})

test_that("blank link fields are optional, and only warn", {
  raw <- fixture_sources()
  for (blank in c("", "   ")) {
    raw$publications$doi_url[1] <- blank
    raw$talks$event_url[1] <- blank
    raw$talks$slides_url[1] <- blank
    pubs <- normalize_publications(raw$publications)
    talks <- normalize_talks(raw$talks)
    expect_true(is.na(pubs$doi_url[1]))
    expect_equal(pubs$website_include[1], "Y")
    expect_silent(validate_cv_data(pubs, talks))
    expect_contains(
      collect_build_warnings(pubs, talks),
      c("publications: pub-1 has no doi_url")
    )
  }

  x <- talk_fixture()
  for (field in site_config$url_fields$talks) x[[field]] <- NA_character_
  expect_silent(validate_talks(x))
  expect_contains(
    collect_build_warnings(publication_fixture(), x),
    "talks: talk-1 has no event, slides, poster or recording link"
  )
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
