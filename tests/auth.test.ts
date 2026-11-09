import { describe, expect, it } from "vitest";
import { authContext, authLink, loginSchema, passwordMeetsPolicy, registerSchema, resetPasswordSchema, verifyTotpSchema } from "@/lib/auth";
const passwordPolicy = { minLength: 10, uppercase: true, lowercase: true, number: true, symbol: true };
describe("form contracts", () => {
  it("trims login names without altering passwords", () => {
    expect(loginSchema.parse({ loginName: "  cat  ", password: " secret " })).toEqual({ loginName: "cat", password: " secret " });
  });
  it("validates email and matching passwords", () => {
    const input = { givenName: "小猫", familyName: "同学", email: "cat@example.com", password: "longpassword", confirmPassword: "different" };
    expect(registerSchema.safeParse(input).success).toBe(false);
    expect(registerSchema.safeParse({ ...input, email: "invalid", confirmPassword: "longpassword" }).success).toBe(false);
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
