# The publishing workflow, .github/workflows/publish.yml: its triggers,
# permissions, pinned actions and the order of its steps. The rules are
# checked on the parsed YAML by workflow_contract_issues(), and the tests
# below also feed it deliberately broken copies to show that each rule fails
# them.

workflow_dir <- testthat::test_path("..", "..", ".github", "workflows")
workflow_path <- file.path(workflow_dir, "publish.yml")

# YAML 1.1 reads `on`, `yes` and `false` as booleans, so `on:` would become
# the key "TRUE"; GitHub reads them as text. Every boolean is kept as text.
read_workflow <- function(path = workflow_path) {
  keep_text <- function(x) x
  yaml::read_yaml(path, handlers = list("bool#yes" = keep_text, "bool#no" = keep_text))
}

# Every key name, and every string value, anywhere in a parsed YAML tree.
tree_names <- function(x) {
  if (!is.list(x)) return(character())
  c(names(x)[nzchar(names(x))], unlist(lapply(x, tree_names), use.names = FALSE))
}
tree_strings <- function(x) {
  if (is.list(x)) return(unlist(lapply(x, tree_strings), use.names = FALSE))
  if (is.character(x)) x else character()
}

as_text <- function(x) if (is.null(x)) "" else paste(as.character(x), collapse = " ")
step_uses <- function(step, action) startsWith(as_text(step$uses), paste0(action, "@"))
step_runs <- function(step, pattern) grepl(pattern, as_text(step$run), perl = TRUE)

# The steps the job must have, in this order, each found by what it uses or
# runs. Others (system libraries, the failure report) may sit between them.
required_steps <- list(
  "check out the repository" = function(s) step_uses(s, "actions/checkout"),
  "set up Quarto" = function(s) step_uses(s, "quarto-dev/quarto-actions/setup"),
  "set up R" = function(s) step_uses(s, "r-lib/actions/setup-r"),
  "restore renv" = function(s) step_uses(s, "r-lib/actions/setup-renv"),
  "set up Node" = function(s) step_uses(s, "actions/setup-node"),
  "npm ci" = function(s) step_runs(s, "^npm ci$"),
  "install Chromium" = function(s) step_runs(s, "^npx playwright install --with-deps chromium$"),
  "build the data" = function(s) step_runs(s, "^Rscript scripts/build_data[.]R\\b"),
  "R tests" = function(s) step_runs(s, "^Rscript tests/testthat[.]R$"),
  "JavaScript unit tests" = function(s) step_runs(s, "^(npm run test:unit|node --test\\b)"),
  "render" = function(s) step_runs(s, "^quarto render$"),
  "browser tests" = function(s) step_runs(s, "^npx playwright test\\b"),
  "verify the public output" = function(s) step_runs(s, "^Rscript scripts/verify_generated_public_data[.]R$"),
  "publish" = function(s) step_uses(s, "quarto-dev/quarto-actions/publish")
)

# Every way in which a parsed workflow breaks the contract, as messages (none
# for a good workflow).
workflow_contract_issues <- function(wf) {
  issues <- character()
  add <- function(...) issues <<- c(issues, sprintf(...))

  if (!identical(wf$name, "Refresh website data and publish")) add("the workflow name is not 'Refresh website data and publish'")

  # Triggers: a push to main, and the manual "Run workflow" button. Nothing else.
  on <- wf$on
  if (!is.list(on) || !setequal(names(on), c("push", "workflow_dispatch")) || length(on) != 2) {
    add("the triggers must be exactly push and workflow_dispatch (found: %s)", paste(names(on), collapse = ", "))
  }
  if (!identical(names(on$push), "branches") || !identical(as.character(on$push$branches), "main")) {
    add("push must trigger on branch main only (branches: [main], no other filter)")
  }
  if (length(on$workflow_dispatch) > 0) add("workflow_dispatch must take no inputs")

  for (key in c("schedule", "cron", "continue-on-error")) {
    if (key %in% tree_names(wf)) add("the workflow must not contain a '%s' key", key)
  }

  # Least privilege: read-only by default; the one (publishing) job may write.
  if (!identical(wf$permissions, list(contents = "read"))) add("workflow permissions must be exactly contents: read")

  jobs <- wf$jobs
  if (length(jobs) != 1) {
    add("the workflow must have exactly one job (found %d)", length(jobs))
    return(issues)
  }
  job <- jobs[[1]]
  if (!identical(job$`runs-on`, "ubuntu-latest")) add("the job must run on ubuntu-latest")
  if (!is.numeric(job$`timeout-minutes`) || length(job$`timeout-minutes`) != 1 || job$`timeout-minutes` <= 0) {
    add("the job must set timeout-minutes")
  }
  if (!identical(job$permissions, list(contents = "write"))) add("the publishing job's permissions must be exactly contents: write")

  concurrency <- wf$concurrency %||% job$concurrency
  if (!is.list(concurrency) || !nzchar(as_text(concurrency$group))) add("a concurrency group must be set")
  if (identical(tolower(as_text(concurrency$`cancel-in-progress`)), "true")) add("concurrency must not cancel a run in progress")

  env <- c(wf$env, job$env)
  for (var in c("LANG", "LC_ALL")) {
    if (!grepl("UTF-?8", as_text(env[[var]]), ignore.case = TRUE)) add("%s must be a UTF-8 locale", var)
  }

  strings <- tree_strings(wf)
  secrets <- unlist(regmatches(strings, gregexpr("secrets\\s*(\\.\\s*[A-Za-z0-9_-]+|\\[[^]]*\\])", strings, perl = TRUE)))
  secret_names <- gsub("^secrets|[]['\".\\s]", "", secrets, perl = TRUE)
  for (name in unique(secret_names[secret_names != "GITHUB_TOKEN"])) add("the workflow must not use the secret '%s'", name)

  steps <- job$steps
  for (step in steps) {
    if (!is.null(step$uses) && !grepl("^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$", as_text(step$uses))) {
      add("action '%s' is not pinned to a full commit SHA", as_text(step$uses))
    }
  }

  # The required steps, each exactly once, in order; publishing last.
  at <- vapply(names(required_steps), function(name) {
    found <- which(vapply(steps, required_steps[[name]], logical(1)))
    if (length(found) != 1) {
      add("expected exactly one step to %s (found %d)", name, length(found))
      return(NA_integer_)
    }
    found
  }, integer(1))
  present <- at[!is.na(at)]
  if (is.unsorted(present, strictly = TRUE)) {
    add("the steps are out of order: %s", paste(names(sort(present)), collapse = " < "))
  }
  publish <- at[["publish"]]
  if (!is.na(publish) && publish != length(steps)) add("publishing must be the last step (%d step(s) follow it)", length(steps) - publish)

  step_at <- function(name) if (is.na(at[[name]])) list() else steps[[at[[name]]]]
  if (!identical(as_text(step_at("set up R")$with$`r-version`), "renv")) add("setup-r must use r-version: renv")
  node <- step_at("set up Node")$with
  if (!identical(as_text(node$`node-version`), "22") || !identical(as_text(node$cache), "npm")) {
    add("setup-node must use node-version 22 with the npm cache")
  }
  if (grepl("--publications|--talks", as_text(step_at("build the data")$run))) add("the data build must read the live sheet (no --publications/--talks)")
  if (!identical(as_text(step_at("browser tests")$env$E2E_DATA), "live")) add("the browser tests must set E2E_DATA: live")

  published <- step_at("publish")
  if (!identical(as_text(published$with$target), "gh-pages")) add("publish must target gh-pages")
  if (!identical(tolower(as_text(published$with$render)), "false")) add("publish must use render: false (publish the tested _site)")
  condition <- as_text(published$`if`)
  if (grepl("always\\(|failure\\(|cancelled\\(", condition)) add("publish must not run after a failure (if: %s)", condition)
  if (!grepl("github.ref == 'refs/heads/main'", condition, fixed = TRUE)) add("publish must run only on main (if: github.ref == 'refs/heads/main')")

  # The browser-test report is uploaded only when those tests fail, before
  # (and so never after) publishing.
  uploads <- which(vapply(steps, step_uses, logical(1), action = "actions/upload-artifact"))
  if (length(uploads) != 1 || !grepl("failure()", as_text(steps[[uploads[1]]]$`if`), fixed = TRUE) ||
      is.na(publish) || uploads[1] > publish) {
    add("the browser-test report must be uploaded by one actions/upload-artifact step, if: failure(), before publishing")
  }

  issues
}

test_that("the publish workflow keeps its contract", {
  expect_identical(workflow_contract_issues(read_workflow()), character())
})

test_that(".github/workflows holds exactly one workflow", {
  expect_identical(list.files(workflow_dir, all.files = TRUE, no.. = TRUE), "publish.yml")
})

test_that("robots.txt and sitemap.xml are left to Quarto, which writes them from site-url", {
  # scripts/verify_generated_public_data.R checks the files Quarto writes into
  # _site/ (robots.txt points to the sitemap; the sitemap lists every page).
  root <- testthat::test_path("..", "..")
  config <- yaml::read_yaml(file.path(root, "_quarto.yml"))
  expect_identical(config$website$`site-url`, "https://douglasfritz.github.io/")
  expect_false(file.exists(file.path(root, "robots.txt")))
  expect_false(any(grepl("robots|sitemap", unlist(config$project$resources))))
  expect_false(grepl("noindex", paste(readLines(file.path(root, "_quarto.yml"), warn = FALSE), collapse = "\n"), ignore.case = TRUE))
})

test_that("every action is pinned to a commit SHA, with its release tag in a comment", {
  lines <- readLines(workflow_path, warn = FALSE, encoding = "UTF-8")
  uses <- grep("^\\s*(-\\s+)?uses:", lines, value = TRUE)
  expect_gte(length(uses), 7)
  for (line in uses) {
    expect_match(line, "uses: [A-Za-z0-9_./-]+@[0-9a-f]{40} # v[0-9]+[.][0-9]+[.][0-9]+$", info = line)
  }
})

test_that("the contract check fails deliberately broken workflows", {
  step_index <- function(wf, name) which(vapply(wf$jobs[[1]]$steps, required_steps[[name]], logical(1)))
  edit_step <- function(wf, name, edit) {
    i <- step_index(wf, name)
    wf$jobs[[1]]$steps[[i]] <- edit(wf$jobs[[1]]$steps[[i]])
    wf
  }
  mutations <- list(
    "a schedule trigger" = list(
      function(wf) { wf$on$schedule <- list(list(cron = "0 6 * * 1")); wf },
      "triggers must be exactly|'schedule' key"),
    "a cron key anywhere" = list(
      function(wf) { wf$jobs[[1]]$env <- list(cron = "0 6 * * 1"); wf },
      "'cron' key"),
    "a step after publishing" = list(
      function(wf) { wf$jobs[[1]]$steps <- c(wf$jobs[[1]]$steps, list(list(run = "echo done"))); wf },
      "publishing must be the last step"),
    "an action pinned to a tag" = list(
      function(wf) edit_step(wf, "check out the repository", function(s) { s$uses <- "actions/checkout@v4"; s }),
      "not pinned to a full commit SHA"),
    "browser tests without E2E_DATA" = list(
      function(wf) edit_step(wf, "browser tests", function(s) { s$env <- NULL; s }),
      "E2E_DATA: live"),
    "continue-on-error on a step" = list(
      function(wf) edit_step(wf, "R tests", function(s) { s$`continue-on-error` <- "true"; s }),
      "'continue-on-error' key"),
    "continue-on-error on the job" = list(
      function(wf) { wf$jobs[[1]]$`continue-on-error` <- "true"; wf },
      "'continue-on-error' key"),
    "a pull_request trigger" = list(
      function(wf) { wf$on$pull_request <- list(); wf },
      "triggers must be exactly"),
    "a push to another branch" = list(
      function(wf) { wf$on$push$branches <- c("main", "dev"); wf },
      "branch main only"),
    "rendering before the R tests" = list(
      function(wf) {
        steps <- wf$jobs[[1]]$steps
        r <- step_index(wf, "R tests")
        q <- step_index(wf, "render")
        steps[c(r, q)] <- steps[c(q, r)]
        wf$jobs[[1]]$steps <- steps
        wf
      },
      "out of order"),
    "no verification step" = list(
      function(wf) { wf$jobs[[1]]$steps[[step_index(wf, "verify the public output")]] <- NULL; wf },
      "exactly one step to verify the public output"),
    "write permission for the whole workflow" = list(
      function(wf) { wf$permissions <- list(contents = "write"); wf },
      "workflow permissions"),
    "an extra job permission" = list(
      function(wf) { wf$jobs[[1]]$permissions$pages <- "write"; wf },
      "job's permissions"),
    "a Google secret" = list(
      function(wf) edit_step(wf, "build the data", function(s) { s$env <- list(KEY = "${{ secrets.GOOGLE_API_KEY }}"); s }),
      "secret 'GOOGLE_API_KEY'"),
    "publishing after a failure" = list(
      function(wf) edit_step(wf, "publish", function(s) { s$`if` <- "always()"; s }),
      "must not run after a failure"),
    "publishing from any branch" = list(
      function(wf) edit_step(wf, "publish", function(s) { s$`if` <- NULL; s }),
      "only on main"),
    "re-rendering on publish" = list(
      function(wf) edit_step(wf, "publish", function(s) { s$with$render <- NULL; s }),
      "render: false"),
    "fixture data in CI" = list(
      function(wf) edit_step(wf, "build the data", function(s) {
        s$run <- "Rscript scripts/build_data.R --publications tests/fixtures/journal_articles.csv"
        s
      }),
      "live sheet"),
    "no timeout" = list(
      function(wf) { wf$jobs[[1]]$`timeout-minutes` <- NULL; wf },
      "timeout-minutes"),
    "no concurrency group" = list(
      function(wf) { wf$concurrency <- NULL; wf },
      "concurrency group"),
    "cancelling a deploy in progress" = list(
      function(wf) { wf$concurrency$`cancel-in-progress` <- "true"; wf },
      "must not cancel"),
    "a non-UTF-8 locale" = list(
      function(wf) { wf$env$LC_ALL <- "C"; wf },
      "LC_ALL must be a UTF-8 locale"),
    "R not from renv.lock" = list(
      function(wf) edit_step(wf, "set up R", function(s) { s$with$`r-version` <- "release"; s }),
      "r-version: renv"),
    "Node 20" = list(
      function(wf) edit_step(wf, "set up Node", function(s) { s$with$`node-version` <- "20"; s }),
      "node-version 22"),
    "a report uploaded on success" = list(
      function(wf) {
        steps <- wf$jobs[[1]]$steps
        i <- which(vapply(steps, step_uses, logical(1), action = "actions/upload-artifact"))
        wf$jobs[[1]]$steps[[i]]$`if` <- NULL
        wf
      },
      "uploaded by one actions/upload-artifact step")
  )
  good <- read_workflow()
  expect_identical(workflow_contract_issues(good), character())
  for (name in names(mutations)) {
    issues <- workflow_contract_issues(mutations[[name]][[1]](good))
    expect_true(any(grepl(mutations[[name]][[2]], issues)), info = paste0(name, ": ", paste(issues, collapse = " | ")))
  }
})
