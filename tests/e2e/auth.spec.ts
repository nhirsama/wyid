import { expect, test } from "@playwright/test";
import { normalizeBasePath, withBasePath } from "../../src/lib/paths";

const configured = Boolean(process.env.APP_URL && process.env.ZITADEL_API_URL && process.env.ZITADEL_SERVICE_TOKEN && process.env.SESSION_SECRET);
const authRequestId = process.env.ZITADEL_TEST_AUTH_REQUEST_ID;
const basePath = normalizeBasePath(process.env.BASE_PATH);
const path = (value: string) => withBasePath(value, basePath);

test("serves health checks and redirects the landing page under the base path", async ({ page, request }) => {
  const health = await request.get(path("/api/health"));
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  await page.goto(path("/"));
  await expect(page).toHaveURL(url => url.pathname === path("/login"));
});

test("serves static assets and keeps not-found links under the base path", async ({ page, request }) => {
  const font = await request.get(path("/fonts/jetbrains-mono-latin.woff2"));
  expect(font.status()).toBe(200);
  await page.goto(path("/page-that-does-not-exist"));
  await expect(page.getByRole("link", { name: "回到登录页" })).toHaveAttribute("href", path("/login"));
  const stylesheetUrls = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(stylesheetUrls.length).toBeGreaterThan(0);
  for (const url of stylesheetUrls) expect(url?.startsWith(`${basePath}/_next/`)).toBe(true);
});

test("missing service configuration lists the required variables", async ({ page }) => {
  test.skip(configured, "ZITADEL 服务已配置。");
  await page.goto(path("/login"));
  await expect(page.getByRole("heading", { name: "服务配置不完整" })).toBeVisible();
  await expect(page.getByText(/ZITADEL_API_URL|ZITADEL_SERVICE_TOKEN|SESSION_SECRET/)).toBeVisible();
});

test.describe("connected ZITADEL UI", () => {
  test.beforeEach(() => {
    test.skip(!configured, "需要可访问的 ZITADEL 测试实例。");
  });

  test("shows the direct login form without requiring an OIDC authorization request", async ({ page }) => {
    await page.goto(path("/login"));
    await expect(page.getByRole("heading", { name: "登录账号" })).toBeVisible();
    await expect(page.getByLabel("邮箱或用户名")).toBeVisible();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    await expect(page.getByText("登录请求已过期或缺失，无法继续验证账号。")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("loads live login methods for a valid ZITADEL authorization request", async ({ page }) => {
    test.skip(!authRequestId, "需要 ZITADEL_TEST_AUTH_REQUEST_ID 指向有效的测试授权请求。");
    await page.goto(path(`/login?authRequest=${encodeURIComponent(authRequestId!)}`));
    await expect(page.getByRole("heading", { name: "登录账号" })).toBeVisible();
    await expect(page.locator(".auth-card form, .auth-card button").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("uses the configured nickname and icon", async ({ page }) => {
    await page.goto(path("/login"));
    await expect(page.locator(".auth-brand")).toBeVisible();
    await expect(page.locator(".auth-brand img")).toHaveCount(process.env.SITE_ICON ? 1 : 0);
  });
});
