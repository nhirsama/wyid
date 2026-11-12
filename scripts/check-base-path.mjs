import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { spawn } from "node:child_process";
import { createServer as createHttp2Server } from "node:http2";
import { createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { EncryptJWT } from "jose";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { GetLoginSettingsResponseSchema, GetPasswordComplexitySettingsResponseSchema } from "@zitadel/proto/zitadel/settings/v2/settings_service_pb.js";
import { GetAuthRequestRequestSchema, GetAuthRequestResponseSchema } from "@zitadel/proto/zitadel/oidc/v2/oidc_service_pb.js";
import { GetSessionResponseSchema, ListSessionsResponseSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb.js";
import { GetUserByIDResponseSchema, ListAuthenticationFactorsResponseSchema, ListPasskeysResponseSchema, UpdateHumanUserResponseSchema } from "@zitadel/proto/zitadel/user/v2/user_service_pb.js";
import { ListUserMembershipsResponseSchema, ListAppsResponseSchema, GetAppByIDResponseSchema } from "@zitadel/proto/zitadel/management_pb.js";

const fixtureUser = { userId: "fixture-user", username: "fixture-user", details: { resourceOwner: "fixture-org" }, type: { case: "human", value: { profile: { givenName: "Fixture", familyName: "User", displayName: "Portal Fixture", preferredLanguage: "zh-CN" }, email: { email: "fixture@example.test", isVerified: true } } } };
const fixtureApp = { id: "fixture-app", name: "Portal Application", state: 1, config: { case: "oidcConfig", value: { clientId: "fixture-client", appType: 1, redirectUris: ["https://site.example.test/callback"], additionalOrigins: ["https://site.example.test"] } } };
const fixtureSession = () => ({ id: "fixture-session", factors: { user: { id: "fixture-user" }, password: { verifiedAt: { seconds: BigInt(Math.floor(Date.now() / 1000)) } } } });
const fixtureSecret = "local-fixture-session-secret-at-least-32-chars";
const userRpcHeaders = [];

// One deployment contract: every app-owned URL stays under BASE_PATH.
// Check the actual production pages, responses, resources and Webpack loader.
// All upstream traffic goes to a local fixture; no browser or real account.
const chunks = join(process.cwd(), ".next/static/chunks");
const entries = readdirSync(chunks).filter(name => /^main-app-.*\.js$/.test(name));
assert.equal(entries.length, 1, "Build the app with pnpm build before checking its assets");
const entry = entries[0];
const source = readFileSync(join(chunks, entry), "utf8");

function checkChunkLoader(basePath) {
  const origin = "https://auth.example.com";
  const sandbox = {
    self: { webpackChunk_N_E: [] },
    URL,
    document: {
      baseURI: `${origin}${basePath}/login?authRequest=V2_test`,
      currentScript: { getAttribute: () => `${basePath}/_next/static/chunks/${entry}` },
    },
  };
  runInNewContext(source, sandbox);
  const factories = Object.assign({}, ...sandbox.self.webpackChunk_N_E.map(chunk => chunk[1]));
  const instrumentation = Object.entries(factories).filter(([, factory]) => {
    const code = factory.toString();
    return code.includes("document.currentScript") && code.includes('getAttribute("src")');
  });
  assert.equal(instrumentation.length, 1, "The production client entry must contain asset-path initialization");

  const modules = new Map();
  function requireModule(id) {
    if (modules.has(id)) return modules.get(id).exports;
    const record = { exports: {} };
    modules.set(id, record);
    assert.ok(factories[id], `Missing emitted module ${id}`);
    factories[id](record, record.exports, requireModule);
    return record.exports;
  }
  requireModule.p = "/_next/";
  requireModule.r = exports => Object.defineProperty(exports, "__esModule", { value: true });
  requireModule.d = (exports, definitions) => {
    for (const [name, get] of Object.entries(definitions)) Object.defineProperty(exports, name, { get });
  };
  requireModule(instrumentation[0][0]);
  assert.equal(requireModule.p, `${origin}${basePath}/_next/`);
  assert.equal(`${requireModule.p}static/chunks/lazy.js`, `${origin}${basePath}/_next/static/chunks/lazy.js`);
}

const upstream = createHttp2Server();
const sessions = new Set();
const unexpectedRpc = new Set();
upstream.on("session", session => { sessions.add(session); session.once("close", () => sessions.delete(session)); });
upstream.on("stream", (stream, headers) => {
  const body = [];
  stream.on("data", chunk => body.push(chunk));
  stream.on("end", () => {
    const path = headers[":path"];
    if (path.includes(".ManagementService/") || path.endsWith("/UpdateHumanUser")) userRpcHeaders.push(headers);
    let schema, value;
    if (path.endsWith("/GetLoginSettings")) {
      schema = GetLoginSettingsResponseSchema;
      value = { settings: { allowUsernamePassword: true, allowRegister: true } };
    } else if (path.endsWith("/GetPasswordComplexitySettings")) {
      schema = GetPasswordComplexitySettingsResponseSchema;
      value = { settings: { minLength: 8n } };
    } else if (path.endsWith("/GetAuthRequest")) {
      const request = fromBinary(GetAuthRequestRequestSchema, Buffer.concat(body).subarray(5));
      schema = GetAuthRequestResponseSchema;
      value = { authRequest: { id: request.authRequestId, clientId: "fixture-client", redirectUri: "https://app.example.test/callback", scope: ["openid"] } };
    } else if (path.endsWith("/GetSession")) {
      schema = GetSessionResponseSchema; value = { session: fixtureSession() };
    } else if (path.endsWith("/ListSessions")) {
      schema = ListSessionsResponseSchema; value = { sessions: [fixtureSession()] };
    } else if (path.endsWith("/GetUserByID")) {
      schema = GetUserByIDResponseSchema; value = { user: fixtureUser };
    } else if (path.endsWith("/ListAuthenticationFactors")) {
      schema = ListAuthenticationFactorsResponseSchema; value = { result: [] };
    } else if (path.endsWith("/ListPasskeys")) {
      schema = ListPasskeysResponseSchema; value = { result: [] };
    } else if (path.endsWith("/ListUserMemberships")) {
      schema = ListUserMembershipsResponseSchema; value = { result: [{ userId: "fixture-user", details: { resourceOwner: "fixture-org" }, roles: ["PROJECT_OWNER"], type: { case: "projectId", value: "fixture-project" } }] };
    } else if (path.endsWith("/ListApps")) {
      schema = ListAppsResponseSchema; value = { result: [fixtureApp] };
    } else if (path.endsWith("/GetAppByID")) {
      schema = GetAppByIDResponseSchema; value = { app: fixtureApp };
    } else if (path.endsWith("/UpdateHumanUser")) {
      schema = UpdateHumanUserResponseSchema; value = {};
    } else {
      unexpectedRpc.add(path);
    }
    const payload = schema ? toBinary(schema, create(schema, value)) : Buffer.alloc(0);
    const envelope = Buffer.alloc(5);
    envelope.writeUInt32BE(payload.length, 1);
    stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
    stream.once("wantTrailers", () => stream.sendTrailers({ "grpc-status": schema ? "0" : "12" }));
    stream.end(Buffer.concat([envelope, payload]));
  });
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

function checkUrl(value, currentUrl, basePath, label) {
  if (!value || value.startsWith("#")) return undefined;
  const url = new URL(value.replaceAll("&amp;", "&"), currentUrl);
  if (!["http:", "https:"].includes(url.protocol)) return undefined;
  if (url.origin !== new URL(currentUrl).origin && url.origin !== "https://auth.example.test") return undefined;
  assert.ok(!basePath || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`), `${label}: escaped BASE_PATH=${basePath}: ${value}`);
  assert.ok(!basePath || !url.pathname.startsWith(`${basePath}${basePath}/`), `${label}: duplicated BASE_PATH: ${value}`);
  return url;
}

const manifest = JSON.parse(readFileSync(".next/app-path-routes-manifest.json", "utf8"));
const routes = [...new Set(Object.values(manifest).filter(path => !path.startsWith("/_")))];
const actions = Object.entries(JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node)
  .filter(([, action]) => ["logout", "resumeAccountAuthentication"].includes(action.exportedName));
const originalManifests = new Map(readdirSync(".next/server/app", { recursive: true })
  .filter(path => path.endsWith("_client-reference-manifest.js"))
  .map(path => { const file = join(".next/server/app", path); return [file, readFileSync(file, "utf8")]; }));

async function checkDeployment(basePath, apiPort) {
  const reservation = createTcpServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["scripts/runtime-start.mjs"], {
    env: {
      ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PORT: String(port), HOSTNAME: "127.0.0.1",
      BASE_PATH: basePath || "/", APP_URL: "https://auth.example.test", SITE_NICKNAME: "Base path fixture", SITE_ICON: "",
      ZITADEL_API_URL: `http://127.0.0.1:${apiPort}`, ZITADEL_EXTERNALDOMAIN: "auth.example.test",
      ZITADEL_SERVICE_TOKEN: "local-fixture-token", ZITADEL_SERVICE_USER_TOKEN_FILE: "", CUSTOM_REQUEST_HEADERS: "",
      ZITADEL_ORGANIZATION_ID: "", ZITADEL_SKIP_CONSENT_PROJECT_IDS: "", SESSION_SECRET: fixtureSecret,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log = (log + chunk).slice(-16000); });
  const fetchLocal = (url, options = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...options });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = (await fetchLocal(`${origin}${basePath}/api/health`)).ok; } catch { /* Wait for startup. */ }
      if (ready || child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Production server did not start:\n${log}`);
    const resources = new Map();
    for (const route of [...routes, "/base-path-contract-missing-page"]) {
      for (const query of route.startsWith("/api/") ? [""] : ["", "?authRequest=V2_contract"]) {
        const url = `${origin}${basePath}${route}${query}`;
        const response = await fetchLocal(url);
        assert.ok(response.status < 500, `${url}: status ${response.status}\n${log}`);
        const location = response.headers.get("location");
        if (location) checkUrl(location, url, basePath, `${route} HTTP redirect`);
        const html = await response.text();
        if (!response.headers.get("content-type")?.includes("text/html")) continue;
        if (route === "/login") assert.match(html, /<input\b[^>]*name="loginName"/, "Check the real login form, not an upstream-error placeholder");
        for (const match of html.matchAll(/\b(href|src|action|poster)=["']([^"']*)["']/gi)) {
          const target = checkUrl(match[2], url, basePath, `${route} ${match[1]}`);
          if (target && /\/_next\//.test(target.pathname)) resources.set(target.href, target);
        }
        for (const match of html.matchAll(/content="[^"\n]*?url=([^"\n]+)"/gi)) checkUrl(match[1], url, basePath, `${route} refresh redirect`);
      }
    }
    // Render the real authenticated portal and exercise its actual SDK adapter;
    // no test-only application route and no real credentials are involved.
    const jwt = await new EncryptJWT({ sessionId: "fixture-session", sessionToken: "fixture-user-session-token", userId: "fixture-user" })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuer("https://auth.example.test")
      .setAudience("wyid:authenticated-session").setIssuedAt().setExpirationTime("5m")
      .encrypt(createHash("sha256").update(fixtureSecret).digest());
    const accountHeaders = { Cookie: `__Host-wyid-session=${jwt}` };
    for (const route of ["/account/apps", "/account/apps/new", "/account/apps/fixture-project:fixture-app", "/account/settings/profile", "/account/settings/security", "/account/settings/devices", "/account/help"]) {
      const url = `${origin}${basePath}${route}`;
      const response = await fetchLocal(url, { headers: accountHeaders });
      assert.equal(response.status, 200, `${route}: authenticated portal failed\n${log}`);
      const html = await response.text();
      assert.ok(html.includes("Portal Fixture"), `${route}: missing authenticated account\n${log}`);
      assert.ok(!html.includes("fixture-user-session-token"), `${route}: leaked a native credential`);
      for (const match of html.matchAll(/\b(href|src|action)=["']([^"']*)["']/gi)) {
        const target = checkUrl(match[2], url, basePath, `${route} authenticated ${match[1]}`);
        if (target && /\/_next\//.test(target.pathname)) resources.set(target.href, target);
      }
    }
    for (const [route, field] of [["/me", "account"], ["/me/methods", "methods"], ["/me/sessions", "devices"], ["/apps", "applications"], ["/apps/fixture-project:fixture-app", "application"]]) {
      const response = await fetchLocal(`${origin}${basePath}/api/account${route}`, { headers: accountHeaders });
      assert.equal(response.status, 200, `${route}: authenticated API failed\n${log}`);
      const data = await response.json();
      assert.ok(Object.hasOwn(data, field), `${route}: missing ${field}`);
      assert.ok(!JSON.stringify(data).includes("fixture-user-session-token"), `${route}: leaked a native credential`);
    }
    const update = await fetchLocal(`${origin}${basePath}/api/account/me`, { method: "PATCH", headers: { ...accountHeaders, Origin: "https://auth.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Portal Fixture", preferredLanguage: "en" }) });
    assert.equal(update.status, 200, `Profile self-service mutation failed\n${log}`);
    await update.arrayBuffer();
    assert.ok(userRpcHeaders.some(h => h[":path"].endsWith("/ListApps") && h.authorization === "Bearer fixture-user-session-token"), "Application reads must use the user's native session token");
    assert.ok(userRpcHeaders.some(h => h[":path"].endsWith("/UpdateHumanUser") && h.authorization === "Bearer fixture-user-session-token"), "Profile writes must use the user's native session token");
    for (const [url] of resources) {
      const response = await fetchLocal(url);
      assert.equal(response.status, 200, `Static resource failed: ${url}`);
      if (response.headers.get("content-type")?.includes("text/css")) {
        for (const match of (await response.text()).matchAll(/url\(["']?([^\s)"']+)["']?\)/g)) {
          const target = checkUrl(match[1], url, basePath, "CSS resource");
          if (target && !resources.has(target.href)) resources.set(target.href, target);
        }
      } else {
        await response.arrayBuffer();
      }
    }
    // Check both normal form posts and JavaScript Server Action redirects.
    for (const [id, action] of actions) {
      const url = `${origin}${basePath}/login`;
      const form = new FormData();
      form.set(`$ACTION_ID_${id}`, "");
      const response = await fetchLocal(url, { method: "POST", headers: { Origin: origin }, body: form });
      assert.equal(response.status, 303, `${action.exportedName}: expected a form redirect`);
      assert.ok(response.headers.get("location"), `${action.exportedName}: missing form redirect`);
      checkUrl(response.headers.get("location"), url, basePath, `${action.exportedName} form redirect`);
      await response.arrayBuffer();
      const result = await fetchLocal(url, { method: "POST", headers: { Origin: origin, "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8" }, body: "[]" });
      const target = result.headers.get("x-action-redirect")?.split(";")[0];
      assert.ok(target, `${action.exportedName}: missing Server Action redirect`);
      checkUrl(target, url, basePath, `${action.exportedName} Server Action redirect`);
      await result.arrayBuffer();
    }
    checkChunkLoader(basePath);
    console.log(`PASS BASE_PATH=${basePath || "/"}: ${routes.length} routes, links, forms, redirects, ${resources.size} assets, CSS URLs, lazy chunks`);
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  }
}

try {
  const apiPort = await listen(upstream);
  for (const basePath of ["", "/123", "/account/login-ui"]) await checkDeployment(basePath, apiPort);
  assert.equal(unexpectedRpc.size, 0, `Unhandled fixture RPCs: ${[...unexpectedRpc].join(", ")}`);
} finally {
  for (const [file, content] of originalManifests) writeFileSync(file, content);
  for (const session of sessions) session.destroy();
  if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
}
