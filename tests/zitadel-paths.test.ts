import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addHumanUser: vi.fn(), passwordReset: vi.fn(), resendEmailCode: vi.fn(), startIdentityProviderIntent: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com" }) }));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: () => ({ user: mocks }) }));
import { zitadel } from "@/server/zitadel/service";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.addHumanUser.mockResolvedValue({ userId: "user-id" });
  mocks.startIdentityProviderIntent.mockResolvedValue({ nextStep: { case: "authUrl", value: "https://provider.example.com/authorize" } });
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["", "/auth", "/account/login-ui"])("ZITADEL callback URLs with base path '%s'", basePath => {
  beforeEach(() => vi.stubEnv("BASE_PATH", basePath || "/"));

  it("includes the base path in registration and resent verification emails", async () => {
    await zitadel.register({ givenName: "Test", familyName: "Account", email: "test@example.com", password: "password", confirmPassword: "password" }, undefined, "V2_a&b");
    const template = `https://login.example.com${basePath}/verify-email?authRequest=V2_a%26b&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}`;
    expect(mocks.addHumanUser).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({ verification: { case: "sendCode", value: { urlTemplate: template } } }),
    }));
    await zitadel.sendEmailCode("user-id", "V2_a&b");
    expect(mocks.resendEmailCode).toHaveBeenCalledWith({ userId: "user-id", verification: { case: "sendCode", value: { urlTemplate: template } } });
  });

  it("includes the base path in password-reset emails", async () => {
    await zitadel.requestPasswordReset("user-id");
    expect(mocks.passwordReset).toHaveBeenCalledWith(expect.objectContaining({
      medium: { case: "sendLink", value: expect.objectContaining({ urlTemplate: `https://login.example.com${basePath}/reset-password?userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}` }) },
    }));
  });

  it("includes the base path in identity-provider success and failure URLs", async () => {
    const result = await zitadel.startIdp("provider-id", "state-value");
    expect(mocks.startIdentityProviderIntent).toHaveBeenCalledWith({
      idpId: "provider-id", content: { case: "urls", value: {
        successUrl: `https://login.example.com${basePath}/idp/callback?state=state-value`,
        failureUrl: `https://login.example.com${basePath}/idp/callback?state=state-value&failed=1`,
      } },
    });
    expect(result.nextStep).toEqual({ case: "authUrl", value: "https://provider.example.com/authorize" });
  });
});
