import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Factor, LoginPolicy } from "@/lib/auth";

const actions = vi.hoisted(() => ({
  beginFactor: vi.fn(), changeLoginPassword: vi.fn(), enrollOtpFactor: vi.fn(), finishKeyEnrollment: vi.fn(),
  finishTotpEnrollment: vi.fn(), finishWebAuthnFactor: vi.fn(), resendLoginEmail: vi.fn(), resumeAuthentication: vi.fn(),
  setEnrollmentPhone: vi.fn(), startKeyEnrollment: vi.fn(), startTotpEnrollment: vi.fn(), verifyEnrollmentPhone: vi.fn(),
  verifyFactor: vi.fn(), verifyLoginEmail: vi.fn(),
}));
const webauthn = vi.hoisted(() => ({ authenticate: vi.fn(), register: vi.fn() }));
vi.mock("@/server/actions", () => actions);
vi.mock("@/lib/webauthn", () => webauthn);

import {
  ContinueAuthenticationForm, LoginEmailVerificationForm, LoginPasswordChangeForm,
  MfaEnrollmentForm, MfaVerificationForm,
} from "@/components/auth/mfa-forms";
import { BrandProvider } from "@/components/auth/brand-provider";

const context = { authRequestId: "V2_a&b=c", userId: "user-id", code: "001234" };
const methods: Factor[] = ["totp", "passkey", "u2f", "otpEmail", "otpSms"];
const policy: LoginPolicy = {
  password: true, registration: true, passwordReset: true, passkey: true,
  forceMfa: true, forceMfaLocalOnly: false, factors: methods, userVerifiedKey: false,
  passwordPolicy: { minLength: 12, uppercase: true, lowercase: true, number: true, symbol: true }, identityProviders: [],
};
function render(children: ReactNode) {
  return renderToStaticMarkup(<BrandProvider brand={{ nickname: "账号中心" }} basePath="/id">{children}</BrandProvider>);
}
function input(html: string, name: string) {
  return html.match(new RegExp(`<input\\b[^>]*name="${name}"[^>]*>`))?.[0] || "";
}
beforeEach(() => vi.clearAllMocks());

describe("MFA client form rendering", () => {
  it("offers all five policy-provided factors in verification and enrollment", () => {
    for (const Component of [MfaVerificationForm, MfaEnrollmentForm]) {
      const html = render(<Component context={context} methods={methods} />);
      for (const method of methods) expect(html).toContain(`value="${method}"`);
      for (const label of ["验证器动态码", "通行密钥（Passkey）", "安全密钥（U2F）", "邮件验证码", "短信验证码"]) expect(html).toContain(label);
      expect(html.match(/<option\b/g)).toHaveLength(5);
    }
  });

  it("renders a directly available TOTP challenge with a six-digit text field", () => {
    const html = render(<MfaVerificationForm context={context} methods={["totp"]} />);
    expect(html).toContain("打开已绑定的验证器");
    expect(html).toContain("验证并继续");
    expect(input(html, "code")).toContain('inputMode="numeric"');
    expect(input(html, "code")).toContain('maxLength="6"');
    expect(input(html, "code")).not.toContain("disabled");
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain("发送验证码");
  });

  it.each(["otpEmail", "otpSms"] as const)("requires explicit sending for %s instead of starting on render", method => {
    const html = render(<MfaVerificationForm context={context} methods={[method]} />);
    expect(html).toContain(method === "otpSms" ? "发送短信验证码" : "发送邮件验证码");
    expect(html).toContain("请先发送验证码");
    expect(input(html, "code")).toContain("disabled");
    expect(html.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]).toContain("disabled");
    expect(actions.beginFactor).not.toHaveBeenCalled();
  });

  it.each(["passkey", "u2f"] as const)("renders %s verification without exposing a code field", method => {
    const html = render(<MfaVerificationForm context={context} methods={[method]} />);
    expect(html).toContain("开始验证");
    expect(html).toContain(method === "passkey" ? "通行密钥（Passkey）" : "安全密钥（U2F）");
    expect(html).not.toContain('name="code"');
    expect(webauthn.authenticate).not.toHaveBeenCalled();
  });

  it("starts TOTP enrollment explicitly without generating secrets during render", () => {
    const html = render(<MfaEnrollmentForm context={context} methods={["totp"]} />);
    expect(html).toContain("获取验证器密钥");
    expect(html).not.toContain("otpauth://");
    expect(actions.startTotpEnrollment).not.toHaveBeenCalled();
  });

  it.each(["passkey", "u2f"] as const)("limits the %s device name to the action's 100-character contract", method => {
    const html = render(<MfaEnrollmentForm context={context} methods={[method]} />);
    expect(html).toContain("设备名称");
    expect(input(html, "name")).toContain('maxLength="100"');
    expect(html).toContain("准备绑定设备");
    expect(html).toContain("还需使用它完成本次登录验证");
    expect(webauthn.register).not.toHaveBeenCalled();
  });

  it("supports setting and verifying a phone before enabling SMS OTP", () => {
    const html = render(<MfaEnrollmentForm context={context} methods={["otpSms"]} />);
    expect(input(html, "phone")).toContain('type="tel"');
    expect(html).toContain("+8613800138000");
    expect(html).toContain("发送手机验证短信");
    expect(html).toContain("先发送短信并验证手机号码");
    expect(html).toContain("启用短信验证码并继续");
    expect(html).toContain("已有已验证的手机号码可以直接启用");
    expect(actions.setEnrollmentPhone).not.toHaveBeenCalled();
  });

  it("enables email OTP separately from sending a login challenge", () => {
    const html = render(<MfaEnrollmentForm context={context} methods={["otpEmail"]} />);
    expect(html).toContain("启用邮件验证码并继续");
    expect(html).not.toContain('name="phone"');
    expect(html).not.toContain('name="code"');
  });

  it.each([MfaVerificationForm, MfaEnrollmentForm])("handles an empty factor list without guessing an allowed method", Component => {
    const html = render(<Component context={context} methods={[]} />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  });

  it("keeps the runtime base path and only forwards the auth request to login", () => {
    const html = render(<MfaVerificationForm context={context} methods={["totp"]} />);
    expect(html).toContain('href="/id/login?authRequest=V2_a%26b%3Dc"');
    expect(html).not.toContain("user-id");
    expect(html).not.toContain("code=001234");
  });
});

describe("login continuation forms", () => {
  it("prefills a login email code and provides explicit mail sending", () => {
    const html = render(<LoginEmailVerificationForm context={context} />);
    expect(input(html, "code")).toContain('value="001234"');
    expect(input(html, "code")).toContain('autoComplete="one-time-code"');
    expect(html).toContain("发送验证邮件");
    expect(html).toContain("验证邮箱并继续");
  });

  it("changes a password with confirmation and the live policy hint", () => {
    const html = render(<LoginPasswordChangeForm context={context} policy={policy} />);
    expect(html).toContain("至少 12 个字符 · 大写字母 · 小写字母 · 数字 · 特殊字符");
    expect(input(html, "password")).toContain('autoComplete="new-password"');
    expect(input(html, "confirmPassword")).toContain('type="password"');
    expect(html).toContain("更新密码并继续");
  });

  it("asks the server to continue rather than declaring authentication complete", () => {
    const html = render(<ContinueAuthenticationForm context={context} />);
    expect(html).toContain("继续登录");
    expect(html).toContain("下一步由账号服务确认");
    expect(html).not.toContain("登录成功");
    expect(actions.resumeAuthentication).not.toHaveBeenCalled();
  });

  it("does not add personal-name fields or perform any action during rendering", () => {
    const html = render(<>
      <MfaVerificationForm context={context} methods={methods} />
      <MfaEnrollmentForm context={context} methods={methods} />
      <LoginEmailVerificationForm context={context} />
      <LoginPasswordChangeForm context={context} policy={policy} />
      <ContinueAuthenticationForm context={context} />
    </>);
    for (const name of ["givenName", "familyName", "firstName", "lastName"]) expect(html).not.toContain(`name="${name}"`);
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    for (const helper of Object.values(webauthn)) expect(helper).not.toHaveBeenCalled();
  });
});
