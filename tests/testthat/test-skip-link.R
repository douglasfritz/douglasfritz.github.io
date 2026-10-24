# The post-render step that puts the skip link first in every page
# (R/skip_link.R, scripts/post-render.R).

repo_root <- function(...) testthat::test_path("..", "..", ...)
skip_link <- '<a class="skip-link visually-hidden-focusable" href="#quarto-document-content">Skip to main content</a>'
# A page as Quarto renders it: the included link at the top of <main>.
page_html <- function(link = skip_link, title = "Talks & Reach") {
  paste0(
    "<!DOCTYPE html>\n<html lang=\"en\"><head><title>", title, "</title></head>\n",
    "<body class=\"nav-fixed fullcontent\">\n\n<div id=\"quarto-search-results\"></div>\n",
    "<header id=\"quarto-header\"><nav class=\"navbar\"><a class=\"navbar-brand\" href=\"./index.html\">Home</a></nav></header>\n",
    "<main class=\"content\" id=\"quarto-document-content\">\n", link, "\n<script type=\"module\" src=\"./js/site.js\"></script>\n",
    "<h1>", title, "</h1>\n</main>\n</body></html>\n"
  )
}

test_that("the skip link moves from <main> to just after <body>", {
  moved <- move_skip_link(page_html())
  expect_match(moved, paste0('<body class="nav-fixed fullcontent">\n', skip_link, "\n\n<div id=\"quarto-search-results\">"), fixed = TRUE)
  # Once, before the navbar; the rest of <main> is unchanged.
  expect_length(gregexpr("skip-link", moved, fixed = TRUE)[[1]], 1)
  expect_lt(regexpr("skip-link", moved, fixed = TRUE), regexpr("navbar-brand", moved, fixed = TRUE))
  expect_match(moved, '<main class="content" id="quarto-document-content">\n<script type="module" src="./js/site.js"></script>', fixed = TRUE)
  # Nothing else changes: only the link's line moved.
  expect_identical(nchar(moved, type = "bytes"), nchar(page_html(), type = "bytes"))
})

test_that("moving is idempotent and keeps UTF-8 text byte for byte", {
  title <- "Talks – café · “reach”"
  html <- enc2utf8(page_html(title = title))
  once <- move_skip_link(html)
  expect_identical(move_skip_link(once), once)
  expect_identical(Encoding(once), "UTF-8")
  expect_match(once, paste0("<h1>", title, "</h1>"), fixed = TRUE)
  expect_identical(sort(as.integer(charToRaw(once))), sort(as.integer(charToRaw(html))))
})

test_that("a page without exactly one skip link, or without <body>, is an error", {
  expect_error(move_skip_link(page_html(link = "")), "found 0")
  expect_error(move_skip_link(page_html(link = paste(skip_link, skip_link))), "found 2")
  expect_error(move_skip_link(sub("<body[^>]*>", "", page_html())), "no <body> tag")
})

test_that("files are rewritten in place, and errors name the file", {
  dir <- withr::local_tempdir()
  path <- file.path(dir, "index.html")
  html <- enc2utf8(page_html(title = "Café"))
  writeBin(charToRaw(html), path)
  move_skip_link_file(path)
  expect_identical(rawToChar(readBin(path, "raw", file.size(path))), as.character(move_skip_link(html)))
  broken <- file.path(dir, "broken.html")
  writeBin(charToRaw(page_html(link = "")), broken)
  expect_error(move_skip_link_file(broken), "broken.html: expected one skip link")
})

test_that("the include, the post-render step and the site config agree", {
  include <- paste(readLines(repo_root("includes", "skip-link.html"), warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  expect_match(include, skip_link, fixed = TRUE)
  expect_match(include, skip_link_pattern, perl = TRUE)
  quarto <- read_yaml_utf8(repo_root("_quarto.yml"))
  expect_identical(quarto$project$`post-render`, "scripts/post-render.R")
  expect_identical(quarto$format$html$`include-before-body`, "includes/skip-link.html")
})
