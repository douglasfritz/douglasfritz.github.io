// Browser tests run against the rendered site in _site/. Build it first:
//   npm run data:fixture && quarto render
// Tests tagged @js run only with JavaScript, @no-js only without; untagged
// tests run in both projects.
import { defineConfig, devices } from "@playwright/test";

const port = 4321;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: {
    // The pinned local http-server (not npx, which may reach the registry).
    command: `node node_modules/http-server/bin/http-server _site -a 127.0.0.1 -p ${port} -c-1 --silent`,
    url: `${baseURL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@no-js/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "chromium-no-js",
      grepInvert: /@js\b/,
      use: { ...devices["Desktop Chrome"], javaScriptEnabled: false }
    }
  ]
});
