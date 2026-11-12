import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "@bufbuild/protobuf";
import { LoginSettingsSchema } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb.js";
import { PasswordComplexitySettingsSchema } from "@zitadel/proto/zitadel/settings/v2/password_settings_pb.js";

const mocks = vi.hoisted(() => ({ loginSettings: vi.fn(), passwordSettings: vi.fn(), authRequest: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ organizationId: undefined }) }));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: () => ({
  settings: { getLoginSettings: mocks.loginSettings, getPasswordComplexitySettings: mocks.passwordSettings },
  oidc: { getAuthRequest: mocks.authRequest },
}) }));
vi.mock("@/server/actions", () => ({
  beginFactor: vi.fn(), chooseIdentityProvider: vi.fn(), startPasskey: vi.fn(), finishPasskey: vi.fn(),
  finishTotpEnrollment: vi.fn(), login: vi.fn(), register: vi.fn(), requestPasswordReset: vi.fn(),
  resendEmail: vi.fn(), resetPassword: vi.fn(), startTotpEnrollment: vi.fn(), verifyEmail: vi.fn(), verifyFactor: vi.fn(),
}));

import { LoginForm } from "@/components/auth/forms";
import { BrandProvider } from "@/components/auth/brand-provider";
import { defaultBrand } from "@/lib/brand";
import { zitadel } from "@/server/zitadel/service";
import RegisterPage from "@/app/(auth)/register/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loginSettings.mockResolvedValue({ settings: create(LoginSettingsSchema, { allowRegister: true, allowUsernamePassword: true }) });
  mocks.passwordSettings.mockResolvedValue({ settings: create(PasswordComplexitySettingsSchema, { minLength: 12n, requiresNumber: true }) });
  mocks.authRequest.mockResolvedValue({ authRequest: { id: "V2_test", scope: ["urn:zitadel:iam:org:id:org-id"] } });
});

const cases = [
  { allowRegister: true, allowUsernamePassword: true, enabled: true },
  { allowRegister: false, allowUsernamePassword: true, enabled: false },
  { allowRegister: true, allowUsernamePassword: false, enabled: false },
  { allowRegister: false, allowUsernamePassword: false, enabled: false },
];

describe("registration follows the live ZITADEL policy", () => {
  it.each([{}, { authRequestId: "V2_test" }])("keeps the login button and removes the extra flow note for %j", async context => {
    const policy = await zitadel.policy();
    const html = renderToStaticMarkup(<LoginForm context={context} policy={policy} />);
    expect(html).toMatch(/<button\b[^>]*type="submit"[^>]*>登录<\/button>/);
    expect(html).not.toContain("登录并继续");
    expect(html).not.toContain("登录后继续访问你的应用");
    expect(html).not.toContain("flow-note");
  });

  it("reads instance settings when no organization is specified", async () => {
    expect((await zitadel.policy()).registration).toBe(true);
    expect(mocks.loginSettings).toHaveBeenCalledWith({ ctx: expect.objectContaining({ resourceOwner: { case: "instance", value: true } }) });
  });

  it.each(cases)("shows the signup link only when password registration is enabled: %j", async ({ allowRegister, allowUsernamePassword, enabled }) => {
    mocks.loginSettings.mockResolvedValue({ settings: create(LoginSettingsSchema, { allowRegister, allowUsernamePassword }) });
    const policy = await zitadel.policy();
    const html = renderToStaticMarkup(<BrandProvider brand={defaultBrand} basePath="/auth">
      <LoginForm context={{ authRequestId: "V2_a&b=c" }} policy={policy} />
    </BrandProvider>);
    expect(policy.registration).toBe(allowRegister);
    if (enabled) {
      expect(html).toContain("还没有账号？");
      expect(html).toContain('href="/auth/register?authRequest=V2_a%26b%3Dc"');
      expect(html).toContain("创建账号</a>");
    } else {
      expect(html).not.toContain("还没有账号？");
      expect(html).not.toContain("/register");
    }
  });

  it.each(cases)("also protects direct visits to the registration page: %j", async ({ allowRegister, allowUsernamePassword, enabled }) => {
    mocks.loginSettings.mockResolvedValue({ settings: create(LoginSettingsSchema, { allowRegister, allowUsernamePassword }) });
    const page = await RegisterPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) });
    const html = renderToStaticMarkup(page);
    expect(mocks.loginSettings).toHaveBeenCalledWith({ ctx: expect.objectContaining({ resourceOwner: { case: "orgId", value: "org-id" } }) });
    expect(html).toContain('href="/login?authRequest=V2_test"');
    expect(html).not.toContain('class="back-link"');
    expect(html).not.toContain("←");
    if (enabled) {
      expect(html).toContain('name="username"');
      expect(html).toContain('name="email"');
      expect(html).toContain('name="confirmPassword"');
      expect(html).toContain("密码至少 12 个字符，需包含数字。");
      for (const name of ["givenName", "familyName", "nickName"]) expect(html).not.toContain(`name="${name}"`);
    } else {
      expect(html).toContain("当前未开放密码账号注册。");
      expect(html).not.toContain("<form");
      expect(html).not.toContain('type="submit"');
    }
  });

  it("does not enable registration when ZITADEL omits login settings", async () => {
    mocks.loginSettings.mockResolvedValue({});
    await expect(zitadel.policy()).rejects.toThrow("ZITADEL settings are missing");
  });
});
