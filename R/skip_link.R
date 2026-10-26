# The skip link (spec 14) is the first focusable element on every page.
#
# Quarto 1.9 has no option for markup before the navbar: markup it includes
# (include-before-body) lands inside <main>, where its search index
# (search.json, written before any post-render step) also picks up the
# link's text, so every page would match a search for "skip" or "content".
# The link is therefore not given to Quarto at all: scripts/post-render.R (the
# project's post-render step, run after the search index is written) inserts
# the markup in includes/skip-link.html just after the <body> tag of every
# rendered page. It is done in the HTML itself, not by a script in the page,
# because the site works without JavaScript.

# The link as includes/skip-link.html writes it, on one line.
skip_link_pattern <- '<a class="skip-link[^"]*" href="#[^"<>]+">[^<]*</a>'

# The skip link's markup from `path`: its one nonblank line, which must be a
# skip link (an error otherwise).
read_skip_link <- function(path) {
  lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  lines <- trimws(lines[nzchar(trimws(lines))])
  if (length(lines) != 1 || !grepl(paste0("^", skip_link_pattern, "$"), lines, perl = TRUE)) {
    stop(path, " must hold one skip link on one line", call. = FALSE)
  }
  enc2utf8(lines)
}

# `x` from byte `start` to its end. (substring() without an end stops at
# 1,000,000 characters, which would cut a large page short.)
rest_of <- function(x, start) substr(x, start, nchar(x, type = "bytes"))

# `html` (one UTF-8 page, as one string) with exactly one skip link, `link`,
# just after its <body> tag. Any skip link already in the page is removed
# first, so the step is idempotent. The <body> tag is looked for only after
# </head>: a script in the head may contain the text "<body". An error if the
# page has no </head>, or no <body> tag after it. Positions are byte
# positions, so non-ASCII text is never re-encoded.
insert_skip_link <- function(html, link) {
  if (!grepl(paste0("^", skip_link_pattern, "$"), link, perl = TRUE)) stop("not a skip link: ", link, call. = FALSE)
  Encoding(html) <- "bytes"
  without <- gsub(paste0("\n?", skip_link_pattern), "", html, perl = TRUE, useBytes = TRUE)
  head_end <- regexpr("</head>", without, fixed = TRUE, useBytes = TRUE)
  if (head_end < 0) stop("the page has no </head> tag", call. = FALSE)
  after_head <- head_end + attr(head_end, "match.length")
  body <- regexpr("<body\\b[^>]*>", rest_of(without, after_head), perl = TRUE, useBytes = TRUE)
  if (body < 0) stop("the page has no <body> tag after </head>", call. = FALSE)
  body_end <- after_head - 1 + body + attr(body, "match.length") - 1
  inserted <- paste0(substr(without, 1, body_end), "\n", link, rest_of(without, body_end + 1))
  Encoding(inserted) <- "UTF-8"
  inserted
}

# Rewrites one HTML file in place (read and written as bytes).
insert_skip_link_file <- function(path, link) {
  html <- rawToChar(readBin(path, "raw", file.size(path)))
  updated <- tryCatch(insert_skip_link(html, link), error = function(error) {
    stop(path, ": ", conditionMessage(error), call. = FALSE)
  })
  writeBin(charToRaw(updated), path)
  invisible(path)
}
