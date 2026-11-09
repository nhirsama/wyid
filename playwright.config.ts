import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { normalizeBasePath, withBasePath } from "./src/lib/paths";

loadEnvConfig(process.cwd());
const basePath = normalizeBasePath(process.env.BASE_PATH);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] } },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium", channel: "chrome" } },
  ],
  webServer: { command: "./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3100", url: `http://127.0.0.1:3100${withBasePath("/api/health", basePath)}`, reuseExistingServer: !process.env.CI },
});
