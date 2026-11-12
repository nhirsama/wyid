import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const fixture = `
import { createRoot } from "react-dom/client";
import { LoginForm } from "@/components/auth/forms";
import { BrandProvider } from "@/components/auth/brand-provider";
const control = window.passkeyTest = { known: false, gets: 0, starts: [], finishes: [] };
const get = navigator.credentials.get.bind(navigator.credentials);
navigator.credentials.get = (...args) => { control.gets++; return get(...args); };
createRoot(document.getElementById("root")).render(
  <BrandProvider brand={{ nickname: "Passkey Test" }} basePath="">
    <LoginForm context={{}} policy={{ password: false, passkey: true, registration: false, passwordReset: false,
      forceMfa: true, forceMfaLocalOnly: false, factors: ["totp"], userVerifiedKey: true, identityProviders: [],
      passwordPolicy: { minLength: 8, uppercase: false, lowercase: false, number: false, symbol: false } }} />
  </BrandProvider>
);
`;

const actions = `
export async function startPasskey(input) {
  const control = window.passkeyTest;
  control.starts.push(input);
  const options = { challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", rpId: "localhost", userVerification: "required" };
  if (input.chooseAccount || (!control.known && !input.userId)) {
    return { ok: true, discoverUser: true, options };
  }
  if (input.userId && input.userId !== "fixture-user") return { ok: false, message: "账号不匹配。" };
  return { ok: true, options };
}
export async function finishPasskey(credential) {
  window.passkeyTest.finishes.push(credential);
  window.passkeyTest.known = true;
  return { ok: true, message: "登录成功。" };
}
export const chooseIdentityProvider = async () => ({ ok: false, message: "未启用。" });
export const login = chooseIdentityProvider, register = chooseIdentityProvider, requestPasswordReset = chooseIdentityProvider,
  resendEmail = chooseIdentityProvider, resetPassword = chooseIdentityProvider, verifyEmail = chooseIdentityProvider;
`;

let html: string;
test.beforeAll(async () => {
  const entry = resolve("tests/fixtures/passkey-browser.tsx");
  const fromVitest = createRequire(createRequire(resolve("package.json")).resolve("vitest/package.json"));
  const { build } = await import(fromVitest.resolve("vite"));
  const result = await build({
    configFile: false, logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: { alias: { "@/server/actions": "\0passkey-actions", "next/link": "\0next/link", "@": resolve("src") } },
    plugins: [{
      name: "passkey-browser-fixture",
      enforce: "pre",
      resolveId(id: string) {
        if (id === entry) return id;
        if (id === "next/link") return "\0next/link";
        if (id.endsWith("/server/actions")) return "\0passkey-actions";
      },
      load(id: string) {
        if (id === entry) return fixture;
        if (id === "\0passkey-actions") return actions;
        if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
      },
    }],
    build: { write: false, lib: { entry, name: "PasskeyFixture", formats: ["iife"] } },
  });
  const output = (Array.isArray(result) ? result[0] : result).output;
  const script = output.find((item: { type: string }) => item.type === "chunk").code;
  html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script>globalThis.process = { env: { NODE_ENV: "production" } };</script><script>${script}</script></body></html>`;
});

test("passkey login needs no username or extra click and always discovers the account without a username", async ({ page, context }) => {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  try {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto("http://localhost/passkey-test");
    await expect(page.getByRole("button", { name: "使用通行密钥登录", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.credentials.create({ publicKey: {
        challenge: new Uint8Array(32), rp: { id: "localhost", name: "Passkey Test" },
        user: { id: new TextEncoder().encode("fixture-user"), name: "fixture-user", displayName: "Fixture User" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      } });
    });
    // Preserve the existing login layout; passkey login does not require this
    // field to be filled in or validated.
    await expect(page.locator('input[name="loginName"]')).toHaveValue("");
    await page.getByRole("button", { name: "使用通行密钥登录", exact: true }).click();
    await expect(page.getByText("登录成功。", { exact: true })).toBeVisible();
    expect(await page.evaluate("window.passkeyTest.gets")).toBe(2);
    expect(await page.evaluate("window.passkeyTest.starts")).toEqual([{ chooseAccount: true }, { userId: "fixture-user" }]);
    expect(await page.evaluate("window.passkeyTest.finishes.length")).toBe(1);
    await expect(page.getByRole("button", { name: "继续使用通行密钥" })).toHaveCount(0);

    await page.getByRole("button", { name: "使用通行密钥登录", exact: true }).click();
    await expect.poll(() => page.evaluate("window.passkeyTest.finishes.length")).toBe(2);
    expect(await page.evaluate("window.passkeyTest.gets")).toBe(4);

    await expect(page.getByRole("button", { name: "选择其他通行密钥账号", exact: true })).toHaveCount(0);
  } finally {
    if (!page.isClosed()) {
      await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await client.detach();
    }
  }
});
