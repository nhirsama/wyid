import { describe, expect, it } from "vitest";
import { authContext, authLink, loginSchema, passwordMeetsPolicy, registerSchema, resetPasswordSchema, verifyTotpSchema } from "@/lib/auth";
import { consentScopes } from "@/lib/consent";
const passwordPolicy = { minLength: 10, uppercase: true, lowercase: true, number: true, symbol: true };
describe("form contracts", () => {
  it("trims login names without altering passwords", () => {
    expect(loginSchema.parse({ loginName: "  cat  ", password: " secret " })).toEqual({ loginName: "cat", password: " secret " });
  });
  it("validates email and matching passwords", () => {
    const input = { username: "小猫", email: "cat@example.com", password: "longpassword", confirmPassword: "different" };
    expect(registerSchema.safeParse(input).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, email: "invalid", confirmPassword: "longpassword" }).success).toBe(false);
  });
  it("registers with just a username instead of separate given and family names", () => {
    const input = { username: "  小猫  ", email: "cat@example.com", password: "longpassword", confirmPassword: "longpassword" };
    expect(registerSchema.parse(input)).toEqual({ ...input, username: "小猫" });
    expect(registerSchema.safeParse({ ...input, username: "   " }).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, username: "x".repeat(101) }).success).toBe(false);
  });
  it("preserves leading zeroes in TOTP codes", () => {
    expect(verifyTotpSchema.parse({ code: "001234" }).code).toBe("001234");
    expect(verifyTotpSchema.safeParse({ code: "12345" }).success).toBe(false);
  });
  it("validates passwords from the live complexity policy", () => {
    expect(passwordMeetsPolicy("LongPass123!", passwordPolicy)).toBe(true);
    expect(passwordMeetsPolicy("short", passwordPolicy)).toBe(false);
  });
  it("requires reset tokens and matching password confirmation", () => {
    expect(resetPasswordSchema.safeParse({ password: "new-pass", confirmPassword: "new-pass", code: "" }).success).toBe(false);
  });
});
describe("authorization navigation", () => {
  it("preserves only the ZITADEL AuthRequest ID", () => {
    expect(authLink("/register", { authRequestId: "V2_a&b=c" })).toBe("/register?authRequest=V2_a%26b%3Dc");
    expect(authContext({ authRequestId: "V2_123" }).authRequestId).toBe("V2_123");
  });
  it("accepts upstream user ID casing and bounds callback values", () => {
    expect(authContext({ userID: "user-id", code: "x".repeat(400) })).toEqual({ userId: "user-id", code: "x".repeat(256), authRequestId: undefined, loginHint: undefined });
  });
  it("does not forward arbitrary redirects or repeated query values", () => {
    const context = authContext({ returnTo: "https://example.org", sessionToken: "secret", authRequest: ["one", "two"] });
    expect(authLink("/login", context)).toBe("/login");
  });
});
describe("OAuth consent scopes", () => {
  it("deduplicates known scopes and safely labels unknown scopes", () => {
    expect(consentScopes(["openid", "profile", "custom:read", "openid"])).toEqual([
      { scope: "openid", name: "账号标识", description: "用于在该网站识别你的账号。" },
      { scope: "profile", name: "基本资料", description: "昵称、姓名、头像及其他基本资料。" },
      { scope: "custom:read", name: "其他请求权限", description: "此网站请求的额外权限。" },
    ]);
  });
});
