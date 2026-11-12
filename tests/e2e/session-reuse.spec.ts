import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Exercise the real automatic continuation and action lock without requiring
// live accounts, credentials, or a consumable upstream authorization request.
const fixture = `
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrandProvider } from "@/components/auth/brand-provider";
import { AuthPanel } from "@/components/auth/auth-shell";
import { ResumeLoginForm } from "@/components/auth/resume-login-form";
const control = window.reuseTest = { calls: [] };
function App() {
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => { control.refresh = () => setRefreshed(true); }, []);
  return <BrandProvider brand={{ nickname: "Session Test" }} basePath="/id">
    <AuthPanel title="恢复登录测试" description="读取已有会话。">
      {refreshed ? <div>cookie refresh</div> : <ResumeLoginForm context={{ authRequestId: "V2_reuse" }} />}
    </AuthPanel>
  </BrandProvider>;
}
createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
`;
const actions = `
export function resumeLogin(context) {
  const control = window.reuseTest;
  control.calls.push(context);
  return new Promise((resolve, reject) => { control.resolve = resolve; control.reject = reject; });
}
`;

let html: string;
let javascript: string;
test.beforeAll(async () => {
  const entry = resolve("tests/fixtures/session-reuse-browser.tsx");
  const fromVitest = createRequire(createRequire(resolve("package.json")).resolve("vitest/package.json"));
  const { build } = await import(fromVitest.resolve("vite"));
  const result = await build({
    configFile: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env": "{}" },
    resolve: { alias: { "@/server/actions": "\0session-actions", "@": resolve("src") } },
    plugins: [{
      name: "session-reuse-fixture",
      enforce: "pre",
      resolveId(id: string) {
        if (id === entry) return id;
        if (["next/image", "next/link"].includes(id)) return `\0${id}`;
        if (id.endsWith("/server/actions")) return "\0session-actions";
      },
      load(id: string) {
        if (id === entry) return fixture;
        if (id === "\0session-actions") return actions;
        if (id === "\0next/image") return 'import { createElement } from "react"; export default function Image({ unoptimized, priority, ...props }) { return createElement("img", props); }';
        if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
      },
    }],
    build: { write: false, lib: { entry, name: "SessionReuseFixture", formats: ["iife"] } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  javascript = output.find((item: { type: string }) => item.type === "chunk").code;
  html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: javascript });
    if (path === "/id/done") return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>授权页面</h1>" });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
  });
});

test("automatically resumes once and preserves the in-flight action across a cookie refresh", async ({ page }) => {
  await page.goto("http://session-fixture.test/id/reuse");
  await expect.poll(() => page.evaluate("window.reuseTest.calls")).toEqual([{ authRequestId: "V2_reuse" }]);
  await expect(page.getByRole("button", { name: "正在处理…", exact: true })).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await page.evaluate("window.reuseTest.refresh()");
  expect(await page.evaluate("window.reuseTest.calls.length")).toBe(1);
  await expect(page.getByText("cookie refresh")).toHaveCount(0);
  await page.evaluate('window.reuseTest.resolve({ ok: true, redirect: "/done" })');
  await expect(page).toHaveURL("http://session-fixture.test/id/done");
  await expect(page.getByRole("heading", { name: "授权页面" })).toBeVisible();
});

test("does not retry automatically after a failure and allows an explicit retry", async ({ page }) => {
  await page.goto("http://session-fixture.test/id/reuse");
  await expect.poll(() => page.evaluate("window.reuseTest.calls.length")).toBe(1);
  await page.evaluate('window.reuseTest.resolve({ ok: false, message: "账号服务暂时不可用。" })');
  await expect(page.getByRole("alert")).toHaveText("账号服务暂时不可用。");
  await expect(page.getByRole("button", { name: "继续登录", exact: true })).toBeEnabled();
  expect(await page.evaluate("window.reuseTest.calls.length")).toBe(1);
  await page.getByRole("button", { name: "继续登录", exact: true }).click();
  await expect.poll(() => page.evaluate("window.reuseTest.calls.length")).toBe(2);
  await page.evaluate('window.reuseTest.resolve({ ok: true, redirect: "/done" })');
  await expect(page).toHaveURL("http://session-fixture.test/id/done");
});
