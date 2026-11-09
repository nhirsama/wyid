import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), pending: vi.fn() }));
vi.mock("@/server/actions", () => ({ completeIdentityProvider: mocks.complete }));
vi.mock("@/server/session", () => ({ readPendingSession: mocks.pending }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com" }) }));
import { GET } from "@/app/idp/callback/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pending.mockResolvedValue({ authRequestId: "V2_test" });
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/auth");
});
afterEach(() => vi.unstubAllEnvs());

describe("identity-provider callback redirects", () => {
  it("returns to the base-path login page on failure", async () => {
    const response = await GET(new NextRequest("https://login.example.com/auth/idp/callback?failed=1"));
    expect(response.headers.get("location")).toBe("https://login.example.com/auth/login?authRequest=V2_test&idpError=1");
  });

  it.each(["/account", "/verify", "/idp/confirm?state=value"])("resolves local redirect %s under the base path", async target => {
    mocks.complete.mockResolvedValue({ ok: true, redirect: target });
    const response = await GET(new NextRequest("https://login.example.com/auth/idp/callback"));
    expect(response.headers.get("location")).toBe(`https://login.example.com/auth${target}`);
  });

  it("does not prefix an external OIDC application callback", async () => {
    mocks.complete.mockResolvedValue({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    const response = await GET(new NextRequest("https://login.example.com/auth/idp/callback"));
    expect(response.headers.get("location")).toBe("https://app.example.com/callback?code=opaque");
  });
});
