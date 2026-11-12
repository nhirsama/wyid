import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { SessionSchema, type Factors } from "@zitadel/proto/zitadel/session/v2/session_pb.js";
import { UserSchema, type User } from "@zitadel/proto/zitadel/user/v2/user_pb.js";
import { AuthRequestSchema, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import type { Factor, LoginPolicy } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), policy: vi.fn(), methods: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ organizationId: "default-org" }), ConfigurationError: class extends Error {} }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: mocks }));
import { authenticationExpiresAt, authenticationStep, canReuseAuthentication, inspectAuthentication, type AuthenticationState } from "@/server/authentication";

const now = new Date("2026-11-10T10:00:00.000Z");
const at = (age = 0) => timestampFromDate(new Date(now.getTime() - age));
const policy: LoginPolicy = {
  password: true, registration: false, passwordReset: true, passkey: true, forceMfa: false, forceMfaLocalOnly: false,
  factors: ["totp", "otpEmail", "otpSms", "u2f"], userVerifiedKey: true,
  secondFactorLifetimeMs: 60_000, multiFactorLifetimeMs: 120_000,
  passwordPolicy: { minLength: 8, uppercase: false, lowercase: false, number: false, symbol: false }, identityProviders: [],
};
function human(overrides = {}) {
  return create(UserSchema, { userId: "user-id", details: { resourceOwner: "user-org" }, type: { case: "human", value: { email: { email: "user@example.com", isVerified: true }, ...overrides } } });
}
function native(factors: Partial<Omit<Factors, "$typeName">> = {}) {
  return create(SessionSchema, { factors: { user: { id: "user-id" }, password: { verifiedAt: at() }, ...factors } });
}
function step(factors: Partial<Omit<Factors, "$typeName">> = {}, enrolled: Factor[] = [], overrides: Partial<LoginPolicy> = {}, user: User = human()) {
  return authenticationStep(native(factors), user, { ...policy, ...overrides }, enrolled);
}
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => vi.useRealTimers());

describe("native ZITADEL authentication gate", () => {
  it("allows password-only login only when there are no enabled enrolled factors and MFA is optional", () => {
    expect(step().step).toBe("complete");
    expect(step({}, ["totp"]).step).toBe("mfa");
  });
  it.each(["totp", "otpEmail", "otpSms", "u2f"] as Factor[])("requires an enrolled %s even when forceMfa is false", method => {
    expect(step({}, [method])).toEqual({ step: "mfa", methods: [method], needsEnrollment: false });
  });
  it("ignores factors disabled by the current policy and does not accept their proof", () => {
    expect(step({}, ["totp"], { factors: [] }).step).toBe("complete");
    expect(step({ totp: { verifiedAt: at() } as Factors["totp"] }, ["totp", "otpEmail"], { factors: ["otpEmail"] }).step).toBe("mfa");
  });
  it.each(["totp", "otpEmail", "otpSms"] as const)("accepts only fresh timestamped %s checks", method => {
    expect(step({ [method]: { verifiedAt: at(1_000) } }, [method]).step).toBe("complete");
    expect(step({ [method]: { verifiedAt: at(60_001) } }, [method]).step).toBe("mfa");
    expect(step({ [method]: {} }, [method]).step).toBe("mfa");
    expect(step({ [method]: { verifiedAt: at(-10_000) } }, [method]).step).toBe("mfa");
  });
  it("uses second-factor lifetime for an ordinary U2F assertion", () => {
    expect(step({ webAuthN: { verifiedAt: at(1_000), userVerified: false } as Factors["webAuthN"] }, ["u2f"]).step).toBe("complete");
    expect(step({ webAuthN: { verifiedAt: at(60_001), userVerified: false } as Factors["webAuthN"] }, ["u2f"]).step).toBe("mfa");
  });
  it("does not treat non-user-verified U2F as a primary authentication factor", () => {
    expect(() => step({ password: undefined, webAuthN: { verifiedAt: at(), userVerified: false } as Factors["webAuthN"] }, ["u2f"])).toThrow("请先完成");
  });
  it("does not authenticate a user lookup or an empty/passwordless pending challenge", () => {
    expect(() => step({ password: undefined })).toThrow("请先完成");
    expect(() => step({ password: {} as Factors["password"] })).toThrow("请先完成");
    expect(() => step({ password: undefined, intent: {} as Factors["intent"] })).toThrow("请先完成");
  });
  it("uses the native intent field as IDP proof, not a local IDP flag", () => {
    expect(step({ password: undefined, intent: { verifiedAt: at() } as Factors["intent"] }).step).toBe("complete");
    expect(step({ password: undefined, intent: { verifiedAt: at() } as Factors["intent"] }, ["totp"]).step).toBe("mfa");
  });
  it.each([
    [false, false, false, false], [true, false, false, true], [false, true, false, false], [true, true, false, false],
    [false, false, true, false], [true, false, true, true], [false, true, true, true], [true, true, true, true],
  ])("evaluates forceMfa=%s, localOnly=%s, local=%s as required=%s", (forceMfa, forceMfaLocalOnly, local, required) => {
    const factors = local ? {} : { password: undefined, intent: { verifiedAt: at() } as Factors["intent"] };
    const result = step(factors, [], { forceMfa, forceMfaLocalOnly });
    expect(result.step).toBe(required ? "mfa" : "complete");
    expect(result.needsEnrollment).toBe(required);
  });
  it("does not offer first-time enrollment to bypass an existing enrolled factor", () => {
    expect(step({}, ["totp", "totp"], { forceMfa: true })).toEqual({ step: "mfa", methods: ["totp"], needsEnrollment: false });
  });
  it("fails closed when MFA is mandatory but the policy enables no usable method", () => {
    expect(() => step({}, [], { forceMfa: true, factors: [] })).toThrow("没有可用");
  });
  it("treats an application's additional MFA requirement only as a stronger requirement", () => {
    expect(authenticationStep(native(), human(), policy, [], true).step).toBe("mfa");
  });
  it("a fresh user-verified Passkey supplies both factors in one ceremony", () => {
    expect(step({ password: undefined, webAuthN: { verifiedAt: at(), userVerified: true } as Factors["webAuthN"] }, ["totp"], { forceMfa: true }).step).toBe("complete");
  });
  it("uses the multi-factor lifetime for UV keys even if ordinary U2F is enrolled", () => {
    expect(step({ webAuthN: { verifiedAt: at(120_001), userVerified: true } as Factors["webAuthN"] }, ["u2f"], { secondFactorLifetimeMs: 600_000 }).step).toBe("mfa");
  });
  it("does not accept a fresh UV key as a second factor if neither passkey policy is enabled", () => {
    expect(step({ webAuthN: { verifiedAt: at(), userVerified: true } as Factors["webAuthN"] }, ["totp"], { passkey: false, userVerifiedKey: false, factors: ["totp"] }).step).toBe("mfa");
  });
  it("classifies a passkey-only primary login as local even after its MFA freshness expires", () => {
    expect(step({ password: undefined, webAuthN: { verifiedAt: at(120_001), userVerified: true } as Factors["webAuthN"] }, [], { forceMfa: false, forceMfaLocalOnly: true, factors: ["totp"] })).toEqual({ step: "mfa", methods: ["totp"], needsEnrollment: true });
  });
  it("zero lifetime accepts only a native check made during this login flow", () => {
    const flowStart = now.getTime() - 500;
    const zero = { ...policy, secondFactorLifetimeMs: 0 };
    const current = native({ totp: { verifiedAt: at(100) } as Factors["totp"] });
    expect(authenticationStep(current, human(), zero, ["totp"], false, flowStart).step).toBe("complete");
    vi.advanceTimersByTime(1);
    expect(authenticationStep(current, human(), zero, ["totp"], false, flowStart).step).toBe("complete");
    expect(authenticationStep(current, human(), zero, ["totp"], false, now.getTime()).step).toBe("mfa");
    expect(authenticationStep(current, human(), zero, ["totp"]).step).toBe("mfa");
  });
  it("requires password change and email verification before MFA, including UV keys", () => {
    expect(step({}, ["totp"], {}, human({ passwordChangeRequired: true })).step).toBe("password-change");
    expect(step({}, ["totp"], {}, human({ email: { isVerified: false } })).step).toBe("verify-email");
    expect(step({ webAuthN: { verifiedAt: at(), userVerified: true } as Factors["webAuthN"] }, [], {}, human({ email: { isVerified: false } })).step).toBe("verify-email");
  });
  it("does not require a local-password change after an IDP-only login", () => {
    expect(step({ password: undefined, intent: { verifiedAt: at() } as Factors["intent"] }, [], {}, human({ passwordChangeRequired: true })).step).toBe("complete");
  });
  it("does not accept machine accounts", () => {
    expect(() => step({}, [], {}, create(UserSchema, { type: { case: "machine", value: {} } }))).toThrow("此账号");
  });
  it("rejects invalid negative lifetimes rather than turning off expiration", () => {
    expect(step({ totp: { verifiedAt: at() } as Factors["totp"] }, ["totp"], { secondFactorLifetimeMs: -1 }).step).toBe("mfa");
  });
  it.each([
    { passwordLifetimeMs: 10_000 }, { passwordLifetimeMs: -1 }, { passwordLifetimeMs: 0 },
  ])("applies the live password lifetime to native primary proof: %j", overrides => {
    expect(() => step({ password: { verifiedAt: at(10_001) } as Factors["password"] }, [], overrides)).toThrow("请先完成");
  });
  it("allows a zero-lifetime password only when it was checked during the current flow", () => {
    const zero = { ...policy, passwordLifetimeMs: 0 };
    expect(authenticationStep(native(), human(), zero, [], false, now.getTime() - 1).step).toBe("complete");
    expect(() => authenticationStep(native(), human(), zero, [])).toThrow("请先完成");
  });
  it("expires external login proof independently of password and MFA policies", () => {
    expect(() => step({ password: undefined, intent: { verifiedAt: at(10_001) } as Factors["intent"] }, [], { externalLoginLifetimeMs: 10_000 })).toThrow("请先完成");
    expect(step({ password: undefined, intent: { verifiedAt: at(9_999) } as Factors["intent"] }, [], { externalLoginLifetimeMs: 10_000 }).step).toBe("complete");
  });
});

describe("native proof reuse and persistence deadlines", () => {
  function state(factors: Partial<Omit<Factors, "$typeName">> = {}, overrides: Partial<LoginPolicy> = {}): AuthenticationState {
    return { step: "complete", session: native(factors), user: human(), userId: "user-id", policy: { ...policy, ...overrides }, methods: [], needsEnrollment: false };
  }
  it("uses the stricter of password lifetime and max_age, including protobuf nanos", () => {
    const request = create(AuthRequestSchema, { maxAge: { seconds: 1n, nanos: 500_000_000 } });
    expect(canReuseAuthentication(state({ password: { verifiedAt: at(1500) } as Factors["password"] }), request)).toBe(true);
    expect(canReuseAuthentication(state({ password: { verifiedAt: at(1501) } as Factors["password"] }), request)).toBe(false);
    expect(canReuseAuthentication(state({ password: { verifiedAt: at(1001) } as Factors["password"] }, { passwordLifetimeMs: 1000 }), request)).toBe(false);
  });
  it("checks external-login and user-verified passkey freshness independently", () => {
    const external = { password: undefined, intent: { verifiedAt: at(1000) } as Factors["intent"] };
    expect(canReuseAuthentication(state(external, { externalLoginLifetimeMs: 999 }))).toBe(false);
    expect(canReuseAuthentication(state(external, { externalLoginLifetimeMs: 1001 }))).toBe(true);
    const key = { password: undefined, webAuthN: { verifiedAt: at(1000), userVerified: true } as Factors["webAuthN"] };
    expect(canReuseAuthentication(state(key, { multiFactorLifetimeMs: 999 }))).toBe(false);
    expect(canReuseAuthentication(state(key, { multiFactorLifetimeMs: 1001 }))).toBe(true);
    expect(canReuseAuthentication(state(key, { passkey: false }))).toBe(false);
    expect(canReuseAuthentication(state({ password: undefined, webAuthN: { ...key.webAuthN, userVerified: false } as Factors["webAuthN"] }))).toBe(false);
  });
  it.each([Prompt.LOGIN, Prompt.SELECT_ACCOUNT, Prompt.CREATE])("honors prompt=%s without treating it as a cookie preference", prompt => {
    expect(canReuseAuthentication(state(), create(AuthRequestSchema, { prompt: [prompt] }))).toBe(false);
  });
  it("does not force an account different from ZITADEL's hints", () => {
    expect(canReuseAuthentication(state(), create(AuthRequestSchema, { hintUserId: "other-user" }))).toBe(false);
    expect(canReuseAuthentication(state(), create(AuthRequestSchema, { loginHint: "someone-else@example.com" }))).toBe(false);
    const same = state();
    same.session.factors!.user!.loginName = "User@Example.com";
    expect(canReuseAuthentication(same, create(AuthRequestSchema, { hintUserId: "user-id", loginHint: "user@example.com" }))).toBe(true);
  });
  it("requires new proof for zero lifetimes even when the cookie remembers a completed flow", () => {
    expect(canReuseAuthentication(state({}, { passwordLifetimeMs: 0 }))).toBe(false);
    expect(canReuseAuthentication(state(), create(AuthRequestSchema, { maxAge: {} }))).toBe(false);
  });
  it("limits persistence by absolute native expiration and primary policy, never a sliding local timeout", () => {
    const current = state({ password: { verifiedAt: at(5000) } as Factors["password"] }, { passwordLifetimeMs: 60_000 });
    expect(authenticationExpiresAt(current)).toBe(now.getTime() + 55_000);
    current.session.expirationDate = at(-30_000);
    expect(authenticationExpiresAt(current)).toBe(now.getTime() + 30_000);
    vi.advanceTimersByTime(10_000);
    expect(authenticationExpiresAt(current)).toBe(now.getTime() + 30_000);
  });
  it("does not turn an MFA deadline or missing native expiration into an invented persistence duration", () => {
    expect(authenticationExpiresAt(state())).toBeUndefined();
    expect(authenticationExpiresAt(state({}, { passwordLifetimeMs: 0 }))).toBeUndefined();
    const passkey = state({ password: undefined, webAuthN: { verifiedAt: at(), userVerified: true } as Factors["webAuthN"] });
    expect(authenticationExpiresAt(passkey)).toBeUndefined();
  });
});

describe("shared account, consent and callback inspection", () => {
  const ref = { sessionId: "session-id", sessionToken: "opaque-token" };
  beforeEach(() => {
    mocks.session.mockResolvedValue(native()); mocks.user.mockResolvedValue(human()); mocks.methods.mockResolvedValue(["totp"]); mocks.policy.mockResolvedValue(policy);
  });
  it("reads the actual session, user's organization policy and READY methods every time", async () => {
    expect((await inspectAuthentication(ref, "user-id")).step).toBe("mfa");
    expect(mocks.session).toHaveBeenCalledWith(ref);
    expect(mocks.user).toHaveBeenCalledWith("user-id");
    expect(mocks.policy).toHaveBeenCalledWith("user-org");
    expect(mocks.methods).toHaveBeenCalledWith("user-id");
    mocks.session.mockResolvedValue(native({ totp: { verifiedAt: at() } as Factors["totp"] }));
    expect((await inspectAuthentication(ref, "user-id")).step).toBe("complete");
    expect(mocks.policy).toHaveBeenCalledTimes(2);
  });
  it("rejects a native user different from the cookie's expected user", async () => {
    await expect(inspectAuthentication(ref, "someone-else")).rejects.toThrow("登录账号已变化");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects an expired native session even if the cookie and primary factor still look valid", async () => {
    mocks.session.mockResolvedValue({ ...native(), expirationDate: at(1) });
    await expect(inspectAuthentication(ref, "user-id")).rejects.toThrow("会话已失效");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects a user lookup that does not match the native session user", async () => {
    mocks.user.mockResolvedValue({ ...human(), userId: "different-user" });
    await expect(inspectAuthentication(ref, "user-id")).rejects.toThrow("不匹配");
  });
  it.each(["session", "user", "policy", "methods"] as const)("does not allow login when %s cannot be read", async method => {
    mocks[method].mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(inspectAuthentication(ref, "user-id")).rejects.toThrow("upstream unavailable");
  });
});
