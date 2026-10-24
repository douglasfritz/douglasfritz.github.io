# Quarto post-render step (_quarto.yml, project: post-render), run from the
# project directory after every render: moves the skip link to the start of
# <body> in each rendered page (see R/skip_link.R).
source(file.path("R", "skip_link.R"))

outputs <- strsplit(Sys.getenv("QUARTO_PROJECT_OUTPUT_FILES"), "\n", fixed = TRUE)[[1]]
pages <- outputs[grepl("[.]html$", outputs)]
for (page in pages) move_skip_link_file(page)
