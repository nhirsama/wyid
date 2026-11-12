import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), finish: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/server/actions", () => ({ startPasskey: mocks.start, finishPasskey: mocks.finish }));
vi.mock("@/lib/webauthn", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/webauthn")>(), authenticate: mocks.authenticate }));
import { loginWithPasskey } from "@/lib/passkey-login";

const context = { authRequestId: "V2_test" };
const discovery = { challenge: "discovery-challenge", rpId: "login.example.com", userVerification: "discouraged" };
const options = { challenge: "native-challenge", rpId: "login.example.com", userVerification: "required" };
const account = { id: "credential-id", response: { userHandle: Buffer.from("user-id").toString("base64url") } };
const assertion = { id: "credential-id", response: { signature: "native-signature" } };
const success = { ok: true, redirect: "/account" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.start.mockResolvedValue({ ok: true, options });
  mocks.authenticate.mockResolvedValue(assertion);
  mocks.finish.mockResolvedValue(success);
});

describe("one-click passkey login", () => {
  it("lets the user explicitly choose a different account", async () => {
    expect(await loginWithPasskey(context, true)).toEqual(success);
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ chooseAccount: true }, context);
  });

  it.each([
    { ok: false, message: "通行密钥未启用。" },
    { ok: true, redirect: "/login?error=login_required" },
    { ok: true },
  ])("does not prompt when the initial action returns %j", async result => {
    mocks.start.mockResolvedValueOnce(result);
    const response = await loginWithPasskey(context);
    expect(response).toEqual("message" in result || "redirect" in result ? result : { ok: false, message: "身份服务未返回通行密钥验证请求，请重试。" });
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it.each(["discovery", "authentication"])("stops on cancellation during %s and allows a fresh retry", async stage => {
    if (stage === "discovery") mocks.start.mockResolvedValueOnce({ ok: true, discoverUser: true, options: discovery });
    mocks.authenticate.mockRejectedValueOnce(new Error("操作已取消或超时，请重试。"));
    expect(await loginWithPasskey(context)).toEqual({ ok: false, message: "操作已取消或超时，请重试。" });
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(await loginWithPasskey(context)).toEqual(success);
    expect(mocks.finish).toHaveBeenCalledTimes(1);
  });

  it("does not create a user-bound challenge from a missing userHandle", async () => {
    mocks.start.mockResolvedValueOnce({ ok: true, discoverUser: true, options: discovery });
    mocks.authenticate.mockResolvedValueOnce({ response: { userHandle: null } });
    expect(await loginWithPasskey(context)).toMatchObject({ ok: false, message: expect.stringContaining("账号标识") });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, message: "账号不可用。" },
    { ok: true, redirect: "/login" },
    { ok: true },
    { ok: true, discoverUser: true, options: discovery },
  ])("never loops or prompts again after discovery returns %j", async result => {
    mocks.start.mockResolvedValueOnce({ ok: true, discoverUser: true, options: discovery }).mockResolvedValueOnce(result);
    mocks.authenticate.mockResolvedValueOnce(account);
    await loginWithPasskey(context);
    expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith(discovery);
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.finish).not.toHaveBeenCalled();
  });
});
