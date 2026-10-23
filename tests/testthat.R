# Runs the R data-pipeline tests. From the repository root:
#   Rscript tests/testthat.R
if (!file.exists("_quarto.yml")) {
  stop("Run tests/testthat.R from the repository root.", call. = FALSE)
}

Sys.setenv(TESTTHAT_EDITION = "3")
for (path in sort(list.files("R", pattern = "[.]R$", full.names = TRUE))) {
  source(path)
}

testthat::test_dir("tests/testthat", stop_on_failure = TRUE)
