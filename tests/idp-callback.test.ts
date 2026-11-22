import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), pending: vi.fn(), clearPending: vi.fn() }));
vi.mock("@/server/actions", () => ({ completeIdentityProvider: mocks.complete }));
vi.mock("@/server/session", () => ({ readPendingSession: mocks.pending, clearPendingSession: mocks.clearPending }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com" }) }));
import { GET } from "@/app/idp/callback/route";

const state = "00000000-0000-4000-8000-000000000000";
const callback = (query = "") => new NextRequest(`https://login.example.com/auth/idp/callback?state=${state}${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pending.mockResolvedValue({ authRequestId: "V2_test", idpState: state });
  vi.stubEnv("BASE_PATH", "/auth");
});
afterEach(() => vi.unstubAllEnvs());

describe("identity-provider callback redirects", () => {
  it("returns to the base-path login page and clears the matching pending flow on failure", async () => {
    const response = await GET(callback("&failed=1"));
    expect(response.headers.get("location")).toBe("https://login.example.com/auth/login?authRequest=V2_test&idpError=1");
    expect(mocks.clearPending).toHaveBeenCalledTimes(1);
  });

  it.each(["/account", "/verify", "/idp/confirm?state=value"])("resolves local redirect %s under the base path", async target => {
    mocks.complete.mockResolvedValue({ ok: true, redirect: target });
    const response = await GET(callback());
    expect(response.headers.get("location")).toBe(`https://login.example.com/auth${target}`);
    expect(mocks.clearPending).not.toHaveBeenCalled();
  });

  it("does not prefix an external OIDC application callback", async () => {
    mocks.complete.mockResolvedValue({ ok: true, redirect: "https://app.example.com/callback?code=opaque" });
    const response = await GET(callback());
    expect(response.headers.get("location")).toBe("https://app.example.com/callback?code=opaque");
  });

  it.each(["", "&failed=1"])("does not resume website B or clear its cookie when a stale website A callback arrives (%s)", async query => {
    mocks.pending.mockResolvedValue({ authRequestId: "V2_website_b", idpState: "11111111-1111-4111-8111-111111111111" });
    mocks.complete.mockResolvedValue({ ok: false, message: "身份提供方登录状态无效，请重新开始。" });
    const response = await GET(callback(query));
    expect(response.headers.get("location")).toBe("https://login.example.com/auth/login?idpError=1");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.clearPending).not.toHaveBeenCalled();
  });

  it.each(["", "?failed=1"])("does not borrow or clear the current flow when callback state is missing (%s)", async query => {
    mocks.complete.mockResolvedValue({ ok: false, message: "身份提供方登录状态无效，请重新开始。" });
    const response = await GET(new NextRequest(`https://login.example.com/auth/idp/callback${query}`));
    expect(response.headers.get("location")).toBe("https://login.example.com/auth/login?idpError=1");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.clearPending).not.toHaveBeenCalled();
  });

  it("keeps a failed result attached to its matching authorization request and clears the failed flow", async () => {
    mocks.complete.mockResolvedValue({ ok: false, message: "身份提供方登录未完成。" });
    const response = await GET(callback());
    expect(response.headers.get("location")).toBe("https://login.example.com/auth/login?authRequest=V2_test&idpError=1");
    expect(mocks.clearPending).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["此身份提供方尚未关联账号，且当前组织不允许自动创建账号。", "unlinked"],
    ["此登录方式当前不可用，请重新选择登录方式。", "disabled"],
  ])("maps allowlisted IDP failure reasons to safe error codes (%s -> %s)", async (message, code) => {
    mocks.complete.mockResolvedValue({ ok: false, message });
    const response = await GET(callback());
    expect(response.headers.get("location")).toBe(`https://login.example.com/auth/login?authRequest=V2_test&idpError=${code}`);
    expect(mocks.clearPending).toHaveBeenCalledTimes(1);
  });
});
