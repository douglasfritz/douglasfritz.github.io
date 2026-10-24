# Quarto post-render step (_quarto.yml, project: post-render), run from the
# project directory after every render, once the search index is written:
# inserts the skip link (includes/skip-link.html) at the start of <body> in
# each rendered page (see R/skip_link.R).
source(file.path("R", "skip_link.R"))

link <- read_skip_link(file.path("includes", "skip-link.html"))
outputs <- strsplit(Sys.getenv("QUARTO_PROJECT_OUTPUT_FILES"), "\n", fixed = TRUE)[[1]]
pages <- outputs[grepl("[.]html$", outputs)]
for (page in pages) insert_skip_link_file(page, link)
