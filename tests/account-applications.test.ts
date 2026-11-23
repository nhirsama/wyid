import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { AppSchema, AppState, OIDCAppType, OIDCAuthMethodType } from "@zitadel/proto/zitadel/app_pb.js";
import { MembershipSchema } from "@zitadel/proto/zitadel/user_pb.js";
import { identityFixture } from "./fixtures/account";

const mocks = vi.hoisted(() => ({
  userClients: vi.fn(), serviceClients: vi.fn(),
  user: { listApps: vi.fn(), getAppByID: vi.fn(), addOIDCApp: vi.fn(), updateOIDCAppConfig: vi.fn(), updateApp: vi.fn(), reactivateApp: vi.fn(), deactivateApp: vi.fn(), regenerateOIDCClientSecret: vi.fn(), removeApp: vi.fn() },
  bootstrap: { listUserMemberships: vi.fn(), addProject: vi.fn(), addProjectMember: vi.fn() },
}));
vi.mock("@/server/zitadel/sdk", () => ({ getUserClients: mocks.userClients, getOrganizationClients: mocks.serviceClients }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com" }) }));
import { Applications, appConfig, applicationIds } from "@/server/account/applications";
import { applicationSchema } from "@/server/account/validation";

const input = { name: "My website", type: "spa" as const, devMode: false, website: "https://site.example.com", redirectUris: ["https://site.example.com/callback"], postLogoutRedirectUris: [] };
const membership = (projectId = "project", roles = ["PROJECT_OWNER"], org = "org", userId = "user") => create(MembershipSchema, { userId, details: { resourceOwner: org }, roles, type: { case: "projectId", value: projectId } });
const app = (type = OIDCAppType.OIDC_APP_TYPE_USER_AGENT, devMode = false) => create(AppSchema, { id: "app", name: input.name, state: AppState.ACTIVE, config: { case: "oidcConfig", value: { clientId: "client", devMode, redirectUris: input.redirectUris, additionalOrigins: [input.website], appType: type } } });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BASE_PATH", "/nested/login");
  mocks.userClients.mockReturnValue({ management: mocks.user });
  mocks.serviceClients.mockReturnValue({ management: mocks.bootstrap });
  mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [membership()] });
  mocks.user.getAppByID.mockResolvedValue({ app: app() });
  mocks.user.listApps.mockResolvedValue({ result: [app()] });
  mocks.user.addOIDCApp.mockResolvedValue({ appId: "new-app", clientId: "new-client", clientSecret: "one-time-secret" });
});

describe("native application ownership", () => {
  it("uses the user's token and organization for app reads", async () => {
    const applications = await new Applications(identityFixture()).list();
    expect(applications[0]).toMatchObject({ id: "project:app", clientId: "client", website: input.website, enabled: true });
    expect(mocks.userClients).toHaveBeenCalledWith("user-session-token", "org");
    expect(mocks.user.listApps).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project" }));
  });
  it("excludes foreign organizations, other users and project grants", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [membership(), membership("foreign", [], "other"), membership("someone", [], "org", "someone"), create(MembershipSchema, { userId: "user", details: { resourceOwner: "org" }, type: { case: "projectGrantId", value: "grant" } })] });
    await new Applications(identityFixture()).list();
    expect(mocks.user.listApps).toHaveBeenCalledTimes(1);
  });
  it.each(["get", "remove", "rotate"] as const)("rejects unrelated native IDs for %s", async operation => {
    await expect(new Applications(identityFixture())[operation]("foreign:app")).rejects.toMatchObject({ status: 404 });
    expect(mocks.user.getAppByID).not.toHaveBeenCalled();
    expect(mocks.user.removeApp).not.toHaveBeenCalled();
  });
  it("does not escalate read-only membership to service-account mutation", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [membership("project", ["PROJECT_VIEWER"])] });
    mocks.user.removeApp.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));
    await expect(new Applications(identityFixture()).remove("project:app")).rejects.toMatchObject({ code: Code.PermissionDenied });
    expect(mocks.bootstrap.addProjectMember).not.toHaveBeenCalled();
  });
  it("creates an app in a confirmed owner project and returns its secret once", async () => {
    const result = await new Applications(identityFixture()).create(input);
    expect(result).toMatchObject({ clientSecret: "one-time-secret", application: { id: "project:new-app", clientId: "new-client" } });
    expect(mocks.bootstrap.addProject).not.toHaveBeenCalled();
    expect(mocks.user.getAppByID).not.toHaveBeenCalled();
  });
  it("reuses an existing project with PROJECT_OWNER_GLOBAL membership instead of bootstrapping", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [membership("public-project", ["PROJECT_OWNER_GLOBAL"])] });
    const result = await new Applications(identityFixture()).create(input);
    expect(result.application.id).toBe("public-project:new-app");
    expect(mocks.user.addOIDCApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "public-project" }));
    expect(mocks.bootstrap.addProject).not.toHaveBeenCalled();
    expect(mocks.bootstrap.addProjectMember).not.toHaveBeenCalled();
  });
  it("keeps preferring an existing PROJECT_OWNER project over a PROJECT_OWNER_GLOBAL project", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [membership("a-global", ["PROJECT_OWNER_GLOBAL"]), membership("z-owner")] });
    const result = await new Applications(identityFixture()).create(input);
    expect(result.application.id).toBe("z-owner:new-app");
    expect(mocks.bootstrap.addProject).not.toHaveBeenCalled();
  });
  it("does not select a global viewer or a global owner membership from another organization", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [membership("viewer", ["PROJECT_OWNER_VIEWER_GLOBAL"]), membership("other-project", ["PROJECT_OWNER_GLOBAL"], "other-org")] });
    mocks.bootstrap.addProject.mockResolvedValue({ id: "new-project" });
    const result = await new Applications(identityFixture()).create(input);
    expect(result.application.id).toBe("new-project:new-app");
  });
  it("bootstraps a per-user native project with PROJECT_OWNER membership", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValue({ result: [] });
    mocks.bootstrap.addProject.mockResolvedValue({ id: "new-project" });
    await new Applications(identityFixture()).create(input);
    expect(mocks.bootstrap.addProject).toHaveBeenCalledWith(expect.objectContaining({ name: "wyid - user" }));
    expect(mocks.bootstrap.addProjectMember).toHaveBeenCalledWith({ projectId: "new-project", userId: "user", roles: ["PROJECT_OWNER"] });
    expect(mocks.user.addOIDCApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "new-project" }));
  });
  it("only recovers a concurrent create through confirmed membership, not a name match", async () => {
    mocks.bootstrap.listUserMemberships.mockResolvedValueOnce({ result: [] }).mockResolvedValue({ result: [membership()] });
    mocks.bootstrap.addProject.mockRejectedValue(new ConnectError("exists", Code.AlreadyExists));
    await new Applications(identityFixture()).create(input);
    expect(mocks.bootstrap.addProjectMember).not.toHaveBeenCalled();
  });
  it("does not switch the type or issue a secret for a public SPA", async () => {
    await expect(new Applications(identityFixture()).update("project:app", { ...input, type: "web" })).rejects.toMatchObject({ code: "application_type_changed" });
    await expect(new Applications(identityFixture()).rotate("project:app")).rejects.toMatchObject({ code: "public_client" });
    expect(mocks.user.regenerateOIDCClientSecret).not.toHaveBeenCalled();
  });
});
describe("OIDC configuration and validation", () => {
  it("sets the runtime login URI, code flow, PKCE-compatible SPA and web auth, and explicit devMode", () => {
    expect(appConfig(input)).toMatchObject({ authMethodType: OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_NONE, devMode: false, loginVersion: { version: { case: "loginV2", value: { baseUri: "https://login.example.com/nested/login/" } } } });
    expect(appConfig({ ...input, type: "web", devMode: true, website: "http://localhost:4000" })).toMatchObject({ authMethodType: OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_BASIC, devMode: true });
    expect(appConfig({ ...input, devMode: true })).toMatchObject({ devMode: true });
  });
  it("exposes devMode from ZITADEL OIDCConfig", async () => {
    mocks.user.listApps.mockResolvedValue({ result: [app(OIDCAppType.OIDC_APP_TYPE_USER_AGENT, true)] });
    const applications = await new Applications(identityFixture()).list();
    expect(applications[0]).toMatchObject({ devMode: true });
  });
  it.each([
    "http://example.com/cb",
    "http://localhost:3000/cb",
    "http://127.0.0.1/cb",
    "https://u:p@site.example/cb",
    "https://site.example/cb#fragment",
    "javascript:alert(1)",
    "https://site.example/\ncb",
  ])("rejects HTTP and unsafe callbacks when devMode is disabled: %s", uri => {
    expect(applicationSchema.safeParse({ ...input, devMode: false, redirectUris: [uri] }).success).toBe(false);
  });
  it("rejects website URLs with extra paths or query strings, and duplicate redirect URIs", () => {
    expect(applicationSchema.safeParse({ ...input, website: "https://site.example.com/app" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...input, website: "https://site.example.com/?a=1" }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...input, website: "https://site.example.com/" }).success).toBe(true);
    expect(applicationSchema.safeParse({ ...input, redirectUris: ["https://site.example.com/cb", "https://site.example.com/cb"] }).success).toBe(false);
  });
  it.each([
    "http://localhost:3000/cb",
    "http://127.0.0.1/cb",
    "http://[::1]/cb",
    "http://192.168.1.20:5173/cb",
    "http://dev.internal:8080/cb",
    "https://site.example/cb?flow=1",
  ])("accepts HTTP and HTTPS callback paths when devMode is enabled: %s", uri => {
    expect(applicationSchema.safeParse({ ...input, devMode: true, website: "http://192.168.1.20:5173", redirectUris: [uri] }).success).toBe(true);
  });
  it.each([
    "ftp://localhost/cb",
    "javascript:alert(1)",
    "http://u:p@localhost/cb",
    "http://localhost/cb#fragment",
    "http://localhost/\ncb",
  ])("still rejects unsafe callbacks even when devMode is enabled: %s", uri => {
    expect(applicationSchema.safeParse({ ...input, devMode: true, redirectUris: [uri] }).success).toBe(false);
  });
  it.each(["project", "project:app:extra", "../project:app", "project:app%2fother"])("rejects invalid IDs: %s", id => { expect(() => applicationIds(id)).toThrow(); });
});
