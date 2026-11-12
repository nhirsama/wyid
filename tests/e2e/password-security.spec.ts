import { expect, test } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Render source through the same ESM-aware pipeline as the other browser
// fixtures. Requiring the icon package's mislabelled CJS entry breaks Node 22.
const renderedForms = new Map<string, string>();
test.beforeAll(async () => {
  const fromVitest = createRequire(createRequire(resolve("package.json")).resolve("vitest/package.json"));
  const { createServer } = await import(fromVitest.resolve("vite"));
  const server = await createServer({ configFile: false, logLevel: "silent", resolve: { alias: { "@": resolve("src") } }, server: { middlewareMode: true, hmr: false }, ssr: { noExternal: ["@phosphor-icons/react"] } });
  try {
    const { passwordForms } = await server.ssrLoadModule("/tests/fixtures/password-forms.tsx");
    for (const { name, element } of passwordForms) renderedForms.set(name, renderToStaticMarkup(element));
  } finally { await server.close(); }
});

test.use({ javaScriptEnabled: false });

for (const name of ["login", "registration", "password-reset", "password-change"]) {
  test(`${name} never puts passwords in the URL when JavaScript is unavailable`, async ({ page }) => {
    const url = `http://127.0.0.1:3100/security-fixture/${name}?authRequest=V2_security-fixture`;
    const submissions: { method: string; url: string; body: string | null }[] = [];
    await page.route("**/*", async route => {
      const request = route.request();
      if (request.method() === "GET" && request.url() === url && !submissions.length) {
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${renderedForms.get(name)}</body></html>` });
      } else {
        submissions.push({ method: request.method(), url: request.url(), body: request.postData() });
        await route.fulfill({ contentType: "text/html", body: "Submission captured by local fixture" });
      }
    });
    await page.goto(url);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    // Chromium's script-execution emulation can retain the parser's scripting
    // flag, so inspect the noscript fallback's text rather than its visibility.
    // Playwright's text matcher excludes noscript, so read DOM text directly.
    expect(await page.locator("noscript").textContent()).toContain("请启用 JavaScript 并重新加载页面后再提交。");

    const password = "fixture secret &+#?密码";
    await page.locator('input[name="password"]').fill(password);
    const confirm = page.locator('input[name="confirmPassword"]');
    const hasConfirmation = await confirm.count() > 0;
    if (hasConfirmation) await confirm.fill(password);

    // Bypass the disabled button deliberately to exercise the browser's native
    // fallback. This must remain POST even without any React event handlers.
    const requestPromise = page.waitForRequest(request => request.isNavigationRequest() && request.frame() === page.mainFrame());
    await page.locator("form").evaluate(form => HTMLFormElement.prototype.submit.call(form));
    await requestPromise;
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0].method).toBe("POST");
    expect(submissions[0].url).toBe(url);
    expect(new URLSearchParams(submissions[0].body || "").get("password")).toBe(password);
    if (hasConfirmation) expect(new URLSearchParams(submissions[0].body || "").get("confirmPassword")).toBe(password);
    expect(new URL(submissions[0].url).searchParams.has("password")).toBe(false);
    expect(new URL(submissions[0].url).searchParams.has("confirmPassword")).toBe(false);
  });
}
