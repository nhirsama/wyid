import { expect, test } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { passwordForms } from "../fixtures/password-forms";

test.use({ javaScriptEnabled: false });

for (const { name, element } of passwordForms) {
  test(`${name} never puts passwords in the URL when JavaScript is unavailable`, async ({ page }) => {
    const url = `http://127.0.0.1:3100/security-fixture/${name}?authRequest=V2_security-fixture`;
    const submissions: { method: string; url: string; body: string | null }[] = [];
    await page.route("**/*", async route => {
      const request = route.request();
      if (request.method() === "GET" && request.url() === url && !submissions.length) {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${renderToStaticMarkup(element)}</body></html>` });
      } else {
        submissions.push({ method: request.method(), url: request.url(), body: request.postData() });
        await route.fulfill({ contentType: "text/html", body: "Submission captured by local fixture" });
      }
    });
    await page.goto(url);
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
    await expect(page.getByText("请启用 JavaScript 并重新加载页面后再提交。")).toBeVisible();

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
