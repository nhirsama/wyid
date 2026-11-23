import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ organizationForAuth: vi.fn(), organizationForUser: vi.fn(), policy: vi.fn() }));
vi.mock("@/server/zitadel/service", () => ({
  zitadel: {
    organizationForAuth: mocks.organizationForAuth,
    organizationForUser: mocks.organizationForUser,
    policy: mocks.policy,
  },
}));
vi.mock("@/server/actions", () => ({
  chooseIdentityProvider: vi.fn(), login: vi.fn(), register: vi.fn(), requestPasswordReset: vi.fn(),
  resendEmail: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn(), startPasskey: vi.fn(), finishPasskey: vi.fn(),
}));

import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import { VerifyEmailForm } from "@/components/auth/forms";
import { TotpSetup } from "@/components/ui/totp-setup";

const enabledPolicy = {
  password: true, registration: true, passwordReset: true, passkey: true,
  forceMfa: false, forceMfaLocalOnly: false, factors: [], userVerifiedKey: false, identityProviders: [],
  passwordPolicy: { minLength: 8, uppercase: false, lowercase: false, number: false, symbol: false },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.organizationForAuth.mockResolvedValue("org-id");
  mocks.organizationForUser.mockResolvedValue("org-id");
  mocks.policy.mockResolvedValue(enabledPolicy);
});

describe("auth recovery pages and shared TOTP setup", () => {
  it("keeps a back-to-login link on forgot-password for enabled, disabled, and failed states", async () => {
    const enabledHtml = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) }));
    expect(enabledHtml).toContain("发送重置邮件");
    expect(enabledHtml).toContain('href="/login?authRequest=V2_test"');
    expect(enabledHtml).toContain("返回登录");

    mocks.policy.mockResolvedValueOnce({ ...enabledPolicy, passwordReset: false });
    const disabledHtml = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) }));
    expect(disabledHtml).toContain("此组织当前未开放密码重置。");
    expect(disabledHtml).toContain('href="/login?authRequest=V2_test"');

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.policy.mockRejectedValueOnce({ code: 14 });
      const failedHtml = renderToStaticMarkup(await ForgotPasswordPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) }));
      expect(failedHtml).toContain('role="alert"');
      expect(failedHtml).toContain("重新加载");
      expect(failedHtml).toContain('href="/forgot-password?authRequest=V2_test"');
      expect(failedHtml).toContain('href="/login?authRequest=V2_test"');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("handles missing userId, disabled policy, and upstream failure gracefully on reset-password", async () => {
    const missingHtml = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) }));
    expect(missingHtml).toContain("请从密码重置邮件中的链接打开此页面。");
    expect(missingHtml).toContain('href="/login?authRequest=V2_test"');
    expect(mocks.policy).not.toHaveBeenCalled();

    const enabledHtml = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({ userId: "u1", authRequest: "V2_test" }) }));
    expect(enabledHtml).toContain("保存新密码");
    expect(enabledHtml).toContain('href="/login?authRequest=V2_test"');

    mocks.policy.mockResolvedValueOnce({ ...enabledPolicy, passwordReset: false });
    const disabledHtml = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({ userId: "u1", authRequest: "V2_test" }) }));
    expect(disabledHtml).toContain("此组织当前未开放密码重置。");
    expect(disabledHtml).toContain('href="/login?authRequest=V2_test"');

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.policy.mockRejectedValueOnce({ code: 14 });
      const failedHtml = renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve({ userId: "u1", authRequest: "V2_test" }) }));
      expect(failedHtml).toContain('role="alert"');
      expect(failedHtml).toContain("重新加载");
      expect(failedHtml).toContain('href="/login?authRequest=V2_test"');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("renders a back-to-login link on verify-email", () => {
    const html = renderToStaticMarkup(<VerifyEmailForm context={{ userId: "u1", authRequestId: "V2_test" }} />);
    expect(html).toContain("重新发送验证邮件");
    expect(html).toContain('href="/login?authRequest=V2_test"');
    expect(html).toContain("返回登录");
  });

  it("renders a QR code and non-submitting copy/reveal buttons in shared TotpSetup", () => {
    const html = renderToStaticMarkup(<TotpSetup secret="JBSWY3DPEHPK3PXP" uri="otpauth://totp/WY:user?secret=JBSWY3DPEHPK3PXP" />);
    expect(html).toContain("TOTP 验证器绑定二维码");
    expect(html).toContain("<svg");
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const [button] of buttons) expect(button).toContain('type="button"');
  });
});
