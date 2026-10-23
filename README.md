# Douglas Fritz — research website

A static personal research website built with [Quarto](https://quarto.org), R, and GitHub Pages.
Douglas Fritz is a translational physician-scientist for public health whose work connects
infectious-disease biology, quantitative discovery, clinical translation, and planetary health.

## Requirements

- [Quarto](https://quarto.org/docs/get-started/) on your `PATH`. RStudio and Positron each bundle a copy of Quarto; if
  `quarto` is not found in your shell, add the bundled `bin` directory to `PATH`.
- R (4.4 or later), to run the tests and the data script. R packages are pinned with
  [renv](https://rstudio.github.io/renv/) in `renv.lock`; R activates the project library
  automatically when started from the repository root. On a new machine, install the pinned
  packages once with `Rscript -e 'renv::restore()'`. To add a package, list it in `DESCRIPTION`,
  then run `renv::install()` and `renv::snapshot()`.

## Local commands

Run these from the repository root.

```bash
quarto preview                          # serve the site locally with live reload
quarto render                           # build the site into _site/
Rscript tests/smoke/test_structure.R    # check the project structure (exits 0 on success)
Rscript tests/testthat.R                # run the R data-pipeline tests (offline, fixtures only)
Rscript scripts/build_data.R [--publications P --talks T --output-dir D]
```

`scripts/build_data.R` reads the Publications and Talks tabs of the public CV sheet, normalizes
them, and validates them. Only rows whose `website_include` is exactly `Y` are public. It exits
nonzero, naming each bad record, if a source cannot be read or a record fails validation.
Gaps that do not block publication, such as a missing summary or a talk without coordinates,
are printed as `WARNING:` lines. Options:

- `--publications P`, `--talks T`: read local CSV files instead of the sheet (for example
  `tests/fixtures/journal_articles.csv` and `tests/fixtures/conferences.csv`).
- `--output-dir D`: where generated data goes (default `data/generated`). The script does not
  write data files yet.
