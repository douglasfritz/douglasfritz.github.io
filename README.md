# Douglas Fritz — research website

A static personal research website built with [Quarto](https://quarto.org), R, and GitHub Pages.
Douglas Fritz is a translational physician-scientist for public health whose work connects
infectious-disease biology, quantitative discovery, clinical translation, and planetary health.

## Requirements

- [Quarto](https://quarto.org/docs/get-started/) on your `PATH`. RStudio and Positron each bundle a copy of Quarto; if
  `quarto` is not found in your shell, add the bundled `bin` directory to `PATH`.
- R, to run the smoke test and the data scripts.

## Local commands

Run these from the repository root.

```bash
quarto preview                          # serve the site locally with live reload
quarto render                           # build the site into _site/
Rscript tests/smoke/test_structure.R    # check the project structure (exits 0 on success)
Rscript scripts/build_data.R            # build site data from the source spreadsheets (script not added yet)
```
