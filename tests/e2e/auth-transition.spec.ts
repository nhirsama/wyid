import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Script } from "node:vm";

// Bundle the real client components without adding a test route to the app or
// contacting ZITADEL. The fixture simulates Next's cookie-triggered RSC refresh.
const fixture = `
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrandProvider } from "@/components/auth/brand-provider";
import { AuthPanel, AuthShell } from "@/components/auth/auth-shell";
import { Feedback, Notice, Submit, useAuthAction } from "@/components/ui/form";
import "@/app/globals.css";
const control = window.authTest = { calls: 0 };
function Login() {
  const action = useAuthAction();
  return <form method="post" onSubmit={event => {
    event.preventDefault();
    action.run(() => new Promise((resolve, reject) => {
      control.calls++; control.resolve = resolve; control.reject = reject;
    }));
  }}><Feedback result={action.result} /><fieldset disabled={action.pending}>
    <label>邮箱或用户名<input name="loginName" defaultValue="test@example.com" /></label>
    <Submit pending={action.pending}>登录</Submit>
  </fieldset></form>;
}
function App() {
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => { control.refresh = () => setRefreshed(true); }, []);
  return <BrandProvider brand={{ nickname: "测试账号" }} basePath="/id"><AuthShell>
    <AuthPanel title={refreshed ? "登录失败" : "登录测试"} description="等待账号服务确认。">
      {refreshed ? <Notice kind="error">登录验证会话不可用。</Notice> : <Login />}
    </AuthPanel>
  </AuthShell></BrandProvider>;
}
createRoot(document.getElementById("root")).render(<App />);
`;

let html: string;
let javascript: string;
test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { console.error("[auth transition fixture]", error.message); });
});
test.beforeAll(async () => {
  const entry = resolve("tests/fixtures/auth-transition-browser.tsx");
  const fromVitest = createRequire(createRequire(resolve("package.json")).resolve("vitest/package.json"));
  const { build } = await import(fromVitest.resolve("vite"));
  const result = await build({
    configFile: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env": "{}" },
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{
      name: "auth-transition-fixture",
      resolveId(id: string) {
        if (id === entry) return id;
        if (["next/image", "next/link"].includes(id)) return `\0${id}`;
      },
      load(id: string) {
        if (id === entry) return fixture;
        if (id === "\0next/image") return 'import { createElement } from "react"; export default function Image({ unoptimized, priority, ...props }) { return createElement("img", props); }';
        if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
      },
    }],
    build: { write: false, lib: { entry, name: "AuthTransitionFixture", formats: ["iife"] } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const script = output.find((item: { type: string }) => item.type === "chunk").code;
  new Script(script, { filename: "auth-transition-fixture.js" });
  javascript = script;
  const css = output.find((item: { fileName: string }) => item.fileName.endsWith(".css")).source;
  html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
});

async function expectPendingForm(page: Page) {
  await expect(page.getByRole("heading", { name: "登录测试", exact: true })).toBeVisible();
  await expect(page.getByLabel("邮箱或用户名")).toBeVisible();
  await expect(page.getByLabel("邮箱或用户名")).toHaveValue("typed@example.com");
  await expect(page.getByRole("button", { name: "正在处理…", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "正在处理…", exact: true })).toBeDisabled();
  await expect(page.locator(".auth-panel-content")).toBeVisible();
  await expect(page.locator(".auth-progress")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("keeps the original form visible through a cookie refresh until a successful redirect", async ({ page }) => {
  await page.route("**/*", async route => {
    if (new URL(route.request().url()).pathname === "/fixture.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: javascript });
      return;
    }
    if (new URL(route.request().url()).pathname === "/id/done") {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>目标网站</h1>" });
    } else await route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://auth-fixture.test/id/login");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  await page.getByLabel("邮箱或用户名").fill("typed@example.com");
  await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expectPendingForm(page);
  expect(await page.evaluate("window.authTest.calls")).toBe(1);
  await page.evaluate("window.authTest.refresh()");
  await expectPendingForm(page);
  await expect(page.getByRole("heading", { name: "登录失败" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.evaluate('window.authTest.resolve({ ok: true, redirect: "/done" })');
  await expect(page).toHaveURL("http://auth-fixture.test/id/done");
  await expect(page.getByRole("heading", { name: "目标网站" })).toBeVisible();
});

test("only shows a confirmed server error after the response and allows retry", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).pathname === "/fixture.js"
    ? route.fulfill({ contentType: "text/javascript; charset=utf-8", body: javascript })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://auth-fixture.test/id/login");
  await page.getByLabel("邮箱或用户名").fill("typed@example.com");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expectPendingForm(page);
  await page.evaluate('window.authTest.resolve({ ok: false, message: "账号或密码错误" })');
  await expect(page.getByRole("alert")).toHaveText("账号或密码错误");
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  expect(await page.evaluate("window.authTest.calls")).toBe(2);
  await expectPendingForm(page);
  await page.evaluate('window.authTest.reject(new Error("connection lost"))');
  await expect(page.getByRole("alert")).toHaveText("暂时无法确认操作结果，请检查网络后重试。");
  await expect(page.getByText("登录失败", { exact: true })).toHaveCount(0);
});
