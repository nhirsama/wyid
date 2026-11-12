import { describe, expect, it } from "vitest";
import { accountRoute, decodeAccountSegments, isAccountRoute } from "@/lib/account/routes";

describe("shared portal navigation boundary", () => {
  it.each(["", "/id", "/account/login-ui", "/account"])("resolves only portal pages under BASE_PATH=%s", basePath => {
    for (const route of ["/apps", "/apps/new", "/settings/profile", "/settings/security", "/settings/devices", "/help", "/apps/project:app"]) {
      expect(isAccountRoute(route)).toBe(true);
      expect(accountRoute(`${basePath}/account${route}`, basePath)).toBe(route);
    }
    expect(accountRoute(`${basePath}/account/apps/project%3Aapp`, basePath)).toBe("/apps/project:app");
    for (const route of ["/login", "/account", "/account/settings/unknown", "/account/apps/project%253Aapp", "/account/apps/%2e%2e", "/account/apps/%ZZ", "/account/apps/project%2Fapp", "/accounting/help"]) {
      expect(accountRoute(`${basePath}${route}`, basePath)).toBeNull();
    }
  });
  it("does not intercept URLs outside the configured subpath", () => {
    expect(accountRoute("/account/apps", "/id")).toBeNull();
    expect(accountRoute("/identity/account/apps", "/id")).toBeNull();
  });
});

describe("native application IDs in catch-all routes", () => {
  it.each(["project:app", "project%3Aapp"])("normalizes a native resource pair exactly once: %s", id => {
    expect(decodeAccountSegments(["apps", id])).toEqual(["apps", "project:app"]);
  });
  it.each(["%2Fapps", "%5Capps", "%00", "%0A", "%ZZ", ".", "..", "%2e%2e"])("rejects unsafe segments: %s", value => {
    expect(() => decodeAccountSegments(["apps", value])).toThrow();
  });
  it("does not recursively decode double-encoded resource IDs", () => {
    expect(decodeAccountSegments(["apps", "project%253Aapp"])).toEqual(["apps", "project%3Aapp"]);
  });
});
