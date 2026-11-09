import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError, getConfig } from "@/server/config";
beforeEach(() => {
  vi.stubEnv("APP_URL", "http://localhost:3000"); vi.stubEnv("ZITADEL_API_URL", "https://id.example.com");
  vi.stubEnv("ZITADEL_SERVICE_TOKEN", "server-secret-token"); vi.stubEnv("SESSION_SECRET", "independent-test-session-secret-at-least-32-chars"); vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => vi.unstubAllEnvs());
describe("server configuration", () => {
  it("keeps API credentials in server-only configuration", () => {
    expect(getConfig().apiUrl).toBe("https://id.example.com");
    expect(JSON.stringify(getConfig())).toContain("server-secret-token");
  });
  it("requires service configuration before running authentication operations", () => {
    vi.stubEnv("ZITADEL_SERVICE_TOKEN", "");
    expect(() => getConfig()).toThrow(ConfigurationError);
    expect(() => getConfig()).toThrow("ZITADEL_SERVICE_TOKEN");
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
