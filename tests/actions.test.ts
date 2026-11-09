import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(), authRequest: vi.fn(), canSkipConsent: vi.fn(), organizationForAuth: vi.fn(), organizationForUser: vi.fn(), policy: vi.fn(),
  createSession: vi.fn(), callback: vi.fn(), deny: vi.fn(), session: vi.fn(), methods: vi.fn(), verifyFactor: vi.fn(), challenge: vi.fn(),
  writeAuthenticatedSession: vi.fn(), clearAuthenticatedSession: vi.fn(), deleteSession: vi.fn(),
  register: vi.fn(), findUser: vi.fn(), requestPasswordReset: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn(),
  startIdp: vi.fn(), retrieveIdp: vi.fn(), registerIdpUser: vi.fn(),
  writePendingSession: vi.fn(), readPendingSession: vi.fn(), clearPendingSession: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getConfig: mocks.config, ConfigurationError: class ConfigurationError extends Error {} }));
vi.mock("@/server/session", () => ({ writePendingSession: mocks.writePendingSession, readPendingSession: mocks.readPendingSession, clearPendingSession: mocks.clearPendingSession, writeAuthenticatedSession: mocks.writeAuthenticatedSession, clearAuthenticatedSession: mocks.clearAuthenticatedSession, readAuthenticatedSession: vi.fn() }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: {
  authRequest: mocks.authRequest, canSkipConsent: mocks.canSkipConsent, organizationForAuth: mocks.organizationForAuth, organizationForUser: mocks.organizationForUser,
  policy: mocks.policy, createSession: mocks.createSession, callback: mocks.callback, deny: mocks.deny, session: mocks.session, methods: mocks.methods, deleteSession: mocks.deleteSession,
  verifyFactor: mocks.verifyFactor, challenge: mocks.challenge, register: mocks.register, findUser: mocks.findUser,
  requestPasswordReset: mocks.requestPasswordReset, resetPassword: mocks.resetPassword, verifyEmail: mocks.verifyEmail,
  startIdp: mocks.startIdp, retrieveIdp: mocks.retrieveIdp, registerIdpUser: mocks.registerIdpUser,
} }));
import { chooseIdentityProvider, completeIdentityProvider, confirmIdentityProviderRegistration, decideConsent, login, register, requestPasswordReset, resetPassword, verifyEmail, verifyFactor } from "@/server/actions";
import { consentToken } from "@/server/consent";

const credentials = { loginName: "cat@example.com", password: "test-password" };
const context = { authRequestId: "V2_test" };
const policy = { password: true, registration: true, passwordReset: true, passkey: true, forceMfa: false, forceMfaLocalOnly: false, factors: ["totp" as const], userVerifiedKey: false, passwordPolicy: { minLength: 8, uppercase: false, lowercase: true, number: false, symbol: false }, identityProviders: [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ appUrl: "https://login.example.com", organizationId: "org-id", sessionSecret: "a-test-session-secret-that-is-at-least-32-chars" });
  mocks.organizationForAuth.mockResolvedValue("org-id");
  mocks.authRequest.mockResolvedValue({ id: "V2_test", clientId: "client-id", redirectUri: "https://app.example.com/callback", scope: ["openid", "profile"], prompt: [] });
  mocks.canSkipConsent.mockResolvedValue(true);
  mocks.policy.mockResolvedValue(policy);
  mocks.organizationForUser.mockResolvedValue("org-id");
  mocks.createSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "session-token" });
  mocks.callback.mockResolvedValue("https://app.example.com/callback?code=opaque");
  mocks.startIdp.mockResolvedValue({ nextStep: { case: "authUrl", value: "https://provider.example.com/authorize" } });
  mocks.retrieveIdp.mockResolvedValue({ userId: "", addHumanUser: { profile: { displayName: "New Account" } } });
  mocks.registerIdpUser.mockResolvedValue({ userId: "new-user" });
  mocks.session.mockResolvedValue({ factors: { user: { id: "user-id" } } });
  mocks.methods.mockResolvedValue(["totp"]);
});
describe("ZITADEL server actions", () => {
  it("allows direct account login without an OIDC authorization request", async () => {
    const result = await login(credentials, {});
    expect(result).toEqual({ ok: true, redirect: "/account" });
    expect(mocks.createSession).toHaveBeenCalled();
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.writeAuthenticatedSession).toHaveBeenCalledWith({ sessionId: "session-id", sessionToken: "session-token", userId: "user-id" });
  });
  it("returns login_required for a silent OIDC request instead of prompting", async () => {
    mocks.authRequest.mockResolvedValue({ id: "V2_test", scope: [], prompt: [1] });
    mocks.deny.mockResolvedValue("https://app.example.com/callback?error=login_required");
    const result = await login(credentials, context);
    expect(result).toEqual({ ok: true, redirect: "https://app.example.com/callback?error=login_required" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("validates credentials and creates an upstream password session", async () => {
    expect((await login({ ...credentials, password: "" }, context)).ok).toBe(false);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect((await login(credentials, context)).ok).toBe(true);
    expect(mocks.createSession).toHaveBeenCalledWith({ user: { search: { case: "loginName", value: credentials.loginName } }, password: { password: credentials.password } }, undefined, 600);
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: "session-id", sessionToken: "session-token" });
  });
  it("shows an OAuth confirmation screen unless the registered app is allowlisted", async () => {
    mocks.canSkipConsent.mockResolvedValue(false);
    const result = await login(credentials, context);
    expect(result).toEqual({ ok: true, redirect: "/consent?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", methods: [], userId: "user-id" }));
    expect(mocks.callback).not.toHaveBeenCalled();
  });
  it("honors explicit prompt=consent even when the app belongs to an exempt project", async () => {
    mocks.authRequest.mockResolvedValue({ id: "V2_test", clientId: "client-id", redirectUri: "https://app.example.com/callback", scope: ["openid"], prompt: [3] });
    const result = await login(credentials, context);
    expect(result).toEqual({ ok: true, redirect: "/consent?authRequest=V2_test" });
    expect(mocks.canSkipConsent).not.toHaveBeenCalled();
  });
  it("uses a request- and session-bound confirmation token before calling the OIDC callback", async () => {
    const pending = { authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", methods: [], userId: "user-id" };
    const request = { id: "V2_test", clientId: "client-id", redirectUri: "https://app.example.com/callback", scope: ["openid", "profile"], prompt: [] };
    mocks.readPendingSession.mockResolvedValue(pending);
    const result = await decideConsent({ authRequestId: "V2_test", consentToken: consentToken(request as never, pending, mocks.config().sessionSecret), allow: true });
    expect(result).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: "session-id", sessionToken: "session-token" });
    expect(mocks.clearPendingSession).toHaveBeenCalled();
  });
  it("rejects a stale or altered OAuth confirmation without consuming the request", async () => {
    const pending = { authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", methods: [], userId: "user-id" };
    mocks.readPendingSession.mockResolvedValue(pending);
    const result = await decideConsent({ authRequestId: "V2_test", consentToken: "A".repeat(43), allow: true });
    expect(result.ok).toBe(false);
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.deny).not.toHaveBeenCalled();
  });
  it("rechecks MFA policy when the user confirms OAuth access", async () => {
    const pending = { authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", methods: [], userId: "user-id" };
    const request = { id: "V2_test", clientId: "client-id", redirectUri: "https://app.example.com/callback", scope: ["openid"], prompt: [] };
    mocks.readPendingSession.mockResolvedValue(pending);
    mocks.authRequest.mockResolvedValue(request);
    mocks.policy.mockResolvedValue({ ...policy, forceMfa: true });
    const result = await decideConsent({ authRequestId: "V2_test", consentToken: consentToken(request as never, pending, mocks.config().sessionSecret), allow: true });
    expect(result).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ methods: ["totp"], userId: "user-id" }));
    expect(mocks.callback).not.toHaveBeenCalled();
  });
  it("retains a session only when ZITADEL explicitly requests another factor", async () => {
    mocks.callback.mockRejectedValueOnce({ code: 9 });
    const result = await login(credentials, context);
    expect(result).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenCalledWith({ authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", methods: ["totp"], userId: "user-id" });
  });
  it("binds an MFA verification to the encrypted session and rotates the Session Token", async () => {
    mocks.readPendingSession.mockResolvedValue({ authRequestId: "V2_test", sessionId: "session-id", sessionToken: "old-token", methods: ["totp"], userId: "user-id" });
    mocks.verifyFactor.mockResolvedValue({ sessionId: "session-id", sessionToken: "new-token" });
    expect((await verifyFactor({ method: "totp", code: "001234" }, context)).ok).toBe(true);
    expect(mocks.verifyFactor).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "old-token" }), "totp", "001234");
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: "session-id", sessionToken: "new-token" });
  });
  it("does not invoke account APIs for invalid registration or password-reset inputs", async () => {
    expect((await register({ email: "invalid" }, context)).ok).toBe(false);
    expect((await requestPasswordReset({ loginName: "" }, context)).ok).toBe(false);
    expect((await resetPassword({ password: "short", confirmPassword: "different", code: "" }, { userId: "user-id" })).ok).toBe(false);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });
  it("creates accounts and requests reset without confirming whether an account exists", async () => {
    mocks.register.mockResolvedValue("user-id");
    const registered = await register({ givenName: "猫", familyName: "同学", nickName: "猫猫", email: "cat@example.com", password: "longpassword", confirmPassword: "longpassword" }, context);
    expect(registered.ok).toBe(true);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ email: "cat@example.com" }), "org-id", "V2_test");
    mocks.findUser.mockResolvedValue(undefined);
    const reset = await requestPasswordReset({ loginName: "cat@example.com" }, context);
    expect(reset).toEqual({ ok: true, message: "如果账号存在且邮箱已验证，重置邮件将很快送达。" });
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });
  it("starts an enabled identity provider using a server-generated state", async () => {
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ id: "idp", name: "Example IDP", creationAllowed: true, autoCreation: false }] });
    const result = await chooseIdentityProvider({ id: "idp" }, context);
    expect(result).toEqual({ ok: true, redirect: "https://provider.example.com/authorize" });
    expect(mocks.startIdp).toHaveBeenCalledWith("idp", expect.any(String));
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ idpCreationAllowed: true, idpAutoCreation: false }));
  });
  it("requires explicit account creation confirmation when an IDP does not auto-create accounts", async () => {
    const state = "00000000-0000-4000-8000-000000000000";
    mocks.readPendingSession.mockResolvedValue({ authRequestId: "V2_test", sessionId: "", sessionToken: "", methods: [], userId: "", idpState: state, idpCreationAllowed: true, idpAutoCreation: false });
    const result = await completeIdentityProvider({ idpIntentId: "intent-id", idpIntentToken: "intent-token", state });
    expect(result).toEqual({ ok: true, redirect: `/idp/confirm?state=${state}` });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ idpIntentId: "intent-id", idpIntentToken: "intent-token", idpNewUser: expect.any(Object) }));
    mocks.readPendingSession.mockResolvedValue({ authRequestId: "V2_test", sessionId: "", sessionToken: "", methods: [], userId: "", idpState: state, idpCreationAllowed: true, idpIntentId: "intent-id", idpIntentToken: "intent-token", idpNewUser: { profile: { displayName: "New Account" } } });
    const confirmed = await confirmIdentityProviderRegistration({ state });
    expect(confirmed.ok).toBe(true);
    expect(mocks.registerIdpUser).toHaveBeenCalledWith({ profile: { displayName: "New Account" } });
    expect(mocks.createSession).toHaveBeenCalledWith({ user: { search: { case: "userId", value: "new-user" } }, idpIntent: { idpIntentId: "intent-id", idpIntentToken: "intent-token" } });
  });
  it("verifies email only with an explicit code and user identifier", async () => {
    expect((await verifyEmail({ code: "123456" }, {})).ok).toBe(false);
    expect(mocks.verifyEmail).not.toHaveBeenCalled();
    mocks.verifyEmail.mockResolvedValue(undefined);
    expect((await verifyEmail({ code: "123456" }, { userId: "user-id" })).ok).toBe(true);
  });
});
