#!/usr/bin/env Rscript
# Builds the public website data from the CV sheet:
# import -> normalize -> validate -> export (publications.yml, talks.yml,
# talks.geojson, pillars.json, build-metadata.json).
#
# Usage, from the repository root:
#   Rscript scripts/build_data.R [--publications PATH] [--talks PATH] [--output-dir DIR]
#
# --publications / --talks read local CSV files instead of the public sheet;
# --output-dir defaults to data/generated. Any import or validation failure,
# or a tab with no public rows, exits nonzero before anything is written.
# Otherwise the five files replace the previous ones together, and a failed
# write leaves the previous files unchanged. Warnings never fail the build.

build_usage <- paste(
  "Usage: Rscript scripts/build_data.R",
  "[--publications PATH] [--talks PATH] [--output-dir DIR]"
)

parse_build_args <- function(args, root) {
  opts <- list(
    publications = NULL,
    talks = NULL,
    output_dir = file.path(root, site_config$output_dir)
  )
  flags <- c("--publications" = "publications", "--talks" = "talks", "--output-dir" = "output_dir")
  i <- 1L
  while (i <= length(args)) {
    flag <- args[[i]]
    if (!flag %in% names(flags)) {
      stop("Unknown argument '", flag, "'.\n", build_usage, call. = FALSE)
    }
    if (i == length(args) || startsWith(args[[i + 1L]], "--")) {
      stop("Missing value for ", flag, ".\n", build_usage, call. = FALSE)
    }
    opts[[flags[[flag]]]] <- args[[i + 1L]]
    i <- i + 2L
  }
  opts
}

# Repository root: two levels above this script when run with Rscript.
build_root <- function() {
  file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
  if (!length(file_arg)) return(getwd())
  dirname(dirname(normalizePath(sub("^--file=", "", file_arg[[1]]))))
}

# Runs the pipeline; stops on any failure. Returns the normalized, validated
# sources, the public datasets and the output directory.
main <- function(args = commandArgs(trailingOnly = TRUE), root = build_root()) {
  opts <- parse_build_args(args, root)

  sources <- import_cv_data(publications = opts$publications, talks = opts$talks)
  publications <- normalize_publications(sources$publications)
  talks <- normalize_talks(sources$talks)
  validate_cv_data(publications, talks)

  for (text in collect_build_warnings(publications, talks)) {
    message("WARNING: ", text)
  }

  built <- build_public_data(publications, talks)
  assert_nonempty_public_data(built)
  files <- write_public_data(built, opts$output_dir)
  cat(sprintf(
    "Validated %d publications (%d public) and %d talks (%d public, %d mapped). Wrote %d files to %s\n",
    nrow(publications), nrow(built$publications),
    nrow(talks), nrow(built$talks), length(built$geojson$features),
    length(files), opts$output_dir
  ))

  invisible(list(
    publications = publications, talks = talks, built = built,
    output_dir = opts$output_dir
  ))
}

if (sys.nframe() == 0L) {
  root <- build_root()
  for (path in sort(list.files(file.path(root, "R"), pattern = "[.]R$", full.names = TRUE))) {
    source(path)
  }
  status <- tryCatch(
    {
      main(root = root)
      0L
    },
    error = function(e) {
      message("ERROR: ", conditionMessage(e))
      1L
    }
  )
  quit(save = "no", status = status)
}
