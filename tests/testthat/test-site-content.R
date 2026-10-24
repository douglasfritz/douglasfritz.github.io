# Site content and identity (data/site.yml, the Home, About and CV pages,
# includes/, _quarto.yml): privacy, the documented keys, and agreement
# between the Person JSON-LD, the profile links and data/site.yml.

repo_path <- function(...) testthat::test_path("..", "..", ...)
read_text <- function(path) paste(readLines(path, encoding = "UTF-8", warn = FALSE), collapse = "\n")

# Generic detectors: never the real number or address, only their shapes.
# A phone-like string is a run of digits with optional +, spaces, dots,
# hyphens or brackets that holds 9 to 15 digits; ORCID iDs and ISO dates
# are long digit runs that are not phone numbers, so they are removed first.
phone_like <- function(text) {
  text <- gsub("\\b\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dX]\\b", " ", text, perl = TRUE)
  text <- gsub("\\b\\d{4}-\\d{2}-\\d{2}\\b", " ", text, perl = TRUE)
  runs <- regmatches(text, gregexpr("\\+?\\(?\\d[\\d ().-]{5,}\\d", text, perl = TRUE))[[1]]
  digits <- nchar(gsub("\\D", "", runs))
  runs[digits >= 9 & digits <= 15]
}
email_like <- function(text) {
  regmatches(text, gregexpr("[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}", text, perl = TRUE))[[1]]
}

# Every file that carries public site copy or identity (spec 16).
content_files <- function() {
  c(
    "index.qmd", "about/index.qmd", "cv/index.qmd", "_pillars.qmd", "data/site.yml",
    "README.md", "_quarto.yml", file.path("includes", list.files(repo_path("includes")))
  )
}

site <- read_site_config(repo_path("data", "site.yml"))
quarto <- read_yaml_utf8(repo_path("_quarto.yml"))
site_url <- quarto$website$`site-url`
profile_urls <- c(
  github = "https://github.com/douglasfritz",
  orcid = "https://orcid.org/0000-0001-8822-4639",
  linkedin = "https://www.linkedin.com/in/douglas-fritz"
)

person_jsonld <- function() {
  html <- read_text(repo_path("includes", "person-jsonld.html"))
  scripts <- regmatches(html, gregexpr('(?s)<script type="application/ld\\+json">(.*?)</script>', html, perl = TRUE))[[1]]
  expect_length(scripts, 1)
  jsonlite::fromJSON(sub('(?s)^<script[^>]*>(.*)</script>$', "\\1", scripts[[1]], perl = TRUE), simplifyVector = FALSE)
}

test_that("the detectors find phone- and email-like text and nothing else", {
  # Synthetic shapes only (repeated digits, a reserved example domain).
  phones <- c(
    paste("+99", strrep("0", 4), strrep("1", 6)), paste0(strrep("0", 5), " ", strrep("1", 6)),
    paste0("(", strrep("0", 3), ") ", strrep("1", 3), "-", strrep("2", 4)), paste(strrep("0", 3), strrep("1", 3), strrep("2", 4), sep = "."),
    strrep("0", 11)
  )
  for (phone in phones) expect_length(phone_like(paste("Call", phone, "today")), 1)
  not_phones <- c(
    "https://orcid.org/0000-0001-8822-4639", "Updated 2026-10-24", "width: 800, height: 1066",
    "https://doi.org/10.0000/example.0001", "Validated 5 publications (3 public)", "renv 1.0.7 and R 4.4.0",
    "127.0.0.1:4321", "2015–2026"
  )
  for (text in not_phones) expect_length(phone_like(text), 0)
  expect_length(email_like(paste("Write to", paste0("someone", "@", "example.org"))), 1)
  expect_length(email_like("@playwright/test and git push"), 0)
})

test_that("site content contains no phone number, email address, private source URL or contact scheme", {
  files <- content_files()
  expect_true(all(c("includes/person-jsonld.html", "data/site.yml", "README.md") %in% files))
  for (file in files) {
    expect_true(file.exists(repo_path(file)), info = file)
    text <- read_text(repo_path(file))
    expect_gt(nchar(text), 0)
    expect_identical(phone_like(text), character(0), info = file)
    expect_identical(email_like(text), character(0), info = file)
    expect_false(grepl("docs.google.com/spreadsheets", text, fixed = TRUE), info = file)
    expect_false(grepl("mailto:", text, fixed = TRUE), info = file)
    expect_false(grepl("\\btel:", text, perl = TRUE), info = file)
  }
})

test_that("data/site.yml has exactly the documented public keys", {
  raw <- read_yaml_utf8(repo_path("data", "site.yml"))
  expect_setequal(names(raw), site_keys)
  expect_false(any(grepl("mail|phone|tel", names(raw), ignore.case = TRUE)))
  expect_identical(site$name, "Douglas Fritz")
  expect_identical(site$umbrella, "Translational physician-scientist for public health")
  # The umbrella is the one the pillar component shows.
  expect_identical(site$umbrella, pillar_umbrella)
  expect_identical(unlist(site$profiles), profile_urls)
  expect_identical(site$cv_pdf, "assets/documents/Douglas_Fritz_CV.pdf")
  expect_true(is.null(site$cv_updated) || is_iso_date(site$cv_updated))
  expect_gt(length(site$affiliations), 0)
  expect_true(nzchar(site$headshot$alt))
})

test_that("read_site_config refuses unknown keys, private fields and malformed values", {
  raw <- read_yaml_utf8(repo_path("data", "site.yml"))
  bad <- withr::local_tempfile(fileext = ".yml")
  refuses <- function(change, message) {
    value <- change(raw)
    writeLines(enc2utf8(yaml::as.yaml(value)), bad, useBytes = TRUE)
    expect_error(read_site_config(bad), message)
  }
  refuses(function(x) c(x, list(contact = "someone")), "must have exactly the keys")
  refuses(function(x) x[setdiff(names(x), "position")], "must have exactly the keys")
  refuses(function(x) { x$name <- " "; x }, "'name' must be nonempty text")
  refuses(function(x) { x$profiles$github <- "http://github.com/douglasfritz"; x }, "profile 'github' must be an https:// URL")
  refuses(function(x) { x$profiles <- x$profiles[c(2, 1, 3)]; x }, "'profiles' must be exactly")
  refuses(function(x) { x$profiles$email <- "https://example.org"; x }, "'profiles' must be exactly")
  refuses(function(x) { x$cv_pdf <- "../Douglas_Fritz_CV.pdf"; x }, "'cv_pdf' must be")
  refuses(function(x) { x$cv_pdf <- "assets/documents/cv.docx"; x }, "'cv_pdf' must be")
  refuses(function(x) { x$cv_updated <- "2026-02-30"; x }, "'cv_updated' must be")
  refuses(function(x) { x$cv_updated <- "24 October 2026"; x }, "'cv_updated' must be")
  refuses(function(x) { x$affiliations <- list(); x }, "'affiliations' must list")
  refuses(function(x) { x$affiliations[[1]]$phone <- "x"; x }, "each affiliation needs")
  refuses(function(x) { x$headshot$src <- "https://example.org/me.jpg"; x }, "'headshot' needs")
  refuses(function(x) { x$headshot$alt <- ""; x }, "'headshot' needs")

  ok <- raw
  ok$cv_updated <- "2026-10-24"
  writeLines(enc2utf8(yaml::as.yaml(ok)), bad, useBytes = TRUE)
  expect_identical(read_site_config(bad)$cv_updated, "2026-10-24")
})

test_that("the Person JSON-LD holds only approved public identity fields that match data/site.yml", {
  person <- person_jsonld()
  expect_setequal(names(person), c("@context", "@type", "name", "url", "image", "jobTitle", "sameAs"))
  expect_identical(person$`@context`, "https://schema.org")
  expect_identical(person$`@type`, "Person")
  expect_identical(person$name, site$name)
  expect_identical(person$url, site_url)
  expect_identical(person$image, paste0(site_url, site$headshot$src))
  expect_identical(person$jobTitle, site$position)
  expect_identical(unlist(person$sameAs), unname(profile_urls))
  expect_false(any(grepl("mail|phone|tel|address", names(person), ignore.case = TRUE)))
})

test_that("only the Home and About pages include the Person JSON-LD", {
  pages <- list.files(repo_path(), pattern = "[.]qmd$", recursive = TRUE)
  pages <- pages[!grepl("^(renv|node_modules|_site)/", pages)]
  expect_true(all(c("index.qmd", "about/index.qmd", "cv/index.qmd", "research/index.qmd") %in% pages))
  including <- pages[vapply(pages, function(page) grepl("person-jsonld", read_text(repo_path(page)), fixed = TRUE), logical(1))]
  expect_setequal(including, c("index.qmd", "about/index.qmd"))
  expect_false(grepl("person-jsonld", read_text(repo_path("_quarto.yml")), fixed = TRUE))
})

test_that("the navbar and footer link the same profiles with descriptive names", {
  right <- quarto$website$navbar$right
  expect_identical(vapply(right, function(item) item$href, character(1)), unname(profile_urls[c("github", "linkedin")]))
  expect_identical(vapply(right, function(item) item$`aria-label`, character(1)), c("Douglas Fritz on GitHub", "Douglas Fritz on LinkedIn"))
  expect_identical(vapply(right, function(item) item$icon, character(1)), c("github", "linkedin"))
  footer <- quarto$website$`page-footer`$center
  links <- regmatches(footer, gregexpr("\\[([^]]+)\\]\\(([^)]+)\\)\\{[^}]*aria-label=\"([^\"]+)\"\\}", footer, perl = TRUE))[[1]]
  expect_length(links, 3)
  expect_identical(sub("^.*\\]\\(([^)]+)\\).*$", "\\1", links), unname(profile_urls))
  expect_identical(sub('^.*aria-label="([^"]+)".*$', "\\1", links), paste("Douglas Fritz on", c("GitHub", "ORCID", "LinkedIn")))
  expect_false(grepl("target", footer, fixed = TRUE))
  # Site-wide metadata (spec 15).
  expect_identical(quarto$website$favicon, "assets/images/favicon.svg")
  expect_true(isTRUE(quarto$website$`open-graph`))
  expect_identical(quarto$website$`twitter-card`$`card-style`, "summary")
  expect_true(isTRUE(quarto$format$html$`canonical-url`))
  expect_identical(site_url, "https://douglasfritz.github.io/")
})

# JPEG segments up to the image data: marker byte and length.
jpeg_segments <- function(path) {
  bytes <- readBin(path, "raw", file.size(path))
  expect_identical(bytes[1:2], as.raw(c(0xFF, 0xD8)))
  i <- 3
  segments <- list()
  repeat {
    expect_identical(bytes[[i]], as.raw(0xFF))
    marker <- as.integer(bytes[[i + 1]])
    length <- as.integer(bytes[[i + 2]]) * 256L + as.integer(bytes[[i + 3]])
    segments[[length(segments) + 1]] <- list(marker = marker, start = i + 4, length = length)
    if (marker == 0xDA) break
    i <- i + 2 + length
  }
  list(bytes = bytes, segments = segments)
}

test_that("the headshot is a small JPEG without camera, location or date metadata", {
  path <- repo_path(site$headshot$src)
  expect_true(file.exists(path))
  expect_lt(file.size(path), 200 * 1024)
  jpeg <- jpeg_segments(path)
  markers <- vapply(jpeg$segments, function(s) s$marker, integer(1))
  # Only a JFIF APP0 header: no APP1 (EXIF/XMP), APP2 (ICC), APP13 (IPTC),
  # other APPn or comment segments.
  app <- markers[markers >= 0xE0 & markers <= 0xEF]
  expect_identical(app, 0xE0L)
  expect_false(0xFE %in% markers)
  app0 <- jpeg$segments[[which(markers == 0xE0)]]
  expect_identical(rawToChar(jpeg$bytes[app0$start:(app0$start + 3)]), "JFIF")
  # The width and height in data/site.yml are the image's own.
  sof <- jpeg$segments[[which(markers %in% c(0xC0, 0xC2))[[1]]]]
  at <- sof$start + 1
  height <- as.integer(jpeg$bytes[[at]]) * 256L + as.integer(jpeg$bytes[[at + 1]])
  width <- as.integer(jpeg$bytes[[at + 2]]) * 256L + as.integer(jpeg$bytes[[at + 3]])
  expect_identical(c(width, height), as.integer(c(site$headshot$width, site$headshot$height)))
})

test_that("the favicon is an abstract SVG in the site palette", {
  svg <- read_text(repo_path(quarto$website$favicon))
  expect_match(svg, "^<svg xmlns=\"http://www.w3.org/2000/svg\"")
  expect_false(grepl("<(text|image|script|foreignObject)\\b", svg, perl = TRUE))
  colours <- toupper(unique(regmatches(svg, gregexpr("#[0-9A-Fa-f]{6}", svg))[[1]]))
  expect_gt(length(colours), 3)
  expect_true(all(colours %in% c("#E0FBFC", "#C2DFE3", "#9DB4C0", "#5C6B73", "#253237", "#FFFFFF")))
})
