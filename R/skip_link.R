# The skip link (spec 14) is the first focusable element on every page.
#
# includes/skip-link.html is added with include-before-body, which Quarto 1.9
# places at the top of <main>, after the navbar; Quarto has no option for
# markup before the navbar. scripts/post-render.R (the project's post-render
# step) therefore moves the link to the start of <body> in every rendered
# page. It is done in the HTML itself, not by a script in the page, because
# the site works without JavaScript.

# The link as includes/skip-link.html writes it, on one line.
skip_link_pattern <- '<a class="skip-link[^"]*" href="#[^"<>]+">[^<]*</a>'

# `html` (one UTF-8 page, as one string) with its one skip link moved to just
# after the <body> tag. Idempotent; an error if the page has no <body> tag or
# not exactly one skip link (so that a page without one fails the build).
# Positions are byte positions, so non-ASCII text is never re-encoded.
move_skip_link <- function(html) {
  Encoding(html) <- "bytes"
  found <- gregexpr(skip_link_pattern, html, perl = TRUE, useBytes = TRUE)[[1]]
  count <- sum(found > 0)
  if (count != 1) stop("expected one skip link in the page, found ", count, call. = FALSE)
  start <- found[[1]]
  end <- start + attr(found, "match.length")[[1]] - 1
  link <- substr(html, start, end)
  # Remove the link and the line break before it, then insert it after <body>.
  if (start > 1 && substr(html, start - 1, start - 1) == "\n") start <- start - 1
  without <- paste0(substr(html, 1, start - 1), substring(html, end + 1))
  body <- regexpr("<body\\b[^>]*>", without, perl = TRUE, useBytes = TRUE)
  if (body < 0) stop("the page has no <body> tag", call. = FALSE)
  body_end <- body + attr(body, "match.length") - 1
  moved <- paste0(substr(without, 1, body_end), "\n", link, substring(without, body_end + 1))
  Encoding(moved) <- "UTF-8"
  moved
}

# Rewrites one HTML file in place (read and written as bytes).
move_skip_link_file <- function(path) {
  html <- rawToChar(readBin(path, "raw", file.size(path)))
  moved <- tryCatch(move_skip_link(html), error = function(error) {
    stop(path, ": ", conditionMessage(error), call. = FALSE)
  })
  writeBin(charToRaw(moved), path)
  invisible(path)
}
