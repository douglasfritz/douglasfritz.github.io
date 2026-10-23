required <- c(
  "_quarto.yml", "index.qmd", "research/index.qmd",
  "publications/index.qmd", "talks/index.qmd",
  "about/index.qmd", "cv/index.qmd",
  "styles/_variables.scss", "styles/_components.scss", "styles/styles.scss"
)
missing <- required[!file.exists(required)]
if (length(missing)) stop("Missing required site files: ", paste(missing, collapse = ", "))

config <- paste(readLines("_quarto.yml", warn = FALSE), collapse = "\n")
expected_nav <- c("Home", "Research", "Publications", "Talks & Reach", "About", "CV")
stopifnot(all(vapply(expected_nav, grepl, logical(1), x = config, fixed = TRUE)))

scss <- paste(readLines("styles/_variables.scss", warn = FALSE), collapse = "\n")
expected_colors <- c("#E0FBFC", "#C2DFE3", "#9DB4C0", "#5C6B73", "#253237")
stopifnot(all(vapply(expected_colors, grepl, logical(1), x = toupper(scss), fixed = TRUE)))
stopifnot(!grepl("schedule:", config, fixed = TRUE))
