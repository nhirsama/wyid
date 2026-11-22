import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@zitadel/proto/zitadel/message_pb.js";
import { identityFixture } from "./fixtures/account";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), profile: vi.fn(), upload: vi.fn(), devices: vi.fn(), revoke: vi.fn(), check: vi.fn(), methods: vi.fn(), clearSession: vi.fn(), clearGrant: vi.fn(), clearPending: vi.fn(), readSession: vi.fn(), deleteSession: vi.fn() }));
const rpc = vi.hoisted(() => ({ listUserMemberships: vi.fn(), addProject: vi.fn(), addProjectMember: vi.fn(), addOIDCApp: vi.fn(), listApps: vi.fn() }));
vi.mock("@/server/account/identity", async importOriginal => ({ ...await importOriginal<typeof import("@/server/account/identity")>(), accountIdentity: mocks.identity }));
vi.mock("@/server/config", async importOriginal => ({ ...await importOriginal<typeof import("@/server/config")>(), getConfig: () => ({ appUrl: "https://login.example.com" }) }));
vi.mock("@/server/account/profile", () => ({ updateProfile: mocks.profile, updateEmail: vi.fn(), updatePassword: vi.fn(), uploadAvatar: mocks.upload, removeAvatar: vi.fn() }));
vi.mock("@/server/account/devices", () => ({ devices: mocks.devices, revokeDevice: mocks.revoke }));
vi.mock("@/server/account/factors", () => ({ authenticationMethods: mocks.methods, checkFactor: mocks.check, sendCheck: vi.fn(), finishKey: vi.fn(), startKey: vi.fn(), startTotp: vi.fn(), confirmTotp: vi.fn(), addOtp: vi.fn(), startPhone: vi.fn(), confirmPhone: vi.fn(), removeFactor: vi.fn() }));
vi.mock("@/server/session", () => ({ clearAuthenticatedSession: mocks.clearSession, clearAccountGrant: mocks.clearGrant, clearPendingSession: mocks.clearPending, readAuthenticatedSession: mocks.readSession }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: { deleteSession: mocks.deleteSession } }));
vi.mock("@/server/zitadel/sdk", () => ({
  getOrganizationClients: () => ({ management: { listUserMemberships: rpc.listUserMemberships, addProject: rpc.addProject, addProjectMember: rpc.addProjectMember } }),
  getUserClients: () => ({ management: { addOIDCApp: rpc.addOIDCApp, listApps: rpc.listApps } }),
}));
import { AccountError } from "@/server/account/errors";
import { handleAccountRequest, readAccountBody } from "@/server/account/handler";
const origin = "https://login.example.com";
function request(path: string, method = "GET", body?: unknown, headers?: Record<string, string>) {
  return new Request(`${origin}/api/account${path}`, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }), headers: { Origin: origin, "Content-Type": "application/json", ...headers } });
}
const handle = (path: string, method = "GET", body?: unknown, headers?: Record<string, string>) => handleAccountRequest(request(path, method, body, headers), path.slice(1).split("/"));
beforeEach(() => { vi.resetAllMocks(); mocks.identity.mockResolvedValue(identityFixture()); });
afterEach(() => vi.restoreAllMocks());
describe("account HTTP boundary", () => {
  it("serves only live inspected human account data and never returns server credentials", async () => {
    const response = await handle("/me");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: { id: "user", displayName: "Test User" } });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.identity).toHaveBeenCalledTimes(1);
  });
  it.each(["https://attacker.example", "null", ""])("rejects a mutation with Origin %s", async foreign => {
    const response = await handle("/me", "PATCH", {}, { Origin: foreign });
    expect(response.status).toBe(403); expect(mocks.identity).not.toHaveBeenCalled();
  });
  it("rejects cross-site GETs and non-JSON mutation bodies", async () => {
    expect((await handle("/me", "GET", undefined, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await handle("/me", "PATCH", {}, { "Content-Type": "text/plain" })).status).toBe(415);
  });
  it("does not let incomplete authentication read settings or apps", async () => {
    mocks.identity.mockRejectedValue(new AccountError(403, "authentication_incomplete", "继续验证"));
    for (const path of ["/me", "/me/methods", "/me/sessions", "/apps"]) expect((await handle(path)).status).toBe(403);
    expect(mocks.methods).not.toHaveBeenCalled(); expect(mocks.devices).not.toHaveBeenCalled();
  });
  it("delegates only the narrow check endpoint to the session-bound continuation", async () => {
    mocks.check.mockResolvedValue({ verified: true });
    const response = await handle("/me/methods/check", "POST", { code: "123456" });
    expect(response.status).toBe(200); expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.check).toHaveBeenCalledWith({ code: "123456" });
  });
  it("rejects malformed and excessive data before mutating ZITADEL", async () => {
    expect((await handle("/me", "PATCH", { displayName: "", preferredLanguage: "zh-CN" })).status).toBe(400);
    expect((await handle("/apps", "POST", {}, { "Content-Length": "131073" })).status).toBe(413);
    expect(mocks.profile).not.toHaveBeenCalled();
    await expect(readAccountBody(new Request(`${origin}/api/account/me`, { method: "PATCH", body: '{"invalid"' }))).rejects.toMatchObject({ code: "invalid_json" });
  });
  it.each([
    { method: "POST", stub: "listUserMemberships", name: "ListUserMemberships", actor: "service-account", code: Code.NotFound, status: 404 },
    { method: "POST", stub: "addProject", name: "AddProject", actor: "service-account", code: Code.PermissionDenied, status: 403 },
    { method: "POST", stub: "addProjectMember", name: "AddProjectMember", actor: "service-account", code: Code.NotFound, status: 404 },
    { method: "POST", stub: "addOIDCApp", name: "AddOIDCApp", actor: "user-session", code: Code.PermissionDenied, status: 403 },
    { method: "GET", stub: "listApps", name: "ListApps", actor: "user-session", code: Code.NotFound, status: 404 },
  ] as const)("logs the failing $name RPC without exposing upstream secrets", async ({ method, stub, name, actor, code, status }) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const upstreamSecret = "secret-in-upstream-message";
    const zitadelErrorId = "AUTHZ-cdgFk";
    rpc.listUserMemberships.mockResolvedValue({ result: method === "GET" ? [{ userId: "user", details: { resourceOwner: "org" }, roles: ["PROJECT_OWNER"], type: { case: "projectId", value: "project" } }] : [] });
    rpc.addProject.mockResolvedValue({ id: "project" });
    rpc.addProjectMember.mockResolvedValue({});
    rpc[stub].mockRejectedValue(new ConnectError(upstreamSecret, code, undefined, [
      { desc: ErrorDetailSchema, value: { id: "malformed error ID", message: upstreamSecret } },
      { desc: ErrorDetailSchema, value: { id: zitadelErrorId, message: upstreamSecret } },
    ]));
    const response = await handle("/apps", method, { name: "Site", type: "spa", website: "https://site.example.com", redirectUris: ["https://site.example.com/cb"], postLogoutRedirectUris: [] });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "request_failed", requestId: expect.any(String) } });
    expect(log).toHaveBeenCalledExactlyOnceWith("[auth] request failed", { requestId: body.error.requestId, code, rpc: name, actor, zitadelErrorId });
    expect(JSON.stringify([body, log.mock.calls])).not.toContain(upstreamSecret);
    expect(JSON.stringify(body)).not.toContain(zitadelErrorId);
  });
  it("applies the streaming bound even without Content-Length", async () => {
    const body = JSON.stringify({ payload: "x".repeat(128 * 1024) });
    await expect(readAccountBody(new Request(`${origin}/api/account/me`, { method: "PATCH", body }))).rejects.toMatchObject({ code: "request_too_large" });
  });
  it("clears credentials on logout even if upstream session deletion fails", async () => {
    mocks.readSession.mockResolvedValue(identityFixture().ref); mocks.deleteSession.mockRejectedValue(new Error("expired"));
    expect((await handle("/logout", "POST")).status).toBe(200);
    expect(mocks.clearSession).toHaveBeenCalled(); expect(mocks.clearGrant).toHaveBeenCalled(); expect(mocks.clearPending).toHaveBeenCalled();
  });
});
