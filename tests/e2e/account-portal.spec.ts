import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixture = `
import { createRoot } from "react-dom/client";
import { BrandProvider } from "@/components/auth/brand-provider";
import { AccountPortal } from "@/components/account/portal";
const account = { id: "user", displayName: "测试账号", givenName: "Given", familyName: "Family", email: "user@example.com", emailVerified: true, preferredLanguage: "zh-CN" };
const config = { configured: true, missing: [], issuer: "https://id.example.com", loginMethods: { password: true, registration: true, passkey: true }, passwordPolicy: { minLength: 8, hasUppercase: true, hasLowercase: true, hasNumber: true, hasSymbol: false } };
const basePath = document.documentElement.dataset.basePath || "";
createRoot(document.getElementById("root")).render(<BrandProvider brand={{ nickname: "Test ID" }} basePath={basePath}><AccountPortal route={window.location.pathname.slice((basePath + "/account").length)} initialAccount={account} config={config} /></BrandProvider>);
`;
let html: string;
let javascript: string;
test.beforeAll(async () => {
  const entry = resolve("tests/fixtures/account-portal-browser.tsx");
  const fromVitest = createRequire(createRequire(resolve("package.json")).resolve("vitest/package.json"));
  const { build } = await import(fromVitest.resolve("vite"));
  const result = await build({
    configFile: false, logLevel: "silent", define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env": "{}" },
    resolve: { alias: { "@": resolve("src") } },
    plugins: [{ name: "account-portal-fixture", enforce: "pre", resolveId(id: string) {
      if (id === entry) return id;
      if (["next/image", "next/link", "next/navigation"].includes(id)) return `\0${id}`;
    }, load(id: string) {
      if (id === entry) return fixture;
      if (id === "\0next/image") return 'import { createElement } from "react"; export default function Image({ unoptimized, priority, ...props }) { return createElement("img", props); }';
      if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
      if (id === "\0next/navigation") return 'export function useRouter() { return { push: p => window.location.assign(p), replace: p => window.location.replace(p) }; }';
    } }],
    build: { write: false, lib: { entry, name: "AccountPortalFixture", formats: ["iife"] } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  javascript = output.find((item: { type: string }) => item.type === "chunk").code;
  const css = readFileSync("src/app/globals.css", "utf8") + output.filter((item: { type: string; fileName: string }) => item.type === "asset" && item.fileName.endsWith(".css")).map((item: { source: string }) => item.source).join("\n");
  html = `<!doctype html><html lang="zh-CN" data-base-path="/id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
});
const initialApp = { id: "project:app", projectId: "project", name: "测试网站", website: "https://site.example.com", type: "spa", enabled: true, clientId: "client-id", redirectUris: ["https://site.example.com/callback"], postLogoutRedirectUris: [], createdAt: "2026-11-12T00:00:00Z", updatedAt: "2026-11-12T00:00:00Z" };
const avatarImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
test.beforeEach(async ({ context }) => {
  const apps = [structuredClone(initialApp)];
  const account = { id: "user", displayName: "测试账号", givenName: "Given", familyName: "Family", email: "user@example.com", emailVerified: true, preferredLanguage: "zh-CN", avatarUrl: "" };
  const methods: { type: string; id?: string; name: string; state: string }[] = [];
  const calls: { path: string; method: string; data: Record<string, unknown> }[] = [];
  let credentialId = "";
  await context.route("**/*", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: javascript });
    if (request.url() === "https://assets.example.com/avatar.png") return route.fulfill({ contentType: "image/png", body: avatarImage });
    if (!path.includes("/api/account/")) {
      const basePath = path.slice(0, path.lastIndexOf("/account/"));
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html.replace('data-base-path="/id"', `data-base-path="${basePath}"`) });
    }
    const endpoint = path.slice(path.indexOf("/api/account") + "/api/account".length), method = request.method();
    const data = method === "GET" || request.headers()["content-type"]?.startsWith("multipart/form-data") ? {} : request.postDataJSON() || {};
    calls.push({ path: endpoint, method, data });
    let value: unknown = {};
    if (endpoint === "/me") {
      if (method === "PATCH") { account.displayName = data.displayName; account.preferredLanguage = data.preferredLanguage; }
      value = { account };
    }
    else if (endpoint === "/me/avatar") { account.avatarUrl = method === "DELETE" ? "" : "https://assets.example.com/avatar.png"; value = { account }; }
    else if (endpoint === "/me/email") { account.email = data.email; account.emailVerified = false; value = { userId: account.id, account }; }
    else if (endpoint === "/apps" && method === "GET") value = { applications: apps };
    else if (endpoint === "/apps" && method === "POST") { const app = { ...initialApp, ...data, id: "project:new-app", clientId: "new-client-id" }; apps.push(app); value = { application: app, ...(data.type === "web" ? { clientSecret: "one-time-secret" } : {}) }; }
    else if (endpoint.startsWith("/apps/") && method === "GET") value = { application: apps.find(app => app.id === decodeURIComponent(endpoint.slice(6))) };
    else if (endpoint.startsWith("/apps/") && method === "DELETE") { apps.splice(apps.findIndex(app => app.id === decodeURIComponent(endpoint.slice(6))), 1); value = { removed: true }; }
    else if (endpoint === "/me/methods") value = { methods, available: { totp: true, webauthn: true, passkey: true, "otp-email": true, "otp-sms": true }, phone: { number: "", verified: false } };
    else if (endpoint === "/me/methods/totp") value = { secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Test:user?secret=JBSWY3DPEHPK3PXP&issuer=Test" };
    else if (endpoint === "/me/methods/totp/verify") { methods.push({ type: "totp", name: "验证器 TOTP", state: "READY" }); value = { verified: true }; }
    else if (endpoint === "/me/methods/key") value = { publicKey: { challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", rp: { id: "localhost", name: "Test ID" }, user: { id: "dXNlcg", name: "user", displayName: "测试账号" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" } } };
    else if (endpoint === "/me/methods/key/verify") { credentialId = data.credential.id; methods.push({ type: "passkey", id: "new-key", name: data.name, state: "READY" }); value = { verified: true }; }
    else if (endpoint === "/me/methods/check/send") value = { method: "passkey", publicKey: { challenge: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE", rpId: "localhost", userVerification: "required", allowCredentials: [{ type: "public-key", id: credentialId }] } };
    else if (endpoint === "/me/methods/check") value = { verified: true };
    else if (endpoint === "/me/sessions") value = { devices: [{ id: "current", name: "Chrome 当前浏览器", current: true, createdAt: initialApp.createdAt, lastUsedAt: initialApp.updatedAt }, { id: "other", name: "Firefox 其他设备", current: false, createdAt: initialApp.createdAt, lastUsedAt: initialApp.updatedAt }] };
    else if (endpoint.startsWith("/me/sessions/")) value = { signedOut: endpoint.endsWith("current") };
    else if (endpoint === "/test-calls") value = { calls };
    else return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: endpoint } }) });
    return route.fulfill({ contentType: "application/json; charset=utf-8", body: JSON.stringify(value) });
  });
});

test("applications, base-path navigation, create wizard and exact callback fields", async ({ page }, testInfo) => {
  await page.goto("http://localhost/id/account/apps");
  await expect(page.getByRole("heading", { name: "我的应用", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索应用" }).fill("unmatched");
  await expect(page.getByText("没有匹配的应用，请调整搜索内容。")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索应用" }).fill("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("applications.png"), fullPage: true });
  await page.getByRole("link", { name: "创建应用", exact: true }).click();
  await expect(page).toHaveURL("http://localhost/id/account/apps/new");
  await page.getByRole("button", { name: /有后端的网站/ }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByLabel("应用名称", { exact: true }).fill("新的服务端网站");
  await page.getByLabel("网站来源地址", { exact: true }).fill("https://new.example.com");
  await page.getByRole("textbox", { name: "登录回调地址 1", exact: true }).fill("https://new.example.com/auth/callback");
  await page.getByRole("button", { name: "创建应用", exact: true }).click();
  await expect(page.getByRole("heading", { name: "应用已创建", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "显示密钥", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "显示密钥", exact: true }).click();
  await expect(page.getByText("one-time-secret", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "进入应用详情" })).toHaveAttribute("href", "/id/account/apps/project:new-app");
  await page.getByRole("link", { name: "进入应用详情" }).click();
  await expect(page).toHaveURL("http://localhost/id/account/apps/project:new-app");
  await expect(page.getByRole("heading", { name: "新的服务端网站", exact: true })).toBeVisible();
});

for (const basePath of ["", "/id", "/account/login-ui"]) {
  test(`portal navigation and history preserve the document and cached lists under ${basePath || "/"}`, async ({ page }) => {
    const navigations: string[] = [];
    const reads: string[] = [];
    page.on("request", request => {
      if (request.isNavigationRequest()) navigations.push(request.url());
      if (request.method() === "GET" && request.url().includes("/api/account/")) reads.push(new URL(request.url()).pathname);
    });
    await page.goto(`http://localhost${basePath}/account/apps`);
    await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
    const shell = await page.locator(".portal").elementHandle();
    await page.getByRole("link", { name: "测试网站", exact: true }).click();
    await expect(page).toHaveURL(`http://localhost${basePath}/account/apps/project:app`);
    await expect(page.getByRole("heading", { name: "测试网站", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "我的应用", exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "测试网站", exact: true })).toBeVisible();
    await page.locator(".back-link").click();
    await expect(page.getByRole("heading", { name: "我的应用", exact: true })).toBeVisible();
    expect(await shell!.evaluate(node => node.isConnected)).toBe(true);
    expect(navigations).toHaveLength(1);
    expect(reads.filter(path => path === `${basePath}/api/account/apps`)).toHaveLength(1);
    expect(reads.filter(path => path.includes("/apps/project"))).toHaveLength(1);
  });
}

test("profile saves survive a page switch without refetching the entire portal", async ({ page }) => {
  await page.goto("http://localhost/id/account/settings/profile");
  await page.getByLabel("昵称", { exact: true }).fill("新的昵称");
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(page.getByText("个人资料已保存。", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "密码与验证方式", exact: true }).click();
  await expect(page.getByRole("heading", { name: "两步验证", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "个人资料", exact: true }).click();
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("新的昵称");
  await expect(page.locator(".sidebar-user strong")).toHaveText("新的昵称");
});

test("a unified profile places an editable avatar beside the forms and uploads without reloading", async ({ page, isMobile }, testInfo) => {
  await page.goto("http://localhost/id/account/settings/profile");
  await expect(page.locator(".panel")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "个人资料", exact: true })).toBeVisible();
  const input = page.getByLabel("选择头像图片", { exact: true });
  await expect(input).toBeHidden();
  await expect(page.getByRole("button", { name: "保存头像", exact: true })).toHaveCount(0);
  const fields = await page.locator(".profile-fields").boundingBox();
  const avatar = await page.locator(".profile-avatar").boundingBox();
  if (isMobile) expect(avatar!.y + avatar!.height).toBeLessThanOrEqual(fields!.y);
  else expect(fields!.x + fields!.width).toBeLessThanOrEqual(avatar!.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("profile.png"), fullPage: true });

  const shell = await page.locator(".portal").elementHandle();
  await page.getByLabel("昵称", { exact: true }).fill("未保存的昵称");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "更换头像", exact: true }).focus();
  await page.keyboard.press("Enter");
  await (await chooserPromise).setFiles({ name: "avatar.png", mimeType: "image/png", buffer: avatarImage });
  await expect(page.getByRole("img", { name: "所选头像预览", exact: true })).toBeVisible();
  const upload = page.waitForRequest(request => request.url().endsWith("/me/avatar") && request.method() === "POST");
  await page.getByRole("button", { name: "保存头像", exact: true }).click();
  const request = await upload;
  expect(request.headers()["content-type"]).toContain("multipart/form-data");
  expect(request.postDataBuffer()?.toString()).toContain('filename="avatar.png"');
  await expect(page.getByText("头像已更新。", { exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-user .avatar img")).toHaveAttribute("src", "https://assets.example.com/avatar.png");
  await expect(page.getByRole("img", { name: "所选头像预览", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("未保存的昵称");
  expect(await shell!.evaluate(node => node.isConnected)).toBe(true);
  await page.getByRole("button", { name: "移除头像", exact: true }).click();
  await expect(page.getByText("头像已移除。", { exact: true })).toBeVisible();
  await expect(page.locator(".avatar-picker img, .sidebar-user .avatar img")).toHaveCount(0);
});

test("avatar previews can be cancelled or replaced and reject invalid files before uploading", async ({ page }) => {
  await page.goto("http://localhost/id/account/settings/profile");
  const input = page.getByLabel("选择头像图片", { exact: true });
  const file = { name: "avatar.png", mimeType: "image/png", buffer: avatarImage };
  await input.setInputFiles(file);
  const previewUrl = await page.locator(".avatar-picker img").getAttribute("src");
  await input.setInputFiles({ ...file, name: "replacement.png" });
  await expect(page.locator(".avatar-picker img")).not.toHaveAttribute("src", previewUrl!);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("img", { name: "所选头像预览", exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("");
  await input.setInputFiles(file);
  await expect(page.getByRole("img", { name: "所选头像预览", exact: true })).toBeVisible();
  for (const [buffer, mimeType, message] of [
    [Buffer.alloc(512 * 1024 + 1), "image/png", "头像图片不能超过 512 KiB，请选择较小的图片。"],
    [Buffer.from("not an image"), "text/plain", "请选择图片文件作为头像。"],
    [Buffer.alloc(0), "image/png", "请选择有内容的头像图片。"],
  ] as const) {
    await input.setInputFiles({ name: "invalid", mimeType, buffer });
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(page.getByRole("button", { name: "保存头像", exact: true })).toHaveCount(0);
  }
  const calls = await page.evaluate(async () => (await (await fetch("/id/api/account/test-calls")).json()).calls);
  expect(calls.filter((call: { path: string }) => call.path === "/me/avatar")).toHaveLength(0);
});

test("an avatar upload disables editing while pending and keeps the preview for retry on failure", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/account/me/avatar", async route => {
    await pending;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "avatar_upload_failed", message: "头像上传失败，请重试。" } }) });
  });
  await page.goto("http://localhost/id/account/settings/profile");
  await page.getByLabel("选择头像图片", { exact: true }).setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: avatarImage });
  await page.getByRole("button", { name: "保存头像", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "更换头像", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "正在处理…", exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole("alert")).toContainText("头像上传失败，请重试。");
  await expect(page.getByRole("img", { name: "所选头像预览", exact: true })).toBeVisible();
  await page.unroute("**/api/account/me/avatar");
  await page.getByRole("button", { name: "保存头像", exact: true }).click();
  await expect(page.getByText("头像已更新。", { exact: true })).toBeVisible();
});

test("the merged profile preserves the separate email verification flow and unsaved profile fields", async ({ page }) => {
  await page.goto("http://localhost/id/account/settings/profile");
  await page.getByLabel("昵称", { exact: true }).fill("未保存的昵称");
  await page.getByLabel("新邮箱", { exact: true }).fill("new@example.com");
  await page.getByLabel("当前登录密码", { exact: true }).fill("current-password");
  await page.getByRole("button", { name: "保存并发送验证邮件", exact: true }).click();
  await expect(page.getByText("待验证", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "输入验证码", exact: true })).toHaveAttribute("href", "/id/verify-email?userID=user");
  await expect(page.getByLabel("昵称", { exact: true })).toHaveValue("未保存的昵称");
  const calls = await page.evaluate(async () => (await (await fetch("/id/api/account/test-calls")).json()).calls);
  expect(calls.filter((call: { path: string; method: string }) => call.path === "/me" && call.method === "PATCH")).toHaveLength(0);
});

test("programmatic navigation after deletion invalidates the list without reloading", async ({ page }) => {
  await page.goto("http://localhost/id/account/apps");
  await page.getByRole("link", { name: "测试网站", exact: true }).click();
  const shell = await page.locator(".portal").elementHandle();
  await page.getByRole("tab", { name: "应用设置", exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page).toHaveURL("http://localhost/id/account/apps");
  await expect(page.getByRole("heading", { name: "创建你的第一个应用", exact: true })).toBeVisible();
  expect(await shell!.evaluate(node => node.isConnected)).toBe(true);
});

test("focus and visibility changes throttle background checks without evicting lists", async ({ page }) => {
  await page.clock.install();
  await page.goto("http://localhost/id/account/apps");
  await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
  const checks: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/id/api/account/me") checks.push(request.url()); });
  const focus = () => page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await focus();
  expect(checks).toHaveLength(0);
  await page.clock.fastForward(60_001);
  await focus();
  await expect.poll(() => checks.length).toBe(1);
  await focus();
  expect(checks).toHaveLength(1);
  await page.getByRole("link", { name: "测试网站", exact: true }).click();
  await page.locator(".back-link").click();
  const calls = await page.evaluate(async () => (await (await fetch("/id/api/account/test-calls")).json()).calls);
  // The cache has expired after a minute, so exactly one fresh list read is needed.
  expect(calls.filter((call: { path: string }) => call.path === "/apps")).toHaveLength(2);
});

test("a temporary background refresh failure does not claim the session expired", async ({ page }) => {
  await page.clock.install();
  await page.goto("http://localhost/id/account/apps");
  await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
  await page.route("**/api/account/me", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable", message: "稍后重试" } }) }));
  await page.clock.fastForward(60_001);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("暂时无法刷新账号资料");
  await expect(page.getByRole("link", { name: "继续身份验证", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
});

test("an expired background session still requires server-owned authentication", async ({ page }) => {
  await page.clock.install();
  await page.goto("http://localhost/id/account/apps");
  await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
  await page.route("**/api/account/me", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "session_expired", message: "重新登录" } }) }));
  await page.clock.fastForward(60_001);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("登录状态发生变化");
  await expect(page.getByRole("link", { name: "继续身份验证", exact: true })).toHaveAttribute("href", "/id/account");
});

test("switching accounts in another tab discards the previous principal's document", async ({ page }) => {
  await page.clock.install();
  const documents: string[] = [];
  page.on("request", request => { if (request.isNavigationRequest()) documents.push(request.url()); });
  await page.goto("http://localhost/id/account/apps");
  await expect(page.getByRole("link", { name: "测试网站", exact: true })).toBeVisible();
  await page.route("**/api/account/me", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ account: { id: "another-user", displayName: "其他账号" } }) }));
  await page.clock.fastForward(60_001);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => documents.length).toBe(2);
  await expect(page.locator(".sidebar-user strong")).not.toHaveText("其他账号");
});

test("modified link clicks are left to the browser instead of portal navigation", async ({ page }) => {
  await page.goto("http://localhost/id/account/apps");
  const link = page.getByRole("link", { name: "测试网站", exact: true });
  await expect(link).toBeVisible();
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    const intercepted = await link.evaluate((node, modifier) => {
      let prevented = false;
      // Observe after React's delegated handler, then suppress the actual OS
      // tab/window gesture to make this check work in headless/mobile Chrome.
      document.addEventListener("click", event => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true }));
      return prevented;
    }, modifier);
    expect(intercepted, modifier).toBe(false);
  }
  await expect(page).toHaveURL("http://localhost/id/account/apps");
});

test("profile fields and TOTP QR setup work in the current visual shell", async ({ page }, testInfo) => {
  await page.goto("http://localhost/id/account/settings/profile");
  await page.getByLabel("昵称", { exact: true }).fill("新的昵称");
  await page.getByLabel("通知语言", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await expect(page.getByText("个人资料已保存。", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "密码与验证方式", exact: true }).click();
  await expect(page).toHaveURL("http://localhost/id/account/settings/security");
  const row = page.locator(".setting-row").filter({ hasText: "验证器 TOTP" });
  await row.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "获取验证器密钥", exact: true }).click();
  await expect(page.getByRole("img", { name: "TOTP 验证器绑定二维码", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("totp-setup.png"), fullPage: true });
  await page.getByLabel("验证器动态验证码").fill("123456");
  await page.getByRole("button", { name: "完成绑定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("Passkey registration creates a resident credential, then performs a fresh UV assertion", async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  try {
    await page.goto("http://localhost/id/account/settings/security");
    await page.locator(".setting-row").filter({ hasText: "通行密钥 Passkey" }).getByRole("button", { name: "添加", exact: true }).click();
    await page.getByLabel("设备名称", { exact: true }).fill("Bitwarden 测试");
    await page.getByRole("button", { name: "开始绑定", exact: true }).click();
    await expect(page.getByRole("button", { name: "验证并完成设置", exact: true })).toBeVisible();
    const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
    expect(credentials).toHaveLength(1); expect(credentials[0].isResidentCredential).toBe(true);
    await page.getByRole("button", { name: "验证并完成设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Bitwarden 测试", exact: true })).toBeVisible();
    const calls = await page.evaluate(async () => (await (await fetch("/id/api/account/test-calls")).json()).calls);
    expect(calls.filter((call: { path: string }) => call.path === "/me/methods/check")).toHaveLength(1);
  } finally { if (!page.isClosed()) { await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }); await client.detach(); } }
});

test("device confirmations, mobile navigation and help remain under the base path", async ({ page, isMobile }) => {
  await page.goto("http://localhost/id/account/settings/devices");
  await expect(page.getByText("Firefox 其他设备", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出其他设备", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "退出其他设备？" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (isMobile) {
    await page.getByRole("button", { name: "打开菜单", exact: true }).click();
    await page.getByRole("dialog").getByRole("link", { name: "接入帮助", exact: true }).click();
  } else await page.locator(".sidebar").getByRole("link", { name: "接入帮助", exact: true }).click();
  await expect(page).toHaveURL("http://localhost/id/account/help");
  await expect(page.getByRole("heading", { name: "接入帮助", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.getByRole("link", { name: "创建应用", exact: true })).toHaveAttribute("href", "/id/account/apps/new");
});
