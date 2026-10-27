# Quarto post-render step (_quarto.yml, project: post-render), run from the
# project directory after every render, once the search index is written:
# inserts the skip link (includes/skip-link.html) at the start of <body> in
# each rendered page (see R/skip_link.R).
source(file.path("R", "skip_link.R"))

link <- read_skip_link(file.path("includes", "skip-link.html"))
# One path per line; a Windows-style list ends its lines with "\r\n", and a
# path left with a "\r" would not end in ".html" and be skipped silently.
outputs <- trimws(strsplit(Sys.getenv("QUARTO_PROJECT_OUTPUT_FILES"), "\r?\n")[[1]])
pages <- outputs[grepl("[.]html$", outputs)]
# Never skip every page silently: Quarto sets the list for a post-render step.
if (length(pages) == 0) {
  stop("QUARTO_PROJECT_OUTPUT_FILES lists no HTML pages, so no page would get the skip link. ",
       "Run this script as the project's post-render step (quarto render).", call. = FALSE)
}
for (page in pages) insert_skip_link_file(page, link)
