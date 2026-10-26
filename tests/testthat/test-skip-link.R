# The post-render step that puts the skip link first in every page
# (R/skip_link.R, scripts/post-render.R, includes/skip-link.html).

repo_root <- function(...) testthat::test_path("..", "..", ...)
skip_link <- '<a class="skip-link visually-hidden-focusable" href="#quarto-document-content">Skip to main content</a>'
# A page as Quarto renders it (`in_main` is markup at the top of <main>;
# `head` is extra markup in <head>).
page_html <- function(in_main = "", title = "Talks & Reach", head = "") {
  paste0(
    "<!DOCTYPE html>\n<html lang=\"en\"><head><title>", title, "</title>", head, "</head>\n",
    "<body class=\"nav-fixed fullcontent\">\n\n<div id=\"quarto-search-results\"></div>\n",
    "<header id=\"quarto-header\"><nav class=\"navbar\"><a class=\"navbar-brand\" href=\"./index.html\">Home</a></nav></header>\n",
    "<main class=\"content\" id=\"quarto-document-content\">\n", in_main, "<script type=\"module\" src=\"./js/site.js\"></script>\n",
    "<h1>", title, "</h1>\n</main>\n</body></html>\n"
  )
}
count_links <- function(html) sum(gregexpr("skip-link", html, fixed = TRUE)[[1]] > 0)
# The MD5 checksum of a string's bytes, as tools::md5sum gives for a file.
digest_of <- function(text) {
  path <- withr::local_tempfile()
  writeBin(charToRaw(text), path)
  unname(tools::md5sum(path))
}

test_that("the skip link is inserted once, just after <body>, before the navbar", {
  inserted <- insert_skip_link(page_html(), skip_link)
  expect_match(inserted, paste0('<body class="nav-fixed fullcontent">\n', skip_link, "\n\n<div id=\"quarto-search-results\">"), fixed = TRUE)
  expect_identical(count_links(inserted), 1L)
  expect_lt(regexpr("skip-link", inserted, fixed = TRUE), regexpr("navbar-brand", inserted, fixed = TRUE))
  # Nothing else changes.
  expect_identical(sub(paste0("\n", skip_link), "", inserted, fixed = TRUE), page_html())
})

test_that("inserting is idempotent, and a skip link already elsewhere is moved, not doubled", {
  once <- insert_skip_link(page_html(), skip_link)
  expect_identical(insert_skip_link(once, skip_link), once)
  # A link left inside <main> (where include-before-body would put it).
  from_main <- insert_skip_link(page_html(in_main = paste0(skip_link, "\n")), skip_link)
  expect_identical(from_main, once)
  expect_identical(count_links(from_main), 1L)
})

test_that("a page with two skip links ends with exactly one, first in <body>", {
  twice <- page_html(in_main = paste0(skip_link, "\n<p>text</p>\n", skip_link, "\n"))
  expect_identical(count_links(twice), 2L)
  inserted <- insert_skip_link(twice, skip_link)
  expect_identical(count_links(inserted), 1L)
  expect_match(inserted, paste0('<body class="nav-fixed fullcontent">\n', skip_link, "\n"), fixed = TRUE)
  expect_identical(inserted, insert_skip_link(page_html(in_main = "<p>text</p>\n"), skip_link))
})

test_that("a page over 1 MB is kept whole, byte for byte, and a second run changes nothing", {
  # About 2.5 MB of markup with non-ASCII text after the insertion point.
  chunk <- enc2utf8("<p>Caf\u00e9 \u2013 r\u00e9sum\u00e9 \u00b7 a long line of ordinary page text.</p>\n")
  body_text <- paste(rep(chunk, ceiling(2.5e6 / nchar(chunk, type = "bytes"))), collapse = "")
  html <- enc2utf8(page_html(in_main = body_text))
  expect_gt(nchar(html, type = "bytes"), 2.5e6)
  inserted <- insert_skip_link(html, skip_link)
  # Exactly the link and one line break more, and nothing else changed.
  expect_identical(nchar(inserted, type = "bytes"), nchar(html, type = "bytes") + nchar(skip_link, type = "bytes") + 1L)
  expect_identical(charToRaw(sub(paste0("\n", skip_link), "", inserted, fixed = TRUE)), charToRaw(html))
  expect_match(inserted, paste0(chunk, "<script type=\"module\""), fixed = TRUE)
  expect_true(endsWith(inserted, "</main>\n</body></html>\n"))
  expect_identical(insert_skip_link(inserted, skip_link), inserted)
  # The same through a file.
  path <- withr::local_tempfile(fileext = ".html")
  writeBin(charToRaw(html), path)
  insert_skip_link_file(path, skip_link)
  expect_equal(file.size(path), nchar(inserted, type = "bytes"))
  expect_identical(unname(tools::md5sum(path)), digest_of(inserted))
})

test_that("the <body> tag is looked for only after </head>", {
  # A head script that mentions "<body": the link must not go into <head>.
  head <- "<script>const shell = '<body class=\"x\">';</script>"
  inserted <- insert_skip_link(page_html(head = head), skip_link)
  expect_match(inserted, paste0(head, "</head>"), fixed = TRUE)
  expect_match(inserted, paste0('<body class="nav-fixed fullcontent">\n', skip_link), fixed = TRUE)
  expect_gt(regexpr(skip_link, inserted, fixed = TRUE), regexpr("</head>", inserted, fixed = TRUE))
  expect_identical(count_links(inserted), 1L)
})

test_that("UTF-8 text is kept byte for byte", {
  title <- "Talks – café · “reach”"
  html <- enc2utf8(page_html(title = title))
  inserted <- insert_skip_link(html, skip_link)
  expect_identical(Encoding(inserted), "UTF-8")
  expect_match(inserted, paste0("<h1>", title, "</h1>"), fixed = TRUE)
  expect_identical(charToRaw(sub(paste0("\n", skip_link), "", inserted, fixed = TRUE)), charToRaw(html))
})

test_that("a page without </head> or without <body> after it, or a link that is not a skip link, is an error", {
  expect_error(insert_skip_link(sub("</head>", "", page_html(), fixed = TRUE), skip_link), "no </head> tag")
  expect_error(insert_skip_link(sub("<body[^>]*>", "", page_html()), skip_link), "no <body> tag after </head>")
  expect_error(insert_skip_link(page_html(), '<a href="#main">Skip</a>'), "not a skip link")
})

test_that("files are rewritten in place, and errors name the file", {
  dir <- withr::local_tempdir()
  path <- file.path(dir, "index.html")
  html <- enc2utf8(page_html(title = "Café"))
  writeBin(charToRaw(html), path)
  insert_skip_link_file(path, skip_link)
  expect_identical(readBin(path, "raw", file.size(path)), charToRaw(insert_skip_link(html, skip_link)))
  broken <- file.path(dir, "broken.html")
  writeBin(charToRaw("<html><body></body></html>"), broken)
  expect_error(insert_skip_link_file(broken, skip_link), "broken.html: the page has no </head> tag")
})

test_that("the link's markup file holds exactly one skip link", {
  expect_identical(read_skip_link(repo_root("includes", "skip-link.html")), skip_link)
  dir <- withr::local_tempdir()
  for (text in c("", "<a href=\"#x\">Skip</a>", paste(skip_link, skip_link, sep = "\n"))) {
    path <- file.path(dir, "link.html")
    writeLines(text, path)
    expect_error(read_skip_link(path), "must hold one skip link")
  }
})

test_that("the site config adds the link after rendering, never through Quarto's includes", {
  quarto <- read_yaml_utf8(repo_root("_quarto.yml"))
  expect_identical(quarto$project$`post-render`, "scripts/post-render.R")
  includes <- unlist(quarto$format$html[c("include-before-body", "include-after-body", "include-in-header")])
  expect_false("includes/skip-link.html" %in% includes)
  expect_identical(quarto$format$html$`include-before-body`, "includes/site-script.html")
  site_script <- paste(readLines(repo_root("includes", "site-script.html"), warn = FALSE), collapse = "\n")
  expect_false(grepl("skip-link", site_script, fixed = TRUE))
  post_render <- paste(readLines(repo_root("scripts", "post-render.R"), warn = FALSE), collapse = "\n")
  expect_match(post_render, "insert_skip_link_file", fixed = TRUE)
})

# scripts/post-render.R in a fresh R process, from the repository root, with
# QUARTO_PROJECT_OUTPUT_FILES set to `outputs` (NA: unset).
run_post_render <- function(outputs) {
  rscript <- file.path(R.home("bin"), "Rscript")
  withr::with_dir(normalizePath(repo_root()), withr::with_envvar(
    c(QUARTO_PROJECT_OUTPUT_FILES = outputs),
    suppressWarnings(system2(rscript, file.path("scripts", "post-render.R"), stdout = TRUE, stderr = TRUE))
  ))
}

test_that("the post-render step fails loudly when Quarto gives it no pages", {
  for (outputs in list(NA_character_, "", "index.xml\nsitemap.xml")) {
    output <- run_post_render(outputs)
    expect_false(is.null(attr(output, "status")), info = outputs)
    expect_gt(attr(output, "status"), 0)
    expect_match(paste(output, collapse = "\n"), "QUARTO_PROJECT_OUTPUT_FILES lists no HTML pages", fixed = TRUE)
  }
})

test_that("the post-render step puts the skip link first in every listed page", {
  site <- withr::local_tempdir()
  pages <- file.path(site, c("index.html", file.path("about", "index.html")))
  dir.create(file.path(site, "about"))
  for (page in pages) writeBin(charToRaw(enc2utf8(page_html(title = "Caf\u00e9"))), page)
  output <- run_post_render(paste(c(normalizePath(pages), file.path(site, "search.json")), collapse = "\n"))
  expect_null(attr(output, "status"))
  for (page in pages) {
    html <- rawToChar(readBin(page, "raw", file.size(page)))
    expect_identical(count_links(html), 1L)
    expect_match(html, paste0('<body class="nav-fixed fullcontent">\n', skip_link), fixed = TRUE)
  }
})
