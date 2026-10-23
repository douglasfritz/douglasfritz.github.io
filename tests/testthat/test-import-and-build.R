repo_root <- function() normalizePath(test_path("..", ".."))

# Runs scripts/build_data.R in a fresh Rscript from the repository root (so the
# project's renv library is used) and captures its exit status and output.
run_build_script <- function(args) {
  force(args) # resolve relative fixture paths before changing directory
  stdout_file <- tempfile()
  stderr_file <- tempfile()
  old <- setwd(repo_root())
  on.exit(setwd(old), add = TRUE)
  status <- system2(
    file.path(R.home("bin"), "Rscript"),
    c("scripts/build_data.R", shQuote(args)),
    stdout = stdout_file,
    stderr = stderr_file
  )
  list(
    status = status,
    stdout = paste(readLines(stdout_file), collapse = "\n"),
    stderr = paste(readLines(stderr_file), collapse = "\n")
  )
}

fixture_file <- function(file) normalizePath(fixture_path(file))

test_that("build arguments are parsed with defaults", {
  script <- new.env()
  source(file.path(repo_root(), "scripts", "build_data.R"), local = script)

  defaults <- script$parse_build_args(character(), root = "/repo")
  expect_null(defaults$publications)
  expect_null(defaults$talks)
  expect_equal(defaults$output_dir, file.path("/repo", "data", "generated"))

  given <- script$parse_build_args(
    c("--publications", "p.csv", "--talks", "t.csv", "--output-dir", "out"),
    root = "/repo"
  )
  expect_equal(given[c("publications", "talks", "output_dir")], list(publications = "p.csv", talks = "t.csv", output_dir = "out"))

  expect_error(script$parse_build_args("--bogus", root = "/repo"), "Unknown argument '--bogus'")
  expect_error(script$parse_build_args("--talks", root = "/repo"), "Missing value for --talks")
  expect_error(
    script$parse_build_args(c("--talks", "--output-dir", "out"), root = "/repo"),
    "Missing value for --talks"
  )
})

expected_output_files <- c(
  "build-metadata.json", "pillars.json", "publications.yml", "talks.geojson",
  "talks.yml"
)

# Fixture CSV with every row's website_include set to "N".
csv_without_public_rows <- function(tab) {
  rows <- fixture_sources()[[tab]]
  rows$website_include <- "N"
  csv <- tempfile(fileext = ".csv")
  readr::write_csv(rows, csv, na = "")
  csv
}

test_that("the fixture build writes the five public files and reports warnings", {
  output_dir <- file.path(withr::local_tempdir(), "generated")
  dir.create(output_dir)
  file.create(file.path(output_dir, ".gitkeep"))

  result <- run_build_script(c(
    "--publications", fixture_file("journal_articles.csv"),
    "--talks", fixture_file("conferences.csv"),
    "--output-dir", output_dir
  ))
  expect_equal(result$status, 0L, info = result$stderr)
  expect_match(
    result$stdout,
    "Validated 5 publications \\(3 public\\) and 6 talks \\(4 public, 3 mapped\\)\\. Wrote 5 files to "
  )
  expect_match(result$stderr, "WARNING: talks: talk-3 has no verified coordinates", fixed = TRUE)
  expect_match(result$stderr, "WARNING: publications: pub-2 has no plain_summary", fixed = TRUE)

  expect_setequal(
    list.files(output_dir, all.files = TRUE, no.. = TRUE),
    c(".gitkeep", expected_output_files)
  )
  expect_length(yaml::read_yaml(file.path(output_dir, "publications.yml")), 3)
  expect_length(yaml::read_yaml(file.path(output_dir, "talks.yml")), 4)
  geojson <- jsonlite::read_json(file.path(output_dir, "talks.geojson"))
  expect_identical(geojson$type, "FeatureCollection")
  expect_length(geojson$features, 3)
  expect_named(jsonlite::read_json(file.path(output_dir, "pillars.json")), site_config$pillars)
  metadata <- jsonlite::read_json(file.path(output_dir, "build-metadata.json"))
  expect_identical(metadata$public_rows, list(publications = 3L, talks = 4L))
})

test_that("a tab with no public rows exits nonzero and leaves the output unchanged", {
  output_dir <- withr::local_tempdir()
  writeLines("previous build", file.path(output_dir, "talks.yml"))

  result <- run_build_script(c(
    "--publications", fixture_file("journal_articles.csv"),
    "--talks", csv_without_public_rows("talks"),
    "--output-dir", output_dir
  ))
  expect_false(result$status == 0L)
  expect_match(result$stderr, "ERROR: No public talks", fixed = TRUE)
  expect_identical(list.files(output_dir, all.files = TRUE, no.. = TRUE), "talks.yml")
  expect_identical(readLines(file.path(output_dir, "talks.yml")), "previous build")
})

test_that("a tab with no public rows never creates the output directory", {
  script <- new.env()
  source(file.path(repo_root(), "scripts", "build_data.R"), local = script)
  output_dir <- file.path(withr::local_tempdir(), "generated")

  expect_error(
    suppressMessages(script$main(
      c(
        "--publications", csv_without_public_rows("publications"),
        "--talks", fixture_file("conferences.csv"),
        "--output-dir", output_dir
      ),
      root = repo_root()
    )),
    "No public publications"
  )
  expect_false(dir.exists(output_dir))
})

test_that("a bad publications path exits nonzero before any output changes", {
  output_dir <- tempfile("site-data-")
  dir.create(output_dir)
  writeLines("previous build", file.path(output_dir, "publications.yml"))

  result <- run_build_script(c(
    "--publications", file.path(tempdir(), "no-such-file.csv"),
    "--talks", fixture_file("conferences.csv"),
    "--output-dir", output_dir
  ))

  expect_false(result$status == 0L)
  expect_match(result$stderr, "Unable to read CV source (publications)", fixed = TRUE)
  expect_equal(list.files(output_dir, all.files = TRUE, no.. = TRUE), "publications.yml")
  expect_equal(readLines(file.path(output_dir, "publications.yml")), "previous build")
})

test_that("a bad talks path exits nonzero without creating the output directory", {
  output_dir <- tempfile("site-data-")
  result <- run_build_script(c(
    "--publications", fixture_file("journal_articles.csv"),
    "--talks", file.path(tempdir(), "no-such-file.csv"),
    "--output-dir", output_dir
  ))
  expect_false(result$status == 0L)
  expect_match(result$stderr, "Unable to read CV source (talks)", fixed = TRUE)
  expect_false(dir.exists(output_dir))
})

test_that("invalid source data exits nonzero naming the record", {
  publications <- fixture_sources()$publications
  publications$key[2] <- "pub-1"
  bad_csv <- tempfile(fileext = ".csv")
  readr::write_csv(publications, bad_csv, na = "")
  output_dir <- tempfile("site-data-")

  result <- run_build_script(c(
    "--publications", bad_csv,
    "--talks", fixture_file("conferences.csv"),
    "--output-dir", output_dir
  ))
  expect_false(result$status == 0L)
  expect_match(result$stderr, "publications: duplicate key 'pub-1'", fixed = TRUE)
  expect_false(dir.exists(output_dir))
})

test_that("import reads every column as text, keeping leading zeros and blanks", {
  csv <- tempfile(fileext = ".csv")
  writeLines(c("key,year,latitude,website_include", "007,2025,1.50,"), csv)
  x <- read_public_sheet("unused", "0", override = csv)
  expect_true(all(vapply(x, is.character, logical(1))))
  expect_equal(x$key, "007")
  expect_equal(x$latitude, "1.50")
  expect_true(is.na(x$website_include))
})

test_that("a malformed CSV is an import error naming the line", {
  csv <- tempfile(fileext = ".csv")
  writeLines(c("key,website_include", "k1,Y", "k2,N,unexpected"), csv)
  expect_error(
    read_public_sheet("unused", "0", override = csv, label = "talks"),
    "Unable to read CV source (talks): 1 CSV parsing problem(s), first on line 3",
    fixed = TRUE
  )
})

test_that("an unreachable sheet URL is an import error", {
  # Loopback only: the closed discard port refuses the connection immediately.
  expect_error(
    read_public_sheet("unused", "0", override = "http://127.0.0.1:9/sheet.csv"),
    "Unable to read CV source"
  )
})
