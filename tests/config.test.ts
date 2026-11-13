import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigurationError, getAppUrl, getConfig, zitadelRequestHeaders } from "@/server/config";

let tempDirectory: string | undefined;
beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000"); vi.stubEnv("ZITADEL_API_URL", "https://id.example.com");
  vi.stubEnv("ZITADEL_SERVICE_TOKEN", "server-secret-token"); vi.stubEnv("ZITADEL_SERVICE_USER_TOKEN_FILE", "");
  vi.stubEnv("ZITADEL_EXTERNALDOMAIN", ""); vi.stubEnv("CUSTOM_REQUEST_HEADERS", "");
  vi.stubEnv("SESSION_SECRET", "independent-test-session-secret-at-least-32-chars"); vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});
describe("server configuration", () => {
  it("resolves the navigation origin without requiring upstream credentials", () => {
    vi.stubEnv("APP_URL", "https://login.example.com/");
    vi.stubEnv("ZITADEL_API_URL", "");
    vi.stubEnv("ZITADEL_SERVICE_TOKEN", "");
    vi.stubEnv("SESSION_SECRET", "");
    expect(getAppUrl()).toBe("https://login.example.com");
    for (const value of ["", "https://login.example.com/path", "https://user:password@login.example.com", "//other.example.com"]) {
      vi.stubEnv("APP_URL", value);
      expect(() => getAppUrl()).toThrow("APP_URL");
    }
  });
  it("keeps API credentials in server-only configuration", () => {
    expect(getConfig().apiUrl).toBe("https://id.example.com");
    expect(JSON.stringify(getConfig())).toContain("server-secret-token");
  });
  it("uses instance headers without sending Host alongside HTTP/2 :authority", () => {
    expect(zitadelRequestHeaders(getConfig())).toEqual({
      "x-forwarded-proto": "https",
      "x-zitadel-instance-host": "id.example.com",
      "x-zitadel-public-host": "id.example.com",
    });
  });
  it("requires service configuration before running authentication operations", () => {
    vi.stubEnv("ZITADEL_SERVICE_TOKEN", "");
    expect(() => getConfig()).toThrow(ConfigurationError);
    expect(() => getConfig()).toThrow("ZITADEL_SERVICE_TOKEN");
  });
  it("reads and trims a mounted service-account token file, taking it over the inline token", () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "wyid-config-"));
    const tokenFile = join(tempDirectory, "service-user-token");
    writeFileSync(tokenFile, "  mounted-service-token\n", { mode: 0o600 });
    vi.stubEnv("ZITADEL_SERVICE_USER_TOKEN_FILE", tokenFile);
    expect(getConfig().token).toBe("mounted-service-token");
  });
  it("allows an internal HTTP API when a public instance domain is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://login.example.com");
    vi.stubEnv("ZITADEL_API_URL", "http://zitadel:8080");
    vi.stubEnv("ZITADEL_EXTERNALDOMAIN", "id.example.com");
    const config = getConfig();
    expect(config.apiUrl).toBe("http://zitadel:8080");
    expect(zitadelRequestHeaders(config)).toEqual({
      "x-forwarded-proto": "https",
      "x-zitadel-instance-host": "id.example.com",
      "x-zitadel-public-host": "id.example.com",
    });
  });
  it("requires a public host before allowing an internal HTTP API in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://login.example.com");
    vi.stubEnv("ZITADEL_API_URL", "http://zitadel:8080");
    expect(() => getConfig()).toThrow("ZITADEL_API_URL");
  });
  it("accepts Login-style custom host headers and validates their syntax", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://login.example.com");
    vi.stubEnv("ZITADEL_API_URL", "http://zitadel:8080");
    vi.stubEnv("CUSTOM_REQUEST_HEADERS", "Host:id.example.com,X-Forwarded-Proto:https,X-Custom:custom-value");
    const config = getConfig();
    expect(zitadelRequestHeaders(config)).toEqual({
      "x-forwarded-proto": "https",
      "x-zitadel-instance-host": "id.example.com",
      "x-zitadel-public-host": "id.example.com",
      "x-custom": "custom-value",
    });
    vi.stubEnv("CUSTOM_REQUEST_HEADERS", "Authorization:Bearer bad");
    expect(() => getConfig()).toThrow("CUSTOM_REQUEST_HEADERS");
  });
  it("reads the optional consent-exempt project allowlist at runtime", () => {
    vi.stubEnv("ZITADEL_SKIP_CONSENT_PROJECT_IDS", " project-a,project-b,project-a ,, ");
    expect(getConfig().skipConsentProjectIds).toEqual(["project-a", "project-b"]);
  });
  it("rejects paths, embedded credentials, query strings, and non-HTTP protocols", () => {
    for (const url of ["https://id.example.com/api", "https://user:password@id.example.com", "https://id.example.com/?token=test", "ftp://id.example.com"]) {
      vi.stubEnv("ZITADEL_API_URL", url); expect(() => getConfig()).toThrow(ConfigurationError);
    }
  });
  it("requires HTTPS in production and a separate sufficiently long cookie key", () => {
    vi.stubEnv("NODE_ENV", "production"); expect(() => getConfig()).toThrow(ConfigurationError);
    vi.stubEnv("APP_URL", "https://login.example.com"); expect(getConfig().appUrl).toBe("https://login.example.com");
    vi.stubEnv("SESSION_SECRET", "short"); expect(() => getConfig()).toThrow(ConfigurationError);
  });
});
