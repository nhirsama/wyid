import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorDetailSchema } from "@zitadel/proto/zitadel/message_pb.js";
import { AuthRequestSchema, ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb.js";
import { FactorsSchema, SessionSchema } from "@zitadel/proto/zitadel/session/v2/session_pb.js";
import { HumanUserSchema, UserSchema } from "@zitadel/proto/zitadel/user/v2/user_pb.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext, LoginPolicy } from "@/lib/auth";
import type { PendingSession } from "@/server/session";

const mocks = vi.hoisted(() => ({
  config: vi.fn(), authRequest: vi.fn(), canSkipConsent: vi.fn(), organizationForAuth: vi.fn(), organizationForUser: vi.fn(), policy: vi.fn(),
  createSession: vi.fn(), callback: vi.fn(), deny: vi.fn(), session: vi.fn(), methods: vi.fn(), verifyFactor: vi.fn(), challenge: vi.fn(),
  user: vi.fn(), updateSession: vi.fn(), verifyWebAuthn: vi.fn(),
  enrollTotp: vi.fn(), confirmTotp: vi.fn(), enrollOtp: vi.fn(),
  setEnrollmentPhone: vi.fn(), verifyEnrollmentPhone: vi.fn(), changePassword: vi.fn(), sendEmailCode: vi.fn(),
  writeAuthenticatedSession: vi.fn(), readAuthenticatedSession: vi.fn(), clearAuthenticatedSession: vi.fn(), deleteSession: vi.fn(), redirect: vi.fn(),
  register: vi.fn(), findUser: vi.fn(), requestPasswordReset: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn(),
  startIdp: vi.fn(), retrieveIdp: vi.fn(), registerIdpUser: vi.fn(),
  writePendingSession: vi.fn(), readPendingSession: vi.fn(), clearPendingSession: vi.fn(),
  readPasskeyAccount: vi.fn(), writePasskeyAccount: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getConfig: mocks.config, ConfigurationError: class ConfigurationError extends Error {} }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/session", () => ({ writePendingSession: mocks.writePendingSession, readPendingSession: mocks.readPendingSession, clearPendingSession: mocks.clearPendingSession, writeAuthenticatedSession: mocks.writeAuthenticatedSession, clearAuthenticatedSession: mocks.clearAuthenticatedSession, readAuthenticatedSession: mocks.readAuthenticatedSession }));
vi.mock("@/server/passkey-account", () => ({ readPasskeyAccount: mocks.readPasskeyAccount, writePasskeyAccount: mocks.writePasskeyAccount }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: {
  authRequest: mocks.authRequest, canSkipConsent: mocks.canSkipConsent, organizationForAuth: mocks.organizationForAuth, organizationForUser: mocks.organizationForUser,
  policy: mocks.policy, createSession: mocks.createSession, callback: mocks.callback, deny: mocks.deny, session: mocks.session, methods: mocks.methods, deleteSession: mocks.deleteSession,
  verifyFactor: mocks.verifyFactor, challenge: mocks.challenge, register: mocks.register, findUser: mocks.findUser,
  user: mocks.user, updateSession: mocks.updateSession, verifyWebAuthn: mocks.verifyWebAuthn,
  enrollTotp: mocks.enrollTotp, confirmTotp: mocks.confirmTotp,
  enrollOtp: mocks.enrollOtp, setEnrollmentPhone: mocks.setEnrollmentPhone, verifyEnrollmentPhone: mocks.verifyEnrollmentPhone,
  changePassword: mocks.changePassword, sendEmailCode: mocks.sendEmailCode,
  requestPasswordReset: mocks.requestPasswordReset, resetPassword: mocks.resetPassword, verifyEmail: mocks.verifyEmail,
  startIdp: mocks.startIdp, retrieveIdp: mocks.retrieveIdp, registerIdpUser: mocks.registerIdpUser,
} }));
import {
  beginFactor, changeLoginPassword, chooseIdentityProvider, completeIdentityProvider, confirmIdentityProviderRegistration, decideConsent,
  enrollOtpFactor, finishPasskey, finishTotpEnrollment, finishWebAuthnFactor, login, register,
  logout, requestPasswordReset, resendLoginEmail, resetPassword, resumeAccountAuthentication, resumeAuthentication, resumeLogin,
  setEnrollmentPhone, startPasskey, startTotpEnrollment, verifyEmail, verifyEnrollmentPhone, verifyFactor, verifyLoginEmail,
} from "@/server/actions";
import { consentToken } from "@/server/consent";
import { inspectAuthentication } from "@/server/authentication";

const credentials = { loginName: "cat@example.com", password: "test-password" };
const registration = { username: "猫猫", email: "cat@example.com", password: "longpassword", confirmPassword: "longpassword" };
const context = { authRequestId: "V2_test" };
const policy: LoginPolicy = { password: true, registration: true, passwordReset: true, passkey: true, forceMfa: false, forceMfaLocalOnly: false, factors: ["totp"], userVerifiedKey: false, passwordPolicy: { minLength: 8, uppercase: false, lowercase: true, number: false, symbol: false }, identityProviders: [] };
const authorization = create(AuthRequestSchema, { id: "V2_test", clientId: "client-id", redirectUri: "https://app.example.com/callback", scope: ["openid", "profile"], prompt: [] });
const assertion = { id: "credential-id", type: "public-key", response: { clientDataJSON: "client-data", signature: "signature" } };
const idp = { id: "idp", name: "Example IDP", creationAllowed: true, autoCreation: false };
const idpBinding = { idpId: "idp", idpOrganizationId: "org-id" };
const idpInformation = { idpId: "idp" };
function callbackError(id: string, code = Code.FailedPrecondition) {
  return new ConnectError("translated upstream message", code, undefined, [{ desc: ErrorDetailSchema, value: { id } }]);
}

function verifiedAt(offsetMs = 0) {
  const milliseconds = Date.now() + offsetMs;
  return { seconds: BigInt(Math.floor(milliseconds / 1000)), nanos: (milliseconds % 1000) * 1_000_000 };
}
function nativeSession(factors: Omit<MessageInitShape<typeof FactorsSchema>, "$typeName"> = {}, userId = "user-id") {
  return create(SessionSchema, { id: "session-id", factors: { user: { id: userId }, password: { verifiedAt: verifiedAt() }, ...factors } });
}
function nativeUser(human: Omit<MessageInitShape<typeof HumanUserSchema>, "$typeName"> = {}, userId = "user-id") {
  return create(UserSchema, { userId, details: { resourceOwner: "org-id" }, type: { case: "human", value: { email: { email: "cat@example.com", isVerified: true }, passwordChangeRequired: false, ...human } } });
}
type TestPending = PendingSession & { factorVerified?: boolean };
function pendingSession(overrides: Partial<TestPending> = {}): TestPending {
  return { ...context, sessionId: "session-id", sessionToken: "old-token", userId: "user-id", methods: [], ...overrides };
}
function mockPendingSession(initial: TestPending) {
  let current: TestPending | null = initial;
  mocks.readPendingSession.mockImplementation(async () => current);
  mocks.writePendingSession.mockImplementation(async (pending: TestPending) => { current = { ...pending }; });
  mocks.clearPendingSession.mockImplementation(async () => { current = null; });
  return () => current;
}
function approveConsent(pending: PendingSession) {
  return decideConsent({ authRequestId: "V2_test", consentToken: consentToken(authorization, pending, mocks.config().sessionSecret), allow: true });
}
function expectNoAuthentication() {
  expect(mocks.callback).not.toHaveBeenCalled();
  expect(mocks.writeAuthenticatedSession).not.toHaveBeenCalled();
}
const entryPoints = ["direct", "OIDC", "consent"] as const;
async function enterGate(entry: typeof entryPoints[number]) {
  if (entry === "consent") {
    const pending = pendingSession();
    mockPendingSession(pending);
    return approveConsent(pending);
  }
  return login(credentials, entry === "direct" ? {} : context);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ appUrl: "https://login.example.com", organizationId: "org-id", sessionSecret: "a-test-session-secret-that-is-at-least-32-chars" });
  mocks.organizationForAuth.mockResolvedValue("org-id");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
  mocks.readAuthenticatedSession.mockResolvedValue(null);
  mocks.readPasskeyAccount.mockResolvedValue(null);
  mocks.authRequest.mockResolvedValue(authorization);
  mocks.canSkipConsent.mockResolvedValue(true);
  mocks.policy.mockResolvedValue(policy);
  mocks.organizationForUser.mockResolvedValue("org-id");
  mocks.createSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "session-token" });
  mocks.callback.mockResolvedValue("https://app.example.com/callback?code=opaque");
  mocks.startIdp.mockResolvedValue({ nextStep: { case: "authUrl", value: "https://provider.example.com/authorize" } });
  mocks.retrieveIdp.mockResolvedValue({ userId: "", idpInformation, addHumanUser: { profile: { displayName: "New Account" } } });
  mocks.registerIdpUser.mockResolvedValue({ userId: "new-user" });
  mocks.session.mockResolvedValue(nativeSession());
  mocks.user.mockResolvedValue(nativeUser());
  mocks.methods.mockResolvedValue([]);
  mocks.verifyFactor.mockResolvedValue({ sessionId: "session-id", sessionToken: "new-token" });
  mocks.verifyWebAuthn.mockResolvedValue({ sessionId: "session-id", sessionToken: "new-token" });
  mocks.updateSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "new-token" });
  mocks.challenge.mockResolvedValue({ sessionId: "session-id", sessionToken: "challenge-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: { challenge: "challenge" } } } });
  mocks.enrollTotp.mockResolvedValue({ secret: "totp-secret", uri: "otpauth://totp/Example:user?secret=totp-secret" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("reuse of live ZITADEL login sessions", () => {
  const remembered = { sessionId: "session-id", sessionToken: "remembered-token", userId: "user-id", mfaStartedAt: 1 };
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.readAuthenticatedSession.mockResolvedValue(remembered);
    mocks.session.mockResolvedValue(nativeSession());
  });

  it("reuses the native session for another authorization without checking a password or creating a session", async () => {
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ sessionId: remembered.sessionId, sessionToken: remembered.sessionToken }));
    expect(mocks.user).toHaveBeenCalledWith("user-id");
    expect(mocks.policy).toHaveBeenCalledWith("org-id");
    expect(mocks.methods).toHaveBeenCalledWith("user-id");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: remembered.sessionId, sessionToken: remembered.sessionToken });
    expect(mocks.writeAuthenticatedSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: remembered.sessionToken, userId: "user-id" }));
  });

  it("also reuses a completed login to open the account portal", async () => {
    expect(await resumeLogin({})).toEqual({ ok: true, redirect: "/account" });
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("remembers an OIDC login after callback and uses it for a subsequent request", async () => {
    expect((await login(credentials, context)).ok).toBe(true);
    const saved = mocks.writeAuthenticatedSession.mock.calls[0][0];
    mocks.readAuthenticatedSession.mockResolvedValue(saved);
    mocks.authRequest.mockResolvedValue({ ...authorization, id: "V2_next" });
    expect((await resumeLogin({ authRequestId: "V2_next" })).ok).toBe(true);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.callback).toHaveBeenLastCalledWith("V2_next", { sessionId: saved.sessionId, sessionToken: saved.sessionToken });
  });

  it.each([{ prompt: [] }, { prompt: [Prompt.CONSENT] }])("retains the original consent requirements for %j", async ({ prompt }) => {
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt });
    mocks.canSkipConsent.mockResolvedValue(false);
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/consent?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ authRequestId: "V2_test", userId: "user-id", sessionToken: remembered.sessionToken }));
    expect(mocks.writeAuthenticatedSession).toHaveBeenCalled();
    expect(mocks.callback).not.toHaveBeenCalled();
  });

  it("honors prompt=consent even for an exempt project", async () => {
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt: [Prompt.CONSENT] });
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/consent?authRequest=V2_test" });
    expect(mocks.canSkipConsent).not.toHaveBeenCalled();
    expect(mocks.callback).not.toHaveBeenCalled();
  });

  it.each([
    { prompt: [Prompt.LOGIN] }, { prompt: [Prompt.SELECT_ACCOUNT] }, { maxAge: { seconds: 0n, nanos: 0 } },
  ])("never reuses a session when a fresh login is requested (case %#)", async overrides => {
    mocks.authRequest.mockResolvedValue({ ...authorization, ...overrides });
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/login?authRequest=V2_test" });
    expect(mocks.clearAuthenticatedSession).toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each(["password policy", "max_age"])("requires login again after the %s deadline", async reason => {
    mocks.session.mockResolvedValue(nativeSession({ password: { verifiedAt: verifiedAt(-60_001) } }));
    if (reason === "password policy") mocks.policy.mockResolvedValue({ ...policy, passwordLifetimeMs: 60_000 });
    else mocks.authRequest.mockResolvedValue({ ...authorization, maxAge: { seconds: 60n, nanos: 0 } });
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/login?authRequest=V2_test" });
    expect(mocks.clearAuthenticatedSession).toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each(["expired", "revoked", "account changed", "no primary proof"])("does not reuse a session that is %s", async reason => {
    if (reason === "expired") mocks.session.mockResolvedValue({ ...nativeSession(), expirationDate: verifiedAt(-1) });
    if (reason === "revoked") mocks.session.mockRejectedValue({ code: 5 });
    if (reason === "account changed") mocks.session.mockResolvedValue(nativeSession({}, "different-user"));
    if (reason === "no primary proof") mocks.session.mockResolvedValue(nativeSession({ password: undefined }));
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/login?authRequest=V2_test" });
    expect(mocks.clearAuthenticatedSession).toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("does not convert a temporary ZITADEL outage into authentication or discard the stored credential", async () => {
    mocks.session.mockRejectedValue({ code: 14 });
    expect((await resumeLogin(context)).ok).toBe(false);
    expect(mocks.clearAuthenticatedSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("requests only the expired second factor without creating another password session", async () => {
    mocks.policy.mockResolvedValue({ ...policy, passwordLifetimeMs: 60_000, secondFactorLifetimeMs: 10_000 });
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockResolvedValue(nativeSession({ password: { verifiedAt: verifiedAt(-20_000) }, totp: { verifiedAt: verifiedAt(-10_001) } }));
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenLastCalledWith(expect.objectContaining({ methods: ["totp"], userId: "user-id", sessionToken: remembered.sessionToken }));
    expect(mocks.createSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each([0, 3_000])("requires new native proof for zero-lifetime MFA even with an old check %s ms ahead", async ahead => {
    const current = mockPendingSession(pendingSession());
    mocks.policy.mockResolvedValue({ ...policy, secondFactorLifetimeMs: 0 });
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockResolvedValue(nativeSession({ totp: { verifiedAt: verifiedAt(ahead) } }));
    const oldProofAt = Date.now() + ahead;
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(current()?.mfaStartedAt).toBeGreaterThan(oldProofAt);
    vi.advanceTimersByTime(ahead + 10);
    expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expectNoAuthentication();
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession({ totp: { verifiedAt: sessionToken === "new-token" ? verifiedAt() : verifiedAt(-10) } }));
    expect(await verifyFactor({ method: "totp", code: "123456" }, context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.writeAuthenticatedSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "new-token" }));
  });

  it("completes prompt=none silently only for an authenticated session and an exempt project", async () => {
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt: [Prompt.NONE] });
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.deny).not.toHaveBeenCalled();
    expect(mocks.writePendingSession).not.toHaveBeenCalled();
  });

  it.each([
    ["no session", ErrorReason.LOGIN_REQUIRED], ["consent needed", ErrorReason.CONSENT_REQUIRED],
    ["MFA needed", ErrorReason.INTERACTION_REQUIRED], ["application step-up", ErrorReason.INTERACTION_REQUIRED],
  ] as const)("returns the protocol error instead of an interactive page for silent auth with %s", async (reason, expected) => {
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt: [Prompt.NONE] });
    mocks.deny.mockResolvedValue("https://app.example.com/callback?error=required");
    if (reason === "no session") mocks.readAuthenticatedSession.mockResolvedValue(null);
    if (reason === "consent needed") mocks.canSkipConsent.mockResolvedValue(false);
    if (reason === "MFA needed") mocks.methods.mockResolvedValue(["totp"]);
    if (reason === "application step-up") mocks.callback.mockImplementation(async () => {
      mocks.policy.mockResolvedValue({ ...policy, forceMfa: true });
      throw { code: 9 };
    });
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?error=required" });
    expect(mocks.deny).toHaveBeenCalledWith("V2_test", expected);
    expect(mocks.writePendingSession).not.toHaveBeenCalled();
  });

  it("uses absolute native deadlines and does not extend them during reuse", async () => {
    const start = Date.now();
    mocks.policy.mockResolvedValue({ ...policy, passwordLifetimeMs: 60_000 });
    const session = { ...nativeSession(), expirationDate: verifiedAt(45_000) };
    mocks.session.mockResolvedValue(session);
    await resumeLogin({});
    expect(mocks.writeAuthenticatedSession).toHaveBeenLastCalledWith(expect.objectContaining({ expiresAt: start + 45_000 }));
    vi.advanceTimersByTime(10_000);
    await resumeLogin({});
    expect(mocks.writeAuthenticatedSession).toHaveBeenLastCalledWith(expect.objectContaining({ expiresAt: start + 45_000 }));
  });

  it("does not fail an already consumed callback if the cache deadline passes while calling ZITADEL", async () => {
    mocks.policy.mockResolvedValue({ ...policy, passwordLifetimeMs: 1000 });
    mocks.callback.mockImplementation(async () => {
      vi.advanceTimersByTime(1001);
      return "https://app.example.com/callback?code=opaque";
    });
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.writeAuthenticatedSession).not.toHaveBeenCalled();
    expect(mocks.clearAuthenticatedSession).toHaveBeenCalled();
  });

  it.each(["callback", "registration confirmation"])("starts the IDP flow before the native check with a zero external-login lifetime during %s", async entry => {
    const state = "a137fc65-3e87-4da0-b5cd-936eb5972868";
    const boundary = Date.now();
    mockPendingSession(pendingSession({ ...idpBinding, authRequestId: undefined, idpState: state, idpIntentId: "intent-id", idpIntentToken: "intent-token" }));
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [idp], externalLoginLifetimeMs: 0 });
    mocks.retrieveIdp.mockResolvedValue({ userId: "user-id", idpInformation });
    mocks.registerIdpUser.mockResolvedValue({ userId: "user-id" });
    mocks.createSession.mockImplementation(async () => {
      vi.advanceTimersByTime(250);
      const session = nativeSession({ password: undefined, intent: { verifiedAt: verifiedAt() } });
      mocks.session.mockResolvedValue(session);
      vi.advanceTimersByTime(250);
      return { sessionId: "session-id", sessionToken: "idp-token" };
    });
    const result = entry === "callback"
      ? await completeIdentityProvider({ state, idpIntentId: "intent-id", idpIntentToken: "intent-token" })
      : await confirmIdentityProviderRegistration({ state });
    expect(result).toEqual({ ok: true, redirect: "/account" });
    expect(mocks.writeAuthenticatedSession).toHaveBeenLastCalledWith(expect.objectContaining({ sessionToken: "idp-token", mfaStartedAt: boundary }));
  });

  it("revokes the upstream remembered session and clears both local cookies on logout", async () => {
    await expect(logout()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.deleteSession).toHaveBeenCalledWith(remembered);
    expect(mocks.clearAuthenticatedSession).toHaveBeenCalled();
    expect(mocks.clearPendingSession).toHaveBeenCalled();
  });
});

describe("ZITADEL server actions", () => {
  it("allows direct account login without an OIDC authorization request", async () => {
    const result = await login(credentials, {});
    expect(result).toEqual({ ok: true, redirect: "/account" });
    expect(mocks.createSession).toHaveBeenCalled();
    expect(mocks.callback).not.toHaveBeenCalled();
    expect(mocks.writeAuthenticatedSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-id", sessionToken: "session-token", userId: "user-id", mfaStartedAt: expect.any(Number) }));
  });
  it("accepts the empty login hint supplied by upstream protobuf defaults", async () => {
    expect(await login(credentials, { loginHint: "" })).toEqual({ ok: true, redirect: "/account" });
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
    expect(mocks.createSession).toHaveBeenCalledWith({ user: { search: { case: "loginName", value: credentials.loginName } }, password: { password: credentials.password } });
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: "session-id", sessionToken: "session-token" });
  });
  it.each([5, 16])("reports an account/password error only after the credential check rejects with code %s", async code => {
    mocks.createSession.mockRejectedValueOnce({ code });
    expect(await login(credentials, context)).toEqual({ ok: false, message: "账号或密码错误", requestId: expect.any(String) });
    expectNoAuthentication();
  });
  it.each([8, 14])("does not misreport authentication service error %s as incorrect credentials", async code => {
    mocks.createSession.mockRejectedValueOnce({ code });
    const result = await login(credentials, context);
    expect(result.ok).toBe(false);
    expect(result.message).not.toBe("账号或密码错误");
    expectNoAuthentication();
  });
  it("does not blame credentials when session inspection fails after the password check passed", async () => {
    mocks.session.mockRejectedValueOnce({ code: 16 });
    const result = await login(credentials, context);
    expect(result.ok).toBe(false);
    expect(result.message).not.toBe("账号或密码错误");
    expectNoAuthentication();
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
    mocks.methods.mockResolvedValue(["totp"]);
    const result = await decideConsent({ authRequestId: "V2_test", consentToken: consentToken(request as never, pending, mocks.config().sessionSecret), allow: true });
    expect(result).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ methods: ["totp"], userId: "user-id" }));
    expect(mocks.callback).not.toHaveBeenCalled();
  });
  it("continues authentication only when a fresh native policy inspection requires it", async () => {
    mocks.callback.mockImplementationOnce(async () => {
      mocks.policy.mockResolvedValue({ ...policy, forceMfa: true });
      throw { code: 9 };
    });
    const result = await login(credentials, context);
    expect(result).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", methods: ["totp"], userId: "user-id", needsEnrollment: true }));
    expect(mocks.writePendingSession.mock.calls.every(([pending]) => !pending.requireMfa)).toBe(true);
  });
  it("binds an MFA verification to the encrypted session and rotates the Session Token", async () => {
    mocks.readPendingSession.mockResolvedValue({ authRequestId: "V2_test", sessionId: "session-id", sessionToken: "old-token", methods: ["totp"], userId: "user-id" });
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.verifyFactor.mockResolvedValue({ sessionId: "session-id", sessionToken: "new-token" });
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession(sessionToken === "new-token" ? { totp: { verifiedAt: verifiedAt() } } : {}));
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
    const registered = await register(registration, context);
    expect(registered).toEqual({ ok: true, message: "账号已创建。验证邮件已发送，请打开邮件中的链接完成验证。", redirect: "/verify-email?userId=user-id&authRequest=V2_test" });
    expect(mocks.register).toHaveBeenCalledWith(registration, "org-id", "V2_test");
    mocks.findUser.mockResolvedValue(undefined);
    const reset = await requestPasswordReset({ loginName: "cat@example.com" }, context);
    expect(reset).toEqual({ ok: true, message: "如果账号存在且邮箱已验证，重置邮件将很快送达。" });
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });
  it.each([
    { registration: false, password: true },
    { registration: true, password: false },
    { registration: false, password: false },
  ])("blocks account creation when live signup policy is %j", async overrides => {
    mocks.policy.mockResolvedValue({ ...policy, ...overrides });
    expect(await register(registration, context)).toEqual({ ok: false, message: "当前未开放密码账号注册。" });
    expect(mocks.organizationForAuth).toHaveBeenCalledWith("V2_test");
    expect(mocks.policy).toHaveBeenCalledWith("org-id");
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.clearPendingSession).not.toHaveBeenCalled();
  });
  it("rechecks signup policy on each submission instead of trusting an earlier enabled form", async () => {
    mocks.register.mockResolvedValue("user-id");
    expect((await register(registration, context)).ok).toBe(true);
    mocks.policy.mockResolvedValue({ ...policy, registration: false });
    expect((await register(registration, context)).ok).toBe(false);
    expect(mocks.policy).toHaveBeenCalledTimes(2);
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });
  it("validates the current password complexity policy before creating an account", async () => {
    mocks.policy.mockResolvedValue({ ...policy, passwordPolicy: { ...policy.passwordPolicy, minLength: 20 } });
    expect(await register(registration, context)).toEqual({ ok: false, message: "密码不符合要求：至少 20 个字符，需包含小写字母。" });
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("starts an enabled identity provider using a server-generated state", async () => {
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ id: "idp", name: "Example IDP", creationAllowed: true, autoCreation: false }] });
    const result = await chooseIdentityProvider({ id: "idp" }, context);
    expect(result).toEqual({ ok: true, redirect: "https://provider.example.com/authorize" });
    expect(mocks.startIdp).toHaveBeenCalledWith("idp", expect.any(String));
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining(idpBinding));
    const pending = mocks.writePendingSession.mock.calls[0][0];
    expect(pending).not.toHaveProperty("idpCreationAllowed");
    expect(pending).not.toHaveProperty("idpAutoCreation");
  });
  it("requires explicit account creation confirmation when an IDP does not auto-create accounts", async () => {
    const state = "00000000-0000-4000-8000-000000000000";
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [idp] });
    mockPendingSession(pendingSession({ ...idpBinding, sessionId: "", sessionToken: "", idpState: state }));
    const result = await completeIdentityProvider({ idpIntentId: "intent-id", idpIntentToken: "intent-token", state });
    expect(result).toEqual({ ok: true, redirect: `/idp/confirm?state=${state}` });
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ ...idpBinding, idpIntentId: "intent-id", idpIntentToken: "intent-token" }));
    expect(mocks.writePendingSession.mock.calls[0][0]).not.toHaveProperty("idpNewUser");
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, intent: { verifiedAt: verifiedAt() } }, "new-user"));
    mocks.user.mockResolvedValue(nativeUser({}, "new-user"));
    const confirmed = await confirmIdentityProviderRegistration({ state });
    expect(confirmed.ok).toBe(true);
    expect(mocks.registerIdpUser).toHaveBeenCalledWith({ profile: { displayName: "New Account" } });
    expect(mocks.retrieveIdp).toHaveBeenCalledTimes(2);
    expect(mocks.createSession).toHaveBeenCalledWith({ user: { search: { case: "userId", value: "new-user" } }, idpIntent: { idpIntentId: "intent-id", idpIntentToken: "intent-token" } });
  });
  it("verifies email only with an explicit code and user identifier", async () => {
    expect((await verifyEmail({ code: "123456" }, {})).ok).toBe(false);
    expect(mocks.verifyEmail).not.toHaveBeenCalled();
    mocks.verifyEmail.mockResolvedValue(undefined);
    expect((await verifyEmail({ code: "123456" }, { userId: "user-id" })).ok).toBe(true);
  });
});

describe("OIDC callback failure classification", () => {
  it.each([
    ["COMMAND-Sx208nt", Code.FailedPrecondition, "此授权请求已处理"],
    ["COMMAND-Sx202nt", Code.FailedPrecondition, "此授权请求已处理"],
    ["COMMAND-SFwd2", Code.FailedPrecondition, "此授权请求已处理"],
    ["COMMAND-jae5P", Code.NotFound, "授权请求已失效"],
    ["COMMAND-59ljd", Code.FailedPrecondition, "当前账号不属于"],
    ["COMMAND-Hewfq", Code.FailedPrecondition, "登录会话已失效"],
    ["COMMAND-Hkl3d", Code.FailedPrecondition, "登录会话已失效"],
    ["COMMAND-Flk38", Code.FailedPrecondition, "登录会话已失效"],
  ] as const)("does not turn %s into MFA or retry a consumed authorization", async (id, code, message) => {
    mocks.callback.mockRejectedValue(callbackError(id, code));
    const result = await login(credentials, context);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining(message), requestId: expect.any(String) });
    expect(mocks.callback).toHaveBeenCalledTimes(1);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.deny).not.toHaveBeenCalled();
    expect(mocks.writeAuthenticatedSession).not.toHaveBeenCalled();
    expect(mocks.writePendingSession.mock.calls.every(([pending]) => !pending.requireMfa && !pending.needsEnrollment)).toBe(true);
  });

  it.each([
    { code: 9 },
    new ConnectError("Errors.User.MFA.NotReady (COMMAND-Hkl3d)", Code.FailedPrecondition),
    callbackError("unknown-error-id"),
  ])("returns an identifiable generic failure instead of guessing MFA for unknown errors", async error => {
    mocks.callback.mockRejectedValue(error);
    expect(await login(credentials, context)).toMatchObject({ ok: false, message: "当前操作的前置条件未满足，请重新发起登录或联系管理员。", requestId: expect.any(String) });
    expect(mocks.callback).toHaveBeenCalledTimes(1);
    expect(mocks.deny).not.toHaveBeenCalled();
    expect(mocks.writeAuthenticatedSession).not.toHaveBeenCalled();
    expect(mocks.writePendingSession.mock.calls.every(([pending]) => !pending.requireMfa && !pending.needsEnrollment)).toBe(true);
  });

  it("retains the callback error if the live reinspection is unavailable", async () => {
    mocks.callback.mockRejectedValue({ code: 9 });
    mocks.session.mockResolvedValueOnce(nativeSession()).mockRejectedValueOnce({ code: 14 });
    expect(await login(credentials, context)).toMatchObject({ ok: false, message: expect.stringContaining("前置条件"), requestId: expect.any(String) });
    expect(mocks.writeAuthenticatedSession).not.toHaveBeenCalled();
  });

  it.each([
    ["COMMAND-Hkl3d", ErrorReason.LOGIN_REQUIRED],
    ["COMMAND-59ljd", ErrorReason.ACCESS_DENIED],
  ] as const)("returns a precise protocol error for %s with prompt=none", async (id, reason) => {
    mocks.readAuthenticatedSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "token", userId: "user-id" });
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt: [Prompt.NONE] });
    mocks.callback.mockRejectedValue(callbackError(id));
    mocks.deny.mockResolvedValue("https://app.example.com/callback?error=required");
    expect(await resumeLogin(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?error=required" });
    expect(mocks.deny).toHaveBeenCalledWith("V2_test", reason);
    expect(mocks.writePendingSession).not.toHaveBeenCalled();
  });

  it.each([callbackError("COMMAND-Sx208nt"), { code: 9 }])("does not consume an already handled or unknown request again with prompt=none", async error => {
    mocks.readAuthenticatedSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "token", userId: "user-id" });
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt: [Prompt.NONE] });
    mocks.callback.mockRejectedValue(error);
    expect(await resumeLogin(context)).toMatchObject({ ok: false, requestId: expect.any(String) });
    expect(mocks.deny).not.toHaveBeenCalled();
    expect(mocks.writePendingSession).not.toHaveBeenCalled();
  });
});

describe("identity-provider boundaries use live backend policy and intent data", () => {
  const state = "00000000-0000-4000-8000-000000000000";
  const intent = { idpIntentId: "intent-id", idpIntentToken: "intent-token" };
  const entries = ["callback", "confirmation"] as const;
  const enter = (entry: typeof entries[number]) => entry === "callback"
    ? completeIdentityProvider({ ...intent, state }) : confirmIdentityProviderRegistration({ state });
  beforeEach(() => {
    mockPendingSession(pendingSession({ ...idpBinding, ...intent, sessionId: "", sessionToken: "", idpState: state }));
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [idp] });
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, intent: { verifiedAt: verifiedAt() } }, "new-user"));
    mocks.user.mockResolvedValue(nativeUser({}, "new-user"));
  });

  it.each(entries)("rejects a disabled or removed provider during %s", async entry => {
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [] });
    expect(await enter(entry)).toMatchObject({ ok: false, message: expect.stringContaining("登录方式当前不可用") });
    expect(mocks.organizationForAuth).toHaveBeenCalledWith("V2_test");
    expect(mocks.policy).toHaveBeenCalledWith("org-id");
    expect(mocks.retrieveIdp).not.toHaveBeenCalled();
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(entries)("rejects new account creation after it is disabled during %s", async entry => {
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ ...idp, creationAllowed: false, autoCreation: true }] });
    expect((await enter(entry)).ok).toBe(false);
    expect(mocks.retrieveIdp).toHaveBeenCalledWith("intent-id", "intent-token");
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(entries)("rejects a changed organization during %s", async entry => {
    mocks.organizationForAuth.mockResolvedValue("other-org");
    expect(await enter(entry)).toMatchObject({ ok: false, message: expect.stringContaining("组织已变化") });
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.retrieveIdp).not.toHaveBeenCalled();
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(entries)("rejects an intent from a different provider during %s", async entry => {
    mocks.retrieveIdp.mockResolvedValue({ userId: "new-user", idpInformation: { idpId: "other-idp" } });
    expect(await enter(entry)).toMatchObject({ ok: false, message: expect.stringContaining("不匹配") });
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(entries)("rejects missing provider information from the backend during %s", async entry => {
    mocks.retrieveIdp.mockResolvedValue({ userId: "new-user" });
    expect((await enter(entry)).ok).toBe(false);
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(entries)("restarts legacy unbound flow cookies during %s", async entry => {
    const legacy = { ...pendingSession({ ...intent, sessionId: "", sessionToken: "", idpState: state }), idpCreationAllowed: true, idpAutoCreation: true, idpNewUser: { username: "stale-user" } };
    mockPendingSession(legacy);
    expect((await enter(entry)).ok).toBe(false);
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(entries.flatMap(entry => ["organizationForAuth", "policy", "retrieveIdp"].map(operation => ({ entry, operation }))))("does not create accounts or sessions if $operation fails during $entry", async ({ entry, operation }) => {
    mocks[operation as "organizationForAuth" | "policy" | "retrieveIdp"].mockRejectedValue({ code: 14 });
    expect(await enter(entry)).toMatchObject({ ok: false, requestId: expect.any(String) });
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("asks for confirmation when auto-creation is disabled after starting IDP login", async () => {
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ ...idp, autoCreation: true }] });
    await chooseIdentityProvider({ id: "idp" }, context);
    const flowState = (await mocks.readPendingSession()).idpState;
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [idp] });
    expect(await completeIdentityProvider({ ...intent, state: flowState })).toEqual({ ok: true, redirect: `/idp/confirm?state=${flowState}` });
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("uses a newly enabled auto-creation policy at callback", async () => {
    await chooseIdentityProvider({ id: "idp" }, context);
    const flowState = (await mocks.readPendingSession()).idpState;
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ ...idp, autoCreation: true }] });
    expect((await completeIdentityProvider({ ...intent, state: flowState })).ok).toBe(true);
    expect(mocks.registerIdpUser).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it("blocks a previously opened confirmation flow after registration is disabled", async () => {
    expect(await enter("callback")).toEqual({ ok: true, redirect: `/idp/confirm?state=${state}` });
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ ...idp, creationAllowed: false }] });
    expect(await enter("confirmation")).toMatchObject({ ok: false, message: expect.stringContaining("不允许创建账号") });
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("does not register from old data when the intent no longer supplies registration data", async () => {
    expect((await enter("callback")).ok).toBe(true);
    mocks.retrieveIdp.mockResolvedValue({ userId: "", idpInformation });
    expect(await enter("confirmation")).toMatchObject({ ok: false, message: expect.stringContaining("注册资料已失效") });
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("fetches fresh registration data at confirmation instead of using a cached profile", async () => {
    const cached = { ...pendingSession({ ...idpBinding, ...intent, idpState: state }), idpNewUser: { username: "stale-profile" }, idpCreationAllowed: true };
    mockPendingSession(cached);
    const fresh = { username: "fresh-profile", profile: { displayName: "Updated Account" } };
    mocks.retrieveIdp.mockResolvedValue({ userId: "", idpInformation, addHumanUser: fresh });
    expect((await enter("confirmation")).ok).toBe(true);
    expect(mocks.registerIdpUser).toHaveBeenCalledExactlyOnceWith(fresh);
  });

  it.each(entries)("logs into an already linked account without creating it again during %s", async entry => {
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [{ ...idp, creationAllowed: false }] });
    mocks.retrieveIdp.mockResolvedValue({ userId: "new-user", idpInformation });
    expect((await enter(entry)).ok).toBe(true);
    expect(mocks.registerIdpUser).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith({ user: { search: { case: "userId", value: "new-user" } }, idpIntent: intent });
  });

  it("supports an instance-level flow without inventing an organization", async () => {
    mocks.organizationForAuth.mockResolvedValue(undefined);
    await chooseIdentityProvider({ id: "idp" }, {});
    const pending = await mocks.readPendingSession();
    expect(pending.idpOrganizationId).toBe("");
    expect(await completeIdentityProvider({ ...intent, state: pending.idpState })).toEqual({ ok: true, redirect: `/idp/confirm?state=${pending.idpState}` });
    expect(mocks.policy).toHaveBeenCalledWith(undefined);
  });

  it("rejects a changed state before reading the policy or intent", async () => {
    expect((await completeIdentityProvider({ ...intent, state: "10000000-0000-4000-8000-000000000000" })).ok).toBe(false);
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.retrieveIdp).not.toHaveBeenCalled();
  });
});

describe("unified authentication gate", () => {
  it.each(entryPoints)("does not skip enrolled MFA at the %s entry point even when forceMfa is false", async entry => {
    mocks.methods.mockResolvedValue(["totp"]);
    const result = await enterGate(entry);
    expect(result).toEqual({ ok: true, redirect: entry === "direct" ? "/verify" : "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenLastCalledWith(expect.objectContaining({ methods: ["totp"], userId: "user-id", needsEnrollment: false }));
    expect(mocks.user).toHaveBeenCalledWith("user-id");
    expect(mocks.methods).toHaveBeenCalledWith("user-id");
    expectNoAuthentication();
  });

  it.each(entryPoints)("accepts native timestamped MFA at the %s entry point", async entry => {
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockResolvedValue(nativeSession({ totp: { verifiedAt: verifiedAt() } }));
    expect(await enterGate(entry)).toEqual({ ok: true, redirect: entry === "direct" ? "/account" : "https://app.example.com/callback?code=opaque" });
    if (entry === "direct") expect(mocks.writeAuthenticatedSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-id" }));
    else expect(mocks.callback).toHaveBeenCalledTimes(1);
  });

  it.each(entryPoints)("rejects a primary password factor without verifiedAt at the %s entry point", async entry => {
    mocks.session.mockResolvedValue(nativeSession({ password: {} }));
    expect(await enterGate(entry)).toMatchObject({ ok: false, message: expect.stringContaining("请先完成密码") });
    expectNoAuthentication();
  });

  it.each(entryPoints)("blocks an unverified email at the %s entry point", async entry => {
    mocks.user.mockResolvedValue(nativeUser({ email: { email: credentials.loginName, isVerified: false } }));
    expect(await enterGate(entry)).toEqual({ ok: true, redirect: entry === "direct" ? "/verify" : "/verify?authRequest=V2_test" });
    expectNoAuthentication();
  });

  it.each(entryPoints)("blocks a required password change at the %s entry point", async entry => {
    mocks.user.mockResolvedValue(nativeUser({ passwordChangeRequired: true }));
    expect(await enterGate(entry)).toEqual({ ok: true, redirect: entry === "direct" ? "/verify" : "/verify?authRequest=V2_test" });
    expectNoAuthentication();
  });

  it.each([
    { methods: [], needsEnrollment: false, factorVerified: true },
    { methods: ["u2f" as const], needsEnrollment: true, factorVerified: true },
  ])("replaces stale or forged pending presentation metadata with native state: %j", async metadata => {
    const current = mockPendingSession(pendingSession(metadata));
    mocks.methods.mockResolvedValue(["totp"]);
    expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(current()).toMatchObject({ methods: ["totp"], needsEnrollment: false });
    expectNoAuthentication();
  });

  it("does not accept a cookie-listed factor that is not enrolled upstream", async () => {
    mockPendingSession(pendingSession({ methods: ["totp"], needsEnrollment: false, factorVerified: true }));
    expect((await verifyFactor({ method: "totp", code: "123456" }, context)).ok).toBe(false);
    expect(mocks.verifyFactor).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("uses real enrollment even if pending.methods is empty and needsEnrollment is stale", async () => {
    mockPendingSession(pendingSession({ methods: [], needsEnrollment: true, factorVerified: false }));
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession(sessionToken === "new-token" ? { totp: { verifiedAt: verifiedAt() } } : {}));
    expect(await verifyFactor({ method: "totp", code: "123456" }, context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.verifyFactor).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "old-token" }), "totp", "123456");
  });

  it("does not let a forged enrollment flag replace an already enrolled factor", async () => {
    mockPendingSession(pendingSession({ methods: ["totp"], needsEnrollment: true }));
    mocks.methods.mockResolvedValue(["totp"]);
    expect((await startTotpEnrollment(context)).ok).toBe(false);
    expect(mocks.enrollTotp).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("uses native enrollment requirements instead of a false needsEnrollment cookie", async () => {
    mockPendingSession(pendingSession({ methods: [], needsEnrollment: false }));
    mocks.policy.mockResolvedValue({ ...policy, forceMfa: true });
    expect(await startTotpEnrollment(context)).toMatchObject({ ok: true, secret: "totp-secret", uri: expect.stringContaining("otpauth://") });
    expect(mocks.enrollTotp).toHaveBeenCalledWith("user-id");
    expectNoAuthentication();
  });

  it.each([-60_000, 60_000])("does not accept an expired or future MFA timestamp (%i ms)", async offset => {
    mocks.policy.mockResolvedValue({ ...policy, secondFactorLifetimeMs: 1000 });
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockResolvedValue(nativeSession({ totp: { verifiedAt: verifiedAt(offset) } }));
    expect(await login(credentials, {})).toEqual({ ok: true, redirect: "/verify" });
    expectNoAuthentication();
  });

  it("rechecks enrolled MFA when recovering an authenticated account cookie", async () => {
    mocks.readAuthenticatedSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "account-token", userId: "user-id" });
    mocks.methods.mockResolvedValue(["totp"]);
    await expect(resumeAccountAuthentication()).rejects.toThrow("NEXT_REDIRECT:/verify");
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "account-token" }));
    expect(mocks.clearAuthenticatedSession).toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("redirects to login when no authenticated account cookie exists", async () => {
    await expect(resumeAccountAuthentication()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.session).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each([false, true])("requires already enrolled MFA after an external intent; forceMfaLocalOnly=%s", async localOnly => {
    const state = "00000000-0000-4000-8000-000000000000";
    mockPendingSession(pendingSession({ ...idpBinding, sessionId: "", sessionToken: "", idpState: state }));
    mocks.retrieveIdp.mockResolvedValue({ userId: "user-id", idpInformation });
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, intent: { verifiedAt: verifiedAt() } }));
    mocks.policy.mockResolvedValue({ ...policy, identityProviders: [idp], forceMfaLocalOnly: localOnly });
    mocks.methods.mockResolvedValue(["totp"]);
    expect(await completeIdentityProvider({ idpIntentId: "intent-id", idpIntentToken: "intent-token", state })).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expectNoAuthentication();
  });

  it("does not force local-password-only MFA for a native external intent with no enrolled factors", async () => {
    mockPendingSession(pendingSession());
    mocks.policy.mockResolvedValue({ ...policy, forceMfaLocalOnly: true });
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, intent: { verifiedAt: verifiedAt() } }));
    expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
  });
});

describe("native MFA proof, not a cookie flag", () => {
  it("does not complete authentication when the OTP code is rejected", async () => {
    const current = mockPendingSession(pendingSession({ factorVerified: true }));
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.verifyFactor.mockRejectedValue({ code: 16 });
    expect(await verifyFactor({ method: "totp", code: "123456" }, context)).toMatchObject({ ok: false, message: expect.stringContaining("验证码不正确") });
    expect(current()?.sessionToken).toBe("old-token");
    expect(mocks.clearPendingSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("does not complete authentication when a successful SDK response has no native verifiedAt", async () => {
    const current = mockPendingSession(pendingSession({ factorVerified: true }));
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession(sessionToken === "new-token" ? { totp: {} } : {}));
    expect(await verifyFactor({ method: "totp", code: "123456" }, context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(current()).toMatchObject({ sessionToken: "new-token", methods: ["totp"], needsEnrollment: false });
    expectNoAuthentication();
  });

  it.each(["otpEmail", "otpSms"] as const)("requires a server-bound challenge before checking %s", async method => {
    mockPendingSession(pendingSession({ methods: [method], challengeMethod: undefined }));
    mocks.methods.mockResolvedValue([method]);
    mocks.policy.mockResolvedValue({ ...policy, factors: [method] });
    expect((await verifyFactor({ method, code: "123456" }, context)).ok).toBe(false);
    expect(mocks.verifyFactor).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each(["otpEmail", "otpSms"] as const)("rotates a %s challenge token and requires native proof after the code", async method => {
    const current = mockPendingSession(pendingSession());
    mocks.methods.mockResolvedValue([method]);
    mocks.policy.mockResolvedValue({ ...policy, factors: [method] });
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession(sessionToken === "new-token" ? { [method]: { verifiedAt: verifiedAt() } } : {}));
    expect((await beginFactor({ method }, context)).ok).toBe(true);
    expect(current()).toMatchObject({ sessionToken: "challenge-token", challengeMethod: method });
    expect(await verifyFactor({ method, code: "012345" }, context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.verifyFactor).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "challenge-token" }), method, "012345");
  });

  it.each(["u2f"] as const)("does not route %s through numeric-code verification", async method => {
    mockPendingSession(pendingSession({ methods: [method], challengeMethod: method }));
    expect((await verifyFactor({ method, code: "123456" }, context)).ok).toBe(false);
    expect(mocks.verifyFactor).not.toHaveBeenCalled();
    expectNoAuthentication();
  });
});

describe("primary passkey and MFA key ceremonies", () => {
  it("issues a fresh discovery challenge on every attempt", async () => {
    const first = await startPasskey({}, {});
    const second = await startPasskey({}, {});
    expect(first.options?.challenge).not.toBe(second.options?.challenge);
  });

  it("treats an empty upstream login hint as an unknown account", async () => {
    expect(await startPasskey({}, { loginHint: "" })).toMatchObject({ ok: true, discoverUser: true });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("challenges a discovered user ID but never treats discovery as authentication", async () => {
    mocks.createSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "passkey-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: { challenge: "native-challenge" } } } });
    expect(await startPasskey({ userId: "user-id" }, context)).toEqual({ ok: true, options: { challenge: "native-challenge" } });
    expect(mocks.createSession).toHaveBeenCalledWith(
      { user: { search: { case: "userId", value: "user-id" } } },
      { webAuthN: { domain: "login.example.com", userVerificationRequirement: UserVerificationRequirement.REQUIRED } },
    );
    expect(mocks.verifyWebAuthn).not.toHaveBeenCalled();
    expect(mocks.writePasskeyAccount).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("skips discovery for a remembered account but still requires a native assertion", async () => {
    mocks.readPasskeyAccount.mockResolvedValue({ userId: "user-id" });
    mocks.createSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "passkey-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: { challenge: "native-challenge" } } } });
    expect(await startPasskey({}, {})).toEqual({ ok: true, options: { challenge: "native-challenge" } });
    expect(mocks.createSession).toHaveBeenCalledWith(
      { user: { search: { case: "userId", value: "user-id" } } }, expect.anything(),
    );
    expectNoAuthentication();
  });

  it("allows account switching even with a remembered account and an upstream login hint", async () => {
    mocks.readPasskeyAccount.mockResolvedValue({ userId: "old-user" });
    mocks.authRequest.mockResolvedValue({ ...authorization, loginHint: credentials.loginName });
    expect(await startPasskey({ chooseAccount: true }, context)).toMatchObject({ ok: true, discoverUser: true });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("uses an upstream login hint without asking for a username or running discovery", async () => {
    mocks.authRequest.mockResolvedValue({ ...authorization, loginHint: credentials.loginName });
    mocks.createSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "passkey-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: { challenge: "native-challenge" } } } });
    expect(await startPasskey({}, context)).toEqual({ ok: true, options: { challenge: "native-challenge" } });
    expect(mocks.createSession).toHaveBeenCalledWith(
      { user: { search: { case: "loginName", value: credentials.loginName } } }, expect.anything(),
    );
  });

  it("rejects silent authorization and disabled passkeys before account discovery", async () => {
    mocks.authRequest.mockResolvedValue({ ...authorization, prompt: [Prompt.NONE] });
    mocks.deny.mockResolvedValue("https://app.example.com/callback?error=login_required");
    expect(await startPasskey({}, context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?error=login_required" });
    mocks.policy.mockResolvedValue({ ...policy, passkey: false });
    expect((await startPasskey({}, {})).ok).toBe(false);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each([
    { name: "direct", ctx: {} as AuthContext },
    { name: "OIDC", ctx: context },
  ])("requires user verification without imposing a local session lifetime for a $name primary passkey challenge", async ({ ctx }) => {
    const options = { challenge: "primary-challenge" };
    mocks.createSession.mockResolvedValue({ sessionId: "session-id", sessionToken: "passkey-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: options } } });
    expect(await startPasskey({ loginName: credentials.loginName }, ctx)).toEqual({ ok: true, options });
    expect(mocks.createSession).toHaveBeenCalledWith(
      { user: { search: { case: "loginName", value: credentials.loginName } } },
      { webAuthN: { domain: "login.example.com", userVerificationRequirement: UserVerificationRequirement.REQUIRED } },
    );
    expect(mocks.writePendingSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "passkey-token", passkeyPending: true }));
    expect(mocks.session).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it.each([
    { name: "user verification missing", webAuthN: { userVerified: false, verifiedAt: verifiedAt() } },
    { name: "timestamp missing", webAuthN: { userVerified: true } },
    { name: "future timestamp", webAuthN: { userVerified: true, verifiedAt: verifiedAt(60_000) } },
  ])("rejects primary passkeys with $name", async ({ webAuthN }) => {
    const current = mockPendingSession(pendingSession({ passkeyPending: true, factorVerified: true }));
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, webAuthN }));
    await expect(finishPasskey(assertion, context)).resolves.toMatchObject({ ok: false });
    expect(current()?.sessionToken).toBe("new-token");
    expectNoAuthentication();
  });

  it("authenticates a primary passkey using native userVerified and verifiedAt, without a password", async () => {
    mockPendingSession(pendingSession({ passkeyPending: true }));
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, webAuthN: { userVerified: true, verifiedAt: verifiedAt() } }));
    expect(await finishPasskey(assertion, context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.verifyWebAuthn).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "old-token" }), assertion);
    expect(mocks.verifyWebAuthn).toHaveBeenCalledTimes(1);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(mocks.challenge).not.toHaveBeenCalled();
    expect(mocks.writePasskeyAccount).toHaveBeenCalledWith("user-id");
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: "session-id", sessionToken: "new-token" });
  });
});

describe("rotated session tokens survive subsequent read failures", () => {
  it("persists an OTP verification token before a failed native session read", async () => {
    const current = mockPendingSession(pendingSession());
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockResolvedValueOnce(nativeSession()).mockRejectedValueOnce({ code: 14 });
    await expect(verifyFactor({ method: "totp", code: "123456" }, context)).resolves.toMatchObject({ ok: false });
    expect(current()?.sessionToken).toBe("new-token");
    expect(mocks.session).toHaveBeenLastCalledWith(expect.objectContaining({ sessionToken: "new-token" }));
    expect(mocks.clearPendingSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("persists a primary passkey token before a failed native session read", async () => {
    const current = mockPendingSession(pendingSession({ passkeyPending: true }));
    mocks.session.mockRejectedValueOnce({ code: 14 });
    expect((await finishPasskey(assertion, context)).ok).toBe(false);
    expect(current()?.sessionToken).toBe("new-token");
    expect(mocks.clearPendingSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("persists a U2F assertion token before a failed native session read", async () => {
    const current = mockPendingSession(pendingSession({ challengeMethod: "u2f" }));
    mocks.policy.mockResolvedValue({ ...policy, factors: ["u2f"] });
    mocks.methods.mockResolvedValue(["u2f"]);
    mocks.session.mockResolvedValueOnce(nativeSession()).mockRejectedValueOnce({ code: 14 });
    await expect(finishWebAuthnFactor(assertion, context)).resolves.toMatchObject({ ok: false });
    expect(current()?.sessionToken).toBe("new-token");
    expect(mocks.clearPendingSession).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("persists a changed-password token before a failed native session read", async () => {
    const current = mockPendingSession(pendingSession());
    mocks.user.mockResolvedValue(nativeUser({ passwordChangeRequired: true }));
    mocks.session.mockResolvedValueOnce(nativeSession()).mockRejectedValueOnce({ code: 14 });
    await expect(changeLoginPassword({ password: "new-password", confirmPassword: "new-password" }, context)).resolves.toMatchObject({ ok: false });
    expect(mocks.changePassword).toHaveBeenCalledWith("user-id", "new-password");
    expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "old-token" }), { password: { password: "new-password" } });
    expect(current()?.sessionToken).toBe("new-token");
    expectNoAuthentication();
  });

  it("persists rotation if a subsequent user read fails", async () => {
    const current = mockPendingSession(pendingSession());
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession(sessionToken === "new-token" ? { totp: { verifiedAt: verifiedAt() } } : {}));
    mocks.user.mockResolvedValueOnce(nativeUser()).mockRejectedValueOnce({ code: 14 });
    await expect(verifyFactor({ method: "totp", code: "123456" }, context)).resolves.toMatchObject({ ok: false });
    expect(current()?.sessionToken).toBe("new-token");
    expectNoAuthentication();
  });

  it("persists a challenge token even when the server omits WebAuthn options", async () => {
    const current = mockPendingSession(pendingSession());
    mocks.policy.mockResolvedValue({ ...policy, factors: ["u2f"] });
    mocks.methods.mockResolvedValue(["u2f"]);
    mocks.challenge.mockResolvedValue({ sessionId: "session-id", sessionToken: "challenge-token" });
    expect((await beginFactor({ method: "u2f" }, context)).ok).toBe(false);
    expect(current()).toMatchObject({ sessionToken: "challenge-token", challengeMethod: "u2f" });
    expectNoAuthentication();
  });
});

describe("enrollment retries and prerequisite SDK actions", () => {
  it("retries only the Session check after TOTP confirmation succeeded but the first Session update failed", async () => {
    const current = mockPendingSession(pendingSession());
    let enrolled = false;
    mocks.policy.mockResolvedValue({ ...policy, forceMfa: true });
    mocks.methods.mockImplementation(async () => enrolled ? ["totp"] : []);
    mocks.confirmTotp.mockImplementation(async () => { enrolled = true; });
    mocks.verifyFactor.mockRejectedValueOnce({ code: 14 }).mockResolvedValue({ sessionId: "session-id", sessionToken: "verified-token" });
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => nativeSession(sessionToken === "verified-token" ? { totp: { verifiedAt: verifiedAt() } } : {}));

    expect((await startTotpEnrollment(context)).ok).toBe(true);
    expect(current()?.totpEnrollmentStarted).toBe(true);
    expect((await finishTotpEnrollment({ code: "123456" }, context)).ok).toBe(false);
    expect(mocks.confirmTotp).toHaveBeenCalledTimes(1);
    expect(current()).toMatchObject({ sessionToken: "old-token", totpEnrollmentStarted: true });
    expectNoAuthentication();

    expect(await finishTotpEnrollment({ code: "654321" }, context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    expect(mocks.confirmTotp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyFactor).toHaveBeenNthCalledWith(1, expect.objectContaining({ sessionToken: "old-token" }), "totp", "123456");
    expect(mocks.verifyFactor).toHaveBeenNthCalledWith(2, expect.objectContaining({ sessionToken: "old-token" }), "totp", "654321");
    expect(mocks.callback).toHaveBeenCalledWith("V2_test", { sessionId: "session-id", sessionToken: "verified-token" });
  });

  it.each(["otpEmail", "otpSms"] as const)("does not treat %s enrollment as authentication", async method => {
    const current = mockPendingSession(pendingSession());
    let enrolled = false;
    mocks.policy.mockResolvedValue({ ...policy, forceMfa: true, factors: [method] });
    mocks.methods.mockImplementation(async () => enrolled ? [method] : []);
    mocks.enrollOtp.mockImplementation(async () => { enrolled = true; });
    expect(await enrollOtpFactor({ method }, context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.enrollOtp).toHaveBeenCalledWith("user-id", method);
    expect(current()).toMatchObject({ methods: [method], needsEnrollment: false });
    expectNoAuthentication();
  });

  it("uses phone SDK prerequisites without enrolling SMS or authenticating the session", async () => {
    mockPendingSession(pendingSession());
    mocks.policy.mockResolvedValue({ ...policy, forceMfa: true, factors: ["otpSms"] });
    expect((await setEnrollmentPhone({ phone: "+12025550123" }, context)).ok).toBe(true);
    expect((await verifyEnrollmentPhone({ code: "012345" }, context)).ok).toBe(true);
    expect(mocks.setEnrollmentPhone).toHaveBeenCalledWith("user-id", "+12025550123");
    expect(mocks.verifyEnrollmentPhone).toHaveBeenCalledWith("user-id", "012345");
    expect(mocks.enrollOtp).not.toHaveBeenCalled();
    expectNoAuthentication();
  });

  it("does not bypass enrolled MFA after verifying a login email", async () => {
    mockPendingSession(pendingSession());
    let emailVerified = false;
    mocks.user.mockImplementation(async () => nativeUser({ email: { email: credentials.loginName, isVerified: emailVerified } }));
    mocks.methods.mockResolvedValue(["totp"]);
    mocks.verifyEmail.mockImplementation(async () => { emailVerified = true; });
    expect((await resendLoginEmail(context)).ok).toBe(true);
    expect(mocks.sendEmailCode).toHaveBeenCalledWith("user-id", "V2_test");
    expect(await verifyLoginEmail({ code: "123456" }, context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.verifyEmail).toHaveBeenCalledWith("user-id", "123456");
    expectNoAuthentication();
  });
});

describe("upstream force-MFA/local-only combinations", () => {
  for (const local of [false, true]) {
    for (const forceMfa of [false, true]) {
      for (const forceMfaLocalOnly of [false, true]) {
        it(`uses the Go policy formula for local=${local}, forceMfa=${forceMfa}, localOnly=${forceMfaLocalOnly}`, async () => {
          mocks.policy.mockResolvedValue({ ...policy, forceMfa, forceMfaLocalOnly });
          if (!local) mocks.session.mockResolvedValue(nativeSession({ password: undefined, intent: { verifiedAt: verifiedAt() } }));
          const required = local ? forceMfa || forceMfaLocalOnly : forceMfa && !forceMfaLocalOnly;
          expect(await login(credentials, {})).toEqual({ ok: true, redirect: required ? "/verify" : "/account" });
          if (required) expectNoAuthentication();
          else expect(mocks.writeAuthenticatedSession).toHaveBeenCalled();
        });
      }
    }
  }
});

describe("zero-lifetime native MFA proof belongs to one login or step-up flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T04:00:00.000Z"));
    mocks.session.mockResolvedValue(nativeSession());
  });

  function zeroLifetime(method: "totp" | "u2f") {
    mocks.policy.mockResolvedValue({ ...policy, passkey: false, factors: [method], secondFactorLifetimeMs: 0, multiFactorLifetimeMs: 0 });
    mocks.methods.mockResolvedValue([method]);
  }
  function nativeProof(method: "totp" | "u2f", offsetMs: number) {
    return nativeSession(method === "totp" ? { totp: { verifiedAt: verifiedAt(offsetMs) } } : { webAuthN: { verifiedAt: verifiedAt(offsetMs) } });
  }

  for (const method of ["totp", "u2f"] as const) {
    it(`rejects ${method} proof from before the current flow, even with factorVerified=true`, async () => {
      const boundary = Date.now() - 10_000;
      const current = mockPendingSession(pendingSession({ mfaStartedAt: boundary, factorVerified: true }));
      zeroLifetime(method);
      mocks.session.mockResolvedValue(nativeProof(method, -10_001));
      expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
      expect(current()).toMatchObject({ mfaStartedAt: boundary, methods: [method], needsEnrollment: false });
      expectNoAuthentication();
    });

    it.each([0, 1])(`accepts ${method} verifiedAt at flow start plus %i ms, even much later`, async offset => {
      const boundary = Date.now() - 10_000;
      mockPendingSession(pendingSession({ mfaStartedAt: boundary }));
      zeroLifetime(method);
      mocks.session.mockResolvedValue(nativeProof(method, -10_000 + offset));
      vi.advanceTimersByTime(60_000);
      expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
      expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ mfaStartedAt: boundary }));
      expect(mocks.callback).toHaveBeenCalledTimes(1);
    });

    it(`does not treat a ${method} flow boundary as proof when native verifiedAt is absent`, async () => {
      mockPendingSession(pendingSession({ mfaStartedAt: Date.now() - 10_000, factorVerified: true }));
      zeroLifetime(method);
      mocks.session.mockResolvedValue(nativeSession(method === "totp" ? { totp: {} } : { webAuthN: {} }));
      expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
      expectNoAuthentication();
    });
  }

  it("creates a fresh Session and boundary before the SDK call instead of inheriting another login flow", async () => {
    const now = Date.now();
    const oldBoundary = now - 60_000;
    const current = mockPendingSession(pendingSession({ authRequestId: undefined, mfaStartedAt: oldBoundary, factorVerified: true }));
    mocks.readAuthenticatedSession.mockResolvedValue({ sessionId: "previous-session", sessionToken: "previous-token", userId: "user-id", mfaStartedAt: oldBoundary });
    zeroLifetime("totp");
    mocks.session.mockResolvedValue(nativeProof("totp", -1000));
    mocks.createSession.mockImplementation(async () => {
      vi.advanceTimersByTime(250);
      return { sessionId: "fresh-session", sessionToken: "fresh-token" };
    });
    expect(await login(credentials, {})).toEqual({ ok: true, redirect: "/verify" });
    expect(current()).toMatchObject({ sessionId: "fresh-session", sessionToken: "fresh-token", mfaStartedAt: now });
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "fresh-session", sessionToken: "fresh-token", mfaStartedAt: now }));
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expectNoAuthentication();
  });

  it("starts a new primary passkey boundary before challenge creation and preserves it through verification", async () => {
    const boundary = Date.now();
    const current = mockPendingSession(pendingSession({ authRequestId: undefined, passkeyPending: true, mfaStartedAt: boundary - 60_000 }));
    mocks.policy.mockResolvedValue({ ...policy, multiFactorLifetimeMs: 0 });
    mocks.createSession.mockImplementation(async () => {
      vi.advanceTimersByTime(250);
      return { sessionId: "new-passkey-session", sessionToken: "new-passkey-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: { challenge: "new-challenge" } } } };
    });
    expect((await startPasskey({ loginName: credentials.loginName }, {})).ok).toBe(true);
    expect(current()).toMatchObject({ mfaStartedAt: boundary, sessionId: "new-passkey-session", passkeyPending: true });
    expect(mocks.deleteSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "old-token" }));
    expectNoAuthentication();

    mocks.verifyWebAuthn.mockResolvedValue({ sessionId: "new-passkey-session", sessionToken: "verified-passkey-token" });
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, webAuthN: { userVerified: true, verifiedAt: verifiedAt() } }));
    vi.advanceTimersByTime(60_000);
    expect(await finishPasskey(assertion, {})).toEqual({ ok: true, redirect: "/account" });
    expect(mocks.writeAuthenticatedSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "new-passkey-session", sessionToken: "verified-passkey-token", mfaStartedAt: boundary }));
  });

  it.each([false, true])("rechecks the same zero-lifetime flow at consent; proof is from this flow=%s", async currentFlow => {
    const boundary = Date.now() - 10_000;
    const pending = pendingSession({ mfaStartedAt: boundary, factorVerified: true });
    mockPendingSession(pending);
    zeroLifetime("totp");
    mocks.session.mockResolvedValue(nativeProof("totp", currentFlow ? -10_000 : -10_001));
    expect(await approveConsent(pending)).toEqual({ ok: true, redirect: currentFlow ? "https://app.example.com/callback?code=opaque" : "/verify?authRequest=V2_test" });
    if (currentFlow) expect(mocks.callback).toHaveBeenCalledTimes(1);
    else expectNoAuthentication();
  });

  it("carries the original boundary into the authenticated cookie and keeps this completed account flow valid", async () => {
    const boundary = Date.now() - 10_000;
    mockPendingSession(pendingSession({ authRequestId: undefined, mfaStartedAt: boundary }));
    zeroLifetime("totp");
    const completed = nativeProof("totp", 0);
    mocks.session.mockImplementation(async ({ sessionToken }: { sessionToken: string }) => sessionToken === "new-token" ? completed : nativeSession());
    expect(await verifyFactor({ method: "totp", code: "123456" }, {})).toEqual({ ok: true, redirect: "/account" });
    const authenticated = mocks.writeAuthenticatedSession.mock.calls[0][0];
    expect(authenticated).toMatchObject({ sessionToken: "new-token", userId: "user-id", mfaStartedAt: boundary });

    vi.advanceTimersByTime(60 * 60_000);
    mocks.readAuthenticatedSession.mockResolvedValue(authenticated);
    const accountSession = await mocks.readAuthenticatedSession();
    await expect(inspectAuthentication(accountSession, accountSession.userId)).resolves.toMatchObject({ step: "complete" });
  });

  it("creates a new step-up boundary rather than reusing the completed account flow's zero-lifetime proof", async () => {
    const boundary = Date.now();
    const current = mockPendingSession(pendingSession({ authRequestId: undefined }));
    zeroLifetime("totp");
    mocks.readAuthenticatedSession.mockResolvedValue({ sessionId: "account-session", sessionToken: "account-token", userId: "user-id", mfaStartedAt: boundary - 10_000 });
    mocks.session.mockResolvedValue(nativeProof("totp", -1000));
    await expect(resumeAccountAuthentication()).rejects.toThrow("NEXT_REDIRECT:/verify");
    expect(current()).toMatchObject({ sessionId: "account-session", sessionToken: "account-token", mfaStartedAt: boundary, methods: ["totp"] });
    expectNoAuthentication();
  });

  it.each([false, true])("classifies an expired UV primary passkey as local authentication; forceMfa=%s", async forceMfa => {
    mockPendingSession(pendingSession());
    mocks.policy.mockResolvedValue({ ...policy, forceMfa, forceMfaLocalOnly: true, multiFactorLifetimeMs: 1000 });
    mocks.session.mockResolvedValue(nativeSession({ password: undefined, webAuthN: { userVerified: true, verifiedAt: verifiedAt(-5000) } }));
    expect(await resumeAuthentication(context)).toEqual({ ok: true, redirect: "/verify?authRequest=V2_test" });
    expect(mocks.writePendingSession).toHaveBeenLastCalledWith(expect.objectContaining({ methods: ["totp"], needsEnrollment: true }));
    expectNoAuthentication();
  });
});
