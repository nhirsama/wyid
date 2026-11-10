import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "@bufbuild/protobuf";
import { AuthRequestSchema } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { UserSchema } from "@zitadel/proto/zitadel/user/v2/user_pb.js";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), pending: vi.fn(), authenticated: vi.fn(), request: vi.fn(), write: vi.fn() }));
vi.mock("@/server/authentication", () => ({ inspectAuthentication: mocks.inspect }));
vi.mock("@/server/session", () => ({ readPendingSession: mocks.pending, readAuthenticatedSession: mocks.authenticated, writePendingSession: mocks.write, writeAuthenticatedSession: mocks.write }));
vi.mock("@/server/actions", () => ({ logout: vi.fn(), resumeAccountAuthentication: vi.fn() }));
vi.mock("@/server/brand", () => ({ getBrand: () => ({ nickname: "Test ID" }) }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ sessionSecret: "a-test-secret-that-is-at-least-32-characters" }) }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: { authRequest: mocks.request, applicationName: async () => "Test App" } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));
vi.mock("@/components/auth/mfa-forms", () => ({
  MfaEnrollmentForm: ({ methods }: { methods: string[] }) => <div>enroll:{methods.join(",")}</div>,
  MfaVerificationForm: ({ methods }: { methods: string[] }) => <div>verify:{methods.join(",")}</div>,
  ContinueAuthenticationForm: () => <div>continue-authentication</div>,
  LoginEmailVerificationForm: () => <div>verify-email</div>,
  LoginPasswordChangeForm: () => <div>password-change</div>,
}));
vi.mock("@/components/auth/consent-form", () => ({ ConsentForm: () => <div>consent-form</div> }));
import VerifyPage from "@/app/(auth)/verify/page";
import ConsentPage from "@/app/(auth)/consent/page";
import AccountPage from "@/app/(auth)/account/page";

const pending = { authRequestId: "V2_test", sessionId: "session-id", sessionToken: "session-token", userId: "user-id", methods: [] };
const searchParams = Promise.resolve({ authRequest: "V2_test" });
const user = create(UserSchema, { userId: "user-id", username: "test-user", type: { case: "human", value: { email: { email: "test@example.com", isVerified: true } } } });
function state(step = "mfa", extra = {}) {
  return { step, userId: "user-id", user, session: {}, policy: {}, methods: ["totp"], needsEnrollment: false, ...extra };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending.mockResolvedValue(pending);
  mocks.authenticated.mockResolvedValue({ sessionId: pending.sessionId, sessionToken: pending.sessionToken, userId: pending.userId });
  mocks.inspect.mockResolvedValue(state());
  mocks.request.mockResolvedValue(create(AuthRequestSchema, { id: "V2_test", clientId: "test-client", redirectUri: "https://app.example.com/callback", scope: ["openid"] }));
});

describe("verification route trusts the live gate instead of cookie method flags", () => {
  it.each([undefined, "V2_test"])("matches the reference verification heading without a domain for authRequest=%s", async authRequestId => {
    mocks.pending.mockResolvedValue({ ...pending, authRequestId });
    const html = renderToStaticMarkup(await VerifyPage({ searchParams: Promise.resolve({ authRequest: authRequestId }) }));
    expect(html).toContain("继续登录");
    expect(html).toContain(authRequestId ? "Test App" : "Test ID");
    expect(html).not.toContain("app.example.com");
    expect(mocks.request).toHaveBeenCalledTimes(authRequestId ? 1 : 0);
    expect(mocks.inspect).toHaveBeenCalled();
  });

  it.each([
    ["mfa", false, "verify:totp"], ["mfa", true, "enroll:totp"],
    ["verify-email", false, "verify-email"], ["password-change", false, "password-change"],
    ["complete", false, "continue-authentication"],
  ])("renders %s, enrollment=%s as %s", async (step, needsEnrollment, expected) => {
    mocks.inspect.mockResolvedValue(state(step, { needsEnrollment }));
    const html = renderToStaticMarkup(await VerifyPage({ searchParams }));
    expect(html).toContain(expected);
    expect(mocks.inspect).toHaveBeenCalledWith(pending, "user-id", undefined);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not complete or consume a login on GET even if authentication is complete", async () => {
    mocks.inspect.mockResolvedValue(state("complete"));
    expect(renderToStaticMarkup(await VerifyPage({ searchParams }))).toContain("continue-authentication");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not read credentials for a different authorization request", async () => {
    expect(renderToStaticMarkup(await VerifyPage({ searchParams: Promise.resolve({ authRequest: "other-request" }) }))).toContain("登录验证会话不可用");
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("does not show a success or enrollment UI when upstream inspection fails", async () => {
    mocks.inspect.mockRejectedValueOnce(new Error("unavailable"));
    expect(renderToStaticMarkup(await VerifyPage({ searchParams }))).toContain("登录验证会话不可用");
  });
});

describe("consent page rechecks authentication", () => {
  it.each(["mfa", "verify-email", "password-change"])("redirects an incomplete %s even when cookie methods is empty", async step => {
    mocks.inspect.mockResolvedValue(state(step));
    await expect(ConsentPage({ searchParams })).rejects.toThrow("NEXT_REDIRECT:/verify?authRequest=V2_test");
  });
  it("shows consent only after the native authentication gate is complete", async () => {
    mocks.inspect.mockResolvedValue(state("complete"));
    const html = renderToStaticMarkup(await ConsentPage({ searchParams }));
    expect(html).toContain("consent-form");
    expect(html).toContain("Test App");
    expect(html).not.toContain("app.example.com");
    expect(html).not.toContain("app-host");
  });
  it("does not show consent when native authentication cannot be inspected", async () => {
    mocks.inspect.mockRejectedValueOnce(new Error("unavailable"));
    const html = renderToStaticMarkup(await ConsentPage({ searchParams }));
    expect(html).not.toContain("consent-form");
    expect(html).toContain("授权请求不可用");
  });
});

describe("account portal does not treat an old authenticated cookie as proof", () => {
  it.each(["mfa", "verify-email", "password-change"])("hides the success screen for %s", async step => {
    mocks.inspect.mockResolvedValue(state(step));
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("继续身份验证");
    expect(html).not.toContain("已通过");
    expect(html).not.toContain("当前账号");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("shows the logged-in account only after all native checks pass", async () => {
    mocks.inspect.mockResolvedValue(state("complete"));
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("当前账号：");
    expect(html).toContain("test-user");
  });
  it("returns to the existing login instead of adding a failure page when inspection fails", async () => {
    mocks.inspect.mockRejectedValueOnce(new Error("unavailable"));
    await expect(AccountPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
