# The publishing workflow, .github/workflows/publish.yml: its triggers,
# permissions, pinned actions and runner, and the steps of its two jobs. The
# rules are checked on the parsed YAML by workflow_contract_issues(), and the
# tests below also feed it deliberately broken copies to show that each rule
# fails them.

workflow_dir <- testthat::test_path("..", "..", ".github", "workflows")
workflow_path <- file.path(workflow_dir, "publish.yml")
runner <- "ubuntu-24.04"

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
# A step that runs exactly `command`, and nothing else.
step_runs <- function(step, command) identical(trimws(as_text(step$run)), command)

# A step's environment: workflow, then job, then step values (later wins).
effective_env <- function(wf, job, step) {
  utils::modifyList(utils::modifyList(as.list(wf$env), as.list(job$env)), as.list(step$env))
}
# `value`, with a whole-value `${{ env.NAME }}` replaced from `env`.
resolve_env <- function(value, env) {
  name <- sub("^\\$\\{\\{\\s*env\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\}\\}$", "\\1", value)
  if (identical(name, value)) value else as_text(env[[name]])
}
# A condition without `${{ }}` and with single spaces.
normalize_if <- function(x) gsub("\\s+", " ", trimws(sub("^\\$\\{\\{(.*)\\}\\}$", "\\1", trimws(as_text(x)))))

# The steps of each job, in this order, each found by what it uses or runs.
build_steps <- list(
  "check out the repository" = function(s) step_uses(s, "actions/checkout"),
  "set up Quarto" = function(s) step_uses(s, "quarto-dev/quarto-actions/setup"),
  "set up R" = function(s) step_uses(s, "r-lib/actions/setup-r"),
  "install system libraries" = function(s) step_runs(s, "sudo apt-get update && sudo apt-get install -y --no-install-recommends libcurl4-openssl-dev libuv1-dev"),
  "restore renv" = function(s) step_uses(s, "r-lib/actions/setup-renv"),
  "set up Node" = function(s) step_uses(s, "actions/setup-node"),
  "npm ci" = function(s) step_runs(s, "npm ci"),
  "install Chromium" = function(s) step_runs(s, "npx playwright install --with-deps chromium"),
  "build the data" = function(s) step_runs(s, "Rscript scripts/build_data.R"),
  "R tests" = function(s) step_runs(s, "Rscript tests/testthat.R"),
  "JavaScript unit tests" = function(s) step_runs(s, "npm run test:unit"),
  "render" = function(s) step_runs(s, "quarto render"),
  "browser tests" = function(s) step_runs(s, "npx playwright test"),
  "upload the browser test report" = function(s) step_uses(s, "actions/upload-artifact") && identical(as_text(s$with$name), "playwright-report"),
  "verify the public output" = function(s) step_runs(s, "Rscript scripts/verify_generated_public_data.R"),
  "upload the tested site" = function(s) step_uses(s, "actions/upload-artifact") && identical(as_text(s$with$path), "_site")
)
publish_steps <- list(
  "check out the repository" = function(s) step_uses(s, "actions/checkout"),
  "set up Quarto" = function(s) step_uses(s, "quarto-dev/quarto-actions/setup"),
  "download the tested site" = function(s) step_uses(s, "actions/download-artifact"),
  "publish" = function(s) step_uses(s, "quarto-dev/quarto-actions/publish")
)

# Positions of `required` steps in `steps`, each found exactly once and in
# order, with problems reported through `add`.
locate_steps <- function(steps, required, job, add) {
  at <- vapply(names(required), function(name) {
    found <- which(vapply(steps, required[[name]], logical(1)))
    if (length(found) != 1) {
      add("%s: expected exactly one step to %s (found %d)", job, name, length(found))
      return(NA_integer_)
    }
    found
  }, integer(1))
  present <- at[!is.na(at)]
  if (is.unsorted(present, strictly = TRUE)) {
    add("%s: the steps are out of order: %s", job, paste(names(sort(present)), collapse = " < "))
  }
  at
}

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

  # No schedule; nothing that lets a failing step pass.
  for (key in c("schedule", "cron", "continue-on-error", "shell")) {
    if (key %in% tree_names(wf)) add("the workflow must not contain a '%s' key", key)
  }

  # Least privilege: read-only by default; only the publish job may write.
  if (!identical(wf$permissions, list(contents = "read"))) add("workflow permissions must be exactly contents: read")

  # One run at a time, for the whole workflow, never cancelling a deploy.
  concurrency <- wf$concurrency
  if (!is.list(concurrency) || !nzchar(as_text(concurrency$group))) add("a workflow-level concurrency group must be set")
  if (identical(tolower(as_text(concurrency$`cancel-in-progress`)), "true")) add("concurrency must not cancel a run in progress")

  # Only secrets.GITHUB_TOKEN may be used: every `secrets` in an expression
  # (or a bare `if:` condition) must be exactly that.
  expressions <- c(
    unlist(regmatches(tree_strings(wf), gregexpr("\\$\\{\\{.*?\\}\\}", tree_strings(wf), perl = TRUE))),
    unlist(lapply(wf$jobs, function(job) c(as_text(job$`if`), vapply(job$steps, function(s) as_text(s$`if`), character(1)))))
  )
  all_secrets <- sum(lengths(regmatches(expressions, gregexpr("\\bsecrets\\b", expressions, perl = TRUE))))
  token <- sum(lengths(regmatches(expressions, gregexpr("\\bsecrets\\s*\\.\\s*GITHUB_TOKEN(?![A-Za-z0-9_-])", expressions, perl = TRUE))))
  if (all_secrets != token) add("the workflow must not use any secret other than secrets.GITHUB_TOKEN")

  jobs <- wf$jobs
  if (!setequal(names(jobs), c("build", "publish")) || length(jobs) != 2) {
    add("the workflow must have exactly the jobs build and publish (found: %s)", paste(names(jobs), collapse = ", "))
    return(issues)
  }

  for (name in names(jobs)) {
    job <- jobs[[name]]
    if (!identical(job$`runs-on`, runner)) add("%s: must run on %s (a pinned image)", name, runner)
    if (!is.numeric(job$`timeout-minutes`) || length(job$`timeout-minutes`) != 1 || job$`timeout-minutes` <= 0) {
      add("%s: must set timeout-minutes", name)
    }
    if (!is.null(job$concurrency)) add("%s: concurrency belongs to the workflow, not a job", name)
    for (step in job$steps) {
      if (!is.null(step$uses) && !grepl("^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}$", as_text(step$uses))) {
        add("%s: action '%s' is not pinned to a full commit SHA", name, as_text(step$uses))
      }
      env <- effective_env(wf, job, step)
      for (var in c("LANG", "LC_ALL")) {
        if (!grepl("UTF-?8", as_text(env[[var]]), ignore.case = TRUE)) {
          add("%s: %s must be a UTF-8 locale in step '%s'", name, var, as_text(step$name))
        }
      }
      run <- as_text(step$run)
      if (grepl("\\|\\||\\bset\\s+[+]e\\b|;\\s*(true|:|exit)\\b|\\bexit\\s+0\\b", run, perl = TRUE)) {
        add("%s: step '%s' suppresses failures", name, as_text(step$name))
      }
      if (grepl("\\bgit\\s+push\\b|(^|[\\s;&|(])gh\\s", run, perl = TRUE)) {
        add("%s: step '%s' writes to GitHub itself (git push or gh); only the publish action may", name, as_text(step$name))
      }
    }
  }

  # build: read-only, keeps no credentials, runs every check, and hands on
  # the tested _site/ as its last step.
  build <- jobs$build
  if (!identical(build$permissions, list(contents = "read"))) add("build: permissions must be exactly contents: read")
  if (!is.null(build$`if`)) add("build: must always run (no if:)")
  steps <- build$steps
  at <- locate_steps(steps, build_steps, "build", add)
  step_at <- function(name) if (is.na(at[[name]])) list() else steps[[at[[name]]]]
  if (!identical(tolower(as_text(step_at("check out the repository")$with$`persist-credentials`)), "false")) {
    add("build: checkout must use persist-credentials: false")
  }
  if (!identical(as_text(step_at("set up R")$with$`r-version`), "renv")) add("build: setup-r must use r-version: renv")
  node <- step_at("set up Node")$with
  if (!identical(as_text(node$`node-version`), "22") || !identical(as_text(node$cache), "npm")) {
    add("build: setup-node must use node-version 22 with the npm cache")
  }
  if (!identical(as_text(step_at("browser tests")$env$E2E_DATA), "live")) add("build: the browser tests must set E2E_DATA: live")
  if (!grepl("failure()", as_text(step_at("upload the browser test report")$`if`), fixed = TRUE)) {
    add("build: the browser test report must be uploaded only on failure (if: failure())")
  }
  site <- step_at("upload the tested site")
  if (!is.na(at[["upload the tested site"]]) && at[["upload the tested site"]] != length(steps)) {
    add("build: uploading the tested site must be the last step")
  }
  if (!is.null(site$`if`)) add("build: the tested site must be uploaded only after every check passed (no if:)")
  if (!identical(as_text(site$with$`if-no-files-found`), "error")) add("build: the site upload must use if-no-files-found: error")
  retention <- suppressWarnings(as.numeric(as_text(site$with$`retention-days`)))
  if (is.na(retention) || retention < 1 || retention > 7) add("build: the site artifact must have a short retention-days (1-7)")

  # publish: after build, from main only, the one job that writes; exactly
  # checkout, Quarto, the tested site, and the publish action, last.
  publish <- jobs$publish
  if (!identical(as.character(publish$needs), "build")) add("publish: must need build")
  if (!identical(normalize_if(publish$`if`), "github.ref == 'refs/heads/main'")) {
    add("publish: must run only on main (if: github.ref == 'refs/heads/main'; found: %s)", as_text(publish$`if`))
  }
  if (!identical(publish$permissions, list(contents = "write"))) add("publish: permissions must be exactly contents: write")
  steps <- publish$steps
  at <- locate_steps(steps, publish_steps, "publish", add)
  step_at <- function(name) if (is.na(at[[name]])) list() else steps[[at[[name]]]]
  if (length(steps) != length(publish_steps)) {
    add("publish: must have exactly the steps %s (found %d steps)", paste(names(publish_steps), collapse = ", "), length(steps))
  }
  for (step in steps) {
    if (!is.null(step$run)) add("publish: must not run commands (step '%s')", as_text(step$name))
    if (!is.null(step$`if`)) add("publish: its steps must not have conditions (step '%s')", as_text(step$name))
  }
  if (identical(tolower(as_text(step_at("check out the repository")$with$`persist-credentials`)), "false")) {
    add("publish: checkout must keep its credentials (the publish action pushes with them)")
  }
  download <- step_at("download the tested site")$with
  if (!identical(as_text(download$name), as_text(site$with$name)) || !identical(as_text(download$path), "_site")) {
    add("publish: must download the tested site's artifact into _site")
  }
  published <- step_at("publish")$with
  if (!identical(as_text(published$target), "gh-pages")) add("publish: must target gh-pages")
  if (!identical(tolower(as_text(published$render)), "false")) add("publish: must use render: false (publish the tested _site)")

  # The same, pinned, Quarto release in both jobs.
  versions <- vapply(names(jobs), function(name) {
    job <- jobs[[name]]
    setup <- Filter(function(s) step_uses(s, "quarto-dev/quarto-actions/setup"), job$steps)
    if (length(setup) != 1) return(NA_character_)
    resolve_env(as_text(setup[[1]]$with$version), effective_env(wf, job, setup[[1]]))
  }, character(1))
  if (anyNA(versions) || !all(grepl("^[0-9]+[.][0-9]+[.][0-9]+$", versions)) || length(unique(versions)) != 1) {
    add("both jobs must install the same pinned Quarto release (found: %s)", paste(versions, collapse = ", "))
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
  expect_gte(length(uses), 11)
  for (line in uses) {
    expect_match(line, "uses: [A-Za-z0-9_./-]+@[0-9a-f]{40} # v[0-9]+[.][0-9]+[.][0-9]+$", info = line)
  }
})

test_that("the contract check fails deliberately broken workflows", {
  index <- function(wf, job, name) {
    required <- if (job == "build") build_steps else publish_steps
    which(vapply(wf$jobs[[job]]$steps, required[[name]], logical(1)))
  }
  edit_step <- function(wf, job, name, edit) {
    i <- index(wf, job, name)
    wf$jobs[[job]]$steps[[i]] <- edit(wf$jobs[[job]]$steps[[i]])
    wf
  }
  set_run <- function(job, name, run) function(wf) edit_step(wf, job, name, function(s) { s$run <- run; s })
  add_step <- function(job, step, at = NULL) function(wf) {
    steps <- wf$jobs[[job]]$steps
    at <- at %||% length(steps)
    wf$jobs[[job]]$steps <- append(steps, list(step), after = at)
    wf
  }
  mutations <- list(
    # Triggers and workflow-wide rules.
    "a schedule trigger" = list(function(wf) { wf$on$schedule <- list(list(cron = "0 6 * * 1")); wf }, "triggers must be exactly|'schedule' key"),
    "a cron key anywhere" = list(function(wf) { wf$jobs$build$env <- list(cron = "0 6 * * 1"); wf }, "'cron' key"),
    "a pull_request trigger" = list(function(wf) { wf$on$pull_request <- list(); wf }, "triggers must be exactly"),
    "a push to another branch" = list(function(wf) { wf$on$push$branches <- c("main", "dev"); wf }, "branch main only"),
    "continue-on-error on a step" = list(function(wf) edit_step(wf, "build", "R tests", function(s) { s$`continue-on-error` <- "true"; s }), "'continue-on-error' key"),
    "continue-on-error on a job" = list(function(wf) { wf$jobs$build$`continue-on-error` <- "true"; wf }, "'continue-on-error' key"),
    "a custom shell" = list(function(wf) edit_step(wf, "build", "R tests", function(s) { s$shell <- "bash {0}"; s }), "'shell' key"),
    "write permission for the whole workflow" = list(function(wf) { wf$permissions <- list(contents = "write"); wf }, "workflow permissions"),
    "no concurrency group" = list(function(wf) { wf$concurrency <- NULL; wf }, "workflow-level concurrency group"),
    "concurrency on the publish job only" = list(function(wf) { wf$jobs$publish$concurrency <- wf$concurrency; wf$concurrency <- NULL; wf }, "concurrency belongs to the workflow|workflow-level concurrency"),
    "cancelling a deploy in progress" = list(function(wf) { wf$concurrency$`cancel-in-progress` <- "true"; wf }, "must not cancel"),
    "a non-UTF-8 locale for the workflow" = list(function(wf) { wf$env$LC_ALL <- "C"; wf }, "LC_ALL must be a UTF-8 locale"),
    "a job-level LANG override" = list(function(wf) { wf$jobs$build$env <- list(LANG = "C"); wf }, "build: LANG must be a UTF-8 locale"),
    "a step-level LC_ALL override" = list(function(wf) edit_step(wf, "build", "render", function(s) { s$env <- list(LC_ALL = "C"); s }), "build: LC_ALL must be a UTF-8 locale in step 'Render the site'"),
    "a Google secret" = list(function(wf) edit_step(wf, "build", "build the data", function(s) { s$env <- list(KEY = "${{ secrets.GOOGLE_API_KEY }}"); s }), "secret other than"),
    "every secret, as JSON" = list(function(wf) edit_step(wf, "build", "R tests", function(s) { s$env <- list(ALL = "${{ toJSON(secrets) }}"); s }), "secret other than"),
    "a secret by index" = list(function(wf) edit_step(wf, "build", "R tests", function(s) { s$env <- list(X = "${{ secrets['X'] }}"); s }), "secret other than"),
    "a secret in a condition" = list(function(wf) edit_step(wf, "build", "R tests", function(s) { s$`if` <- "secrets.DEPLOY_KEY != ''"; s }), "secret other than"),
    "a third job" = list(function(wf) { wf$jobs$extra <- wf$jobs$publish; wf }, "exactly the jobs build and publish"),
    # Runner, timeouts, pins.
    "ubuntu-latest" = list(function(wf) { wf$jobs$build$`runs-on` <- "ubuntu-latest"; wf }, "build: must run on ubuntu-24.04"),
    "no timeout on build" = list(function(wf) { wf$jobs$build$`timeout-minutes` <- NULL; wf }, "build: must set timeout-minutes"),
    "no timeout on publish" = list(function(wf) { wf$jobs$publish$`timeout-minutes` <- NULL; wf }, "publish: must set timeout-minutes"),
    "an action pinned to a tag" = list(function(wf) edit_step(wf, "build", "check out the repository", function(s) { s$uses <- "actions/checkout@v6"; s }), "not pinned to a full commit SHA"),
    "a publish action pinned to a branch" = list(function(wf) edit_step(wf, "publish", "publish", function(s) { s$uses <- "quarto-dev/quarto-actions/publish@main"; s }), "publish: action .* is not pinned"),
    # build job.
    "write permission for build" = list(function(wf) { wf$jobs$build$permissions <- list(contents = "write"); wf }, "build: permissions must be exactly contents: read"),
    "a condition on build" = list(function(wf) { wf$jobs$build$`if` <- "false"; wf }, "build: must always run"),
    "credentials kept in build" = list(function(wf) edit_step(wf, "build", "check out the repository", function(s) { s$with <- NULL; s }), "persist-credentials: false"),
    "browser tests without E2E_DATA" = list(function(wf) edit_step(wf, "build", "browser tests", function(s) { s$env <- NULL; s }), "E2E_DATA: live"),
    "rendering before the R tests" = list(function(wf) {
      steps <- wf$jobs$build$steps
      r <- index(wf, "build", "R tests"); q <- index(wf, "build", "render")
      steps[c(r, q)] <- steps[c(q, r)]
      wf$jobs$build$steps <- steps
      wf
    }, "out of order"),
    "no verification step" = list(function(wf) { wf$jobs$build$steps[[index(wf, "build", "verify the public output")]] <- NULL; wf }, "exactly one step to verify the public output"),
    "fixture data in CI" = list(set_run("build", "build the data", "Rscript scripts/build_data.R --publications tests/fixtures/journal_articles.csv"), "exactly one step to build the data"),
    "a data build that cannot fail" = list(set_run("build", "build the data", "Rscript scripts/build_data.R || true"), "exactly one step to build the data"),
    "browser tests that cannot fail" = list(set_run("build", "browser tests", "npx playwright test || true"), "exactly one step to browser tests"),
    "unit tests that cannot fail" = list(set_run("build", "JavaScript unit tests", "npm run test:unit || true"), "exactly one step to JavaScript unit tests"),
    "a render followed by ; true" = list(set_run("build", "render", "quarto render; true"), "exactly one step to render"),
    "R tests under set +e" = list(set_run("build", "R tests", "set +e\nRscript tests/testthat.R"), "exactly one step to R tests"),
    "an extra step that cannot fail" = list(add_step("build", list(name = "Lint", run = "npm run lint || true"), at = 7), "build: step 'Lint' suppresses failures"),
    "an extra step under set +e" = list(add_step("build", list(name = "Check", run = "set +e\nfalse"), at = 7), "build: step 'Check' suppresses failures"),
    "a git push before publishing" = list(add_step("build", list(name = "Push", run = "git push origin HEAD:gh-pages"), at = 3), "build: step 'Push' writes to GitHub itself"),
    "a gh write before publishing" = list(add_step("build", list(name = "Release", run = "gh release create v1"), at = 3), "build: step 'Release' writes to GitHub itself"),
    "R not from renv.lock" = list(function(wf) edit_step(wf, "build", "set up R", function(s) { s$with$`r-version` <- "release"; s }), "r-version: renv"),
    "Node 20" = list(function(wf) edit_step(wf, "build", "set up Node", function(s) { s$with$`node-version` <- "20"; s }), "node-version 22"),
    "a report uploaded on success" = list(function(wf) edit_step(wf, "build", "upload the browser test report", function(s) { s$`if` <- NULL; s }), "uploaded only on failure"),
    "the site uploaded before verification" = list(function(wf) {
      steps <- wf$jobs$build$steps
      v <- index(wf, "build", "verify the public output"); u <- index(wf, "build", "upload the tested site")
      steps[c(v, u)] <- steps[c(u, v)]
      wf$jobs$build$steps <- steps
      wf
    }, "out of order|must be the last step"),
    "a step after the site upload" = list(add_step("build", list(name = "Done", run = "echo done")), "uploading the tested site must be the last step"),
    "the site uploaded even after a failure" = list(function(wf) edit_step(wf, "build", "upload the tested site", function(s) { s$`if` <- "always()"; s }), "only after every check passed"),
    "an empty site artifact allowed" = list(function(wf) edit_step(wf, "build", "upload the tested site", function(s) { s$with$`if-no-files-found` <- "warn"; s }), "if-no-files-found: error"),
    "a long-lived site artifact" = list(function(wf) edit_step(wf, "build", "upload the tested site", function(s) { s$with$`retention-days` <- 90; s }), "short retention-days"),
    # publish job.
    "publish without needs" = list(function(wf) { wf$jobs$publish$needs <- NULL; wf }, "publish: must need build"),
    "publishing from any branch" = list(function(wf) { wf$jobs$publish$`if` <- NULL; wf }, "publish: must run only on main"),
    "publishing after a failure" = list(function(wf) { wf$jobs$publish$`if` <- "always() && github.ref == 'refs/heads/main'"; wf }, "publish: must run only on main"),
    "a negated main guard" = list(function(wf) { wf$jobs$publish$`if` <- "!(github.ref == 'refs/heads/main')"; wf }, "publish: must run only on main"),
    "a main guard with an escape" = list(function(wf) { wf$jobs$publish$`if` <- "github.ref == 'refs/heads/main' || true"; wf }, "publish: must run only on main"),
    "read-only publish" = list(function(wf) { wf$jobs$publish$permissions <- list(contents = "read"); wf }, "publish: permissions must be exactly contents: write"),
    "an extra publish permission" = list(function(wf) { wf$jobs$publish$permissions$pages <- "write"; wf }, "publish: permissions must be exactly contents: write"),
    "a step after publishing" = list(add_step("publish", list(name = "Announce", uses = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803")), "publish: expected exactly one step to check out|must have exactly the steps"),
    "a command in the publish job" = list(add_step("publish", list(name = "Tweak", run = "touch _site/x"), at = 3), "publish: must not run commands"),
    "R in the publish job" = list(add_step("publish", list(name = "Set up R", uses = "r-lib/actions/setup-r@f9a764fea8d5c63df6ef9a5c7795bf7deb5d7e05"), at = 2), "publish: must have exactly the steps"),
    "a condition on the publish step" = list(function(wf) edit_step(wf, "publish", "publish", function(s) { s$`if` <- "always()"; s }), "publish: its steps must not have conditions"),
    "publish without the tested site" = list(function(wf) { wf$jobs$publish$steps[[index(wf, "publish", "download the tested site")]] <- NULL; wf }, "publish: expected exactly one step to download the tested site"),
    "the site downloaded after publishing" = list(function(wf) {
      steps <- wf$jobs$publish$steps
      d <- index(wf, "publish", "download the tested site"); p <- index(wf, "publish", "publish")
      steps[c(d, p)] <- steps[c(p, d)]
      wf$jobs$publish$steps <- steps
      wf
    }, "publish: the steps are out of order"),
    "another artifact downloaded" = list(function(wf) edit_step(wf, "publish", "download the tested site", function(s) { s$with$name <- "playwright-report"; s }), "download the tested site's artifact"),
    "publish without credentials" = list(function(wf) edit_step(wf, "publish", "check out the repository", function(s) { s$with <- list(`persist-credentials` = "false"); s }), "checkout must keep its credentials"),
    "re-rendering on publish" = list(function(wf) edit_step(wf, "publish", "publish", function(s) { s$with$render <- NULL; s }), "render: false"),
    "publishing elsewhere" = list(function(wf) edit_step(wf, "publish", "publish", function(s) { s$with$target <- "netlify"; s }), "must target gh-pages"),
    # Quarto version.
    "Quarto versions that differ" = list(function(wf) edit_step(wf, "publish", "set up Quarto", function(s) { s$with$version <- "1.9.37"; s }), "same pinned Quarto release"),
    "the latest Quarto release" = list(function(wf) { wf$env$SITE_QUARTO_VERSION <- "release"; wf }, "same pinned Quarto release")
  )
  good <- read_workflow()
  expect_identical(workflow_contract_issues(good), character())
  for (name in names(mutations)) {
    issues <- workflow_contract_issues(mutations[[name]][[1]](good))
    expect_true(any(grepl(mutations[[name]][[2]], issues)), info = paste0(name, ": ", paste(issues, collapse = " | ")))
  }
})
