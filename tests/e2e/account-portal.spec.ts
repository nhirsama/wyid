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
createRoot(document.getElementById("root")).render(<BrandProvider brand={{ nickname: "Test ID" }} basePath="/id"><AccountPortal route={window.location.pathname.replace("/id/account", "")} initialAccount={account} config={config} /></BrandProvider>);
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
test.beforeEach(async ({ page }) => {
  const apps = [structuredClone(initialApp)];
  const methods: { type: string; id?: string; name: string; state: string }[] = [];
  const calls: { path: string; method: string; data: Record<string, unknown> }[] = [];
  let credentialId = "";
  await page.route("**/*", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: javascript });
    if (!path.startsWith("/id/api/account")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    const endpoint = path.slice("/id/api/account".length), method = request.method();
    const data = method === "GET" ? {} : request.postDataJSON() || {};
    calls.push({ path: endpoint, method, data });
    let value: unknown = {};
    if (endpoint === "/me") value = { account: { id: "user", displayName: data.displayName || "测试账号", email: "user@example.com", emailVerified: true, preferredLanguage: data.preferredLanguage || "zh-CN", givenName: "Given", familyName: "Family" } };
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
