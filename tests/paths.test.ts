import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeBasePath, siteUrl, withBasePath } from "@/lib/paths";
import { authLink } from "@/lib/auth";
import { getBrand } from "@/server/brand";
import { withRuntimeBasePath } from "../scripts/runtime-config.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("base path configuration", () => {
  it.each([["", ""], ["/auth", "/auth"], ["/account/login-ui", "/account/login-ui"]])("sets both Next runtime prefixes for %s", (basePath, expected) => {
    const buildConfig = { basePath: "", assetPrefix: "", poweredByHeader: false };
    const runtimeConfig = withRuntimeBasePath(buildConfig, basePath);
    expect(runtimeConfig).toMatchObject({ basePath: expected, assetPrefix: expected });
    expect(buildConfig).toMatchObject({ basePath: "", assetPrefix: "" });
  });

  it.each([[undefined, ""], ["/", ""], ["/auth/", "/auth"], ["/account/login-ui", "/account/login-ui"]])("keeps the build reusable for runtime BASE_PATH=%s", async (value, expected) => {
    vi.stubEnv("BASE_PATH", value);
    vi.resetModules();
    const { default: config } = await import("../next.config");
    expect(config("phase-production-build").basePath).toBe("");
    expect(config("phase-development-server").basePath).toBe(expected);
    expect(normalizeBasePath(value)).toBe(expected);
  });

  it.each([undefined, "", "/", " / "])("keeps %s at the site root", value => {
    expect(normalizeBasePath(value)).toBe("");
  });

  it.each(["/auth", "/auth/", "/account/login-ui/"])("normalizes %s", value => {
    expect(normalizeBasePath(value)).toBe(value.replace(/\/+$/, ""));
  });

  it.each(["auth", "//other.example", "https://other.example/auth", "/a//b", "/a/../b", "/./auth", "/auth?x=1", "/auth#top", "/a\\b", "/%2e%2e", "/a b"])("rejects invalid base path %s", value => {
    expect(() => normalizeBasePath(value)).toThrow("BASE_PATH");
  });

  it("keeps existing URLs unchanged when BASE_PATH is /", () => {
    vi.stubEnv("BASE_PATH", "/");
    expect(withBasePath("/login?authRequest=V2_test#form")).toBe("/login?authRequest=V2_test#form");
    expect(siteUrl("/idp/callback", "https://login.example.com").href).toBe("https://login.example.com/idp/callback");
  });

  it("prefixes raw browser navigation while leaving Next.js links app-relative", () => {
    vi.stubEnv("BASE_PATH", "/auth");
    for (const route of ["/login", "/account", "/verify", "/verify-email", "/idp/confirm"]) {
      expect(withBasePath(`${route}?authRequest=V2_test`)).toBe(`/auth${route}?authRequest=V2_test`);
    }
    expect(authLink("/register", { authRequestId: "V2_a&b" })).toBe("/register?authRequest=V2_a%26b");
  });

  it("does not change external callbacks, identity providers or same-page anchors", () => {
    vi.stubEnv("BASE_PATH", "/auth");
    for (const target of ["https://app.example.com/callback?code=x", "https://provider.example.com/authorize", "//cdn.example.com/icon.svg", "#main-content"]) {
      expect(withBasePath(target)).toBe(target);
    }
    expect(siteUrl("https://app.example.com/callback?code=x", "https://login.example.com").href).toBe("https://app.example.com/callback?code=x");
  });

  it("resolves local brand icons under the base path without changing remote icons", () => {
    vi.stubEnv("BASE_PATH", "/auth");
    vi.stubEnv("SITE_ICON", "/icon.svg");
    expect(getBrand().icon).toBe("/auth/icon.svg");
    vi.stubEnv("SITE_ICON", "https://cdn.example.com/icon.svg");
    expect(getBrand().icon).toBe("https://cdn.example.com/icon.svg");
    vi.stubEnv("SITE_ICON", "");
    expect(getBrand().icon).toBeUndefined();
  });
});
