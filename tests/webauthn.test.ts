import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate, passkeyUserId, register } from "@/lib/webauthn";

const json = { id: "credential-id", rawId: "credential-id", type: "public-key", response: { clientDataJSON: "client-data" } };
class TestPublicKeyCredential {
  static parseRequestOptionsFromJSON = vi.fn((options: unknown) => ({ request: options }));
  static parseCreationOptionsFromJSON = vi.fn((options: unknown) => ({ creation: options }));
  toJSON() { return json; }
}
const get = vi.fn();
const create = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(new TestPublicKeyCredential());
  create.mockResolvedValue(new TestPublicKeyCredential());
  vi.stubGlobal("PublicKeyCredential", TestPublicKeyCredential);
  vi.stubGlobal("navigator", { credentials: { get, create } });
});
afterEach(() => vi.unstubAllGlobals());

describe("WebAuthn JSON helpers", () => {
  it.each([false, true])("uses the security-key browser flow for U2F; wrapped=%s", async wrapped => {
    const options = { challenge: "u2f-challenge", rpId: "login.example.com", allowCredentials: [{ type: "public-key", id: "u2f-id" }], userVerification: "discouraged" };
    await authenticate(wrapped ? { publicKey: options } : options, "u2f");
    expect(TestPublicKeyCredential.parseRequestOptionsFromJSON).toHaveBeenCalledWith({ ...options, hints: ["security-key"] });
    expect(options).not.toHaveProperty("hints");
    expect(create).not.toHaveBeenCalled();
  });

  it("registers U2F on an external security key instead of creating a platform passkey", async () => {
    const options = { challenge: "u2f-registration", authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", requireResidentKey: true, userVerification: "required" } };
    await register(options, "u2f");
    expect(TestPublicKeyCredential.parseCreationOptionsFromJSON).toHaveBeenCalledWith({ ...options, hints: ["security-key"], authenticatorSelection: {
      authenticatorAttachment: "cross-platform", residentKey: "discouraged", requireResidentKey: false, userVerification: "discouraged",
    } });
    expect(options.authenticatorSelection.authenticatorAttachment).toBe("platform");
  });

  it("does not accept a platform credential in the security-key flow", async () => {
    const credential = Object.assign(new TestPublicKeyCredential(), { authenticatorAttachment: "platform" });
    get.mockResolvedValueOnce(credential); create.mockResolvedValueOnce(credential);
    await expect(authenticate({ challenge: "challenge" }, "u2f")).rejects.toThrow("外接安全密钥");
    await expect(register({ challenge: "challenge" }, "u2f")).rejects.toThrow("外接安全密钥");
  });

  it("does not call a security-key failure a passkey failure", async () => {
    get.mockResolvedValueOnce(null); create.mockResolvedValueOnce(null);
    await expect(authenticate({}, "u2f")).rejects.toThrow("未完成安全密钥验证");
    await expect(register({}, "u2f")).rejects.toThrow("未完成安全密钥注册");
    vi.stubGlobal("PublicKeyCredential", undefined);
    await expect(authenticate({}, "u2f")).rejects.toThrow("当前浏览器不支持安全密钥");
  });

  it.each(["user-id", "123456789012345678", "账号-猫"])("decodes the ZITADEL userHandle for %s as an untrusted account hint", userId => {
    expect(passkeyUserId({ response: { userHandle: Buffer.from(userId).toString("base64url") } })).toBe(userId);
  });

  it.each([null, {}, { response: {} }, { response: { userHandle: null } }, { response: { userHandle: "" } },
    { response: { userHandle: "%%%" } }, { response: { userHandle: "_w" } },
    { response: { userHandle: Buffer.from("user\u0000id").toString("base64url") } },
    { response: { userHandle: "a".repeat(1367) } },
  ])("rejects an invalid account-discovery response: %j", value => {
    expect(() => passkeyUserId(value)).toThrow("账号标识");
  });

  it.each([false, true])("authenticates using %s publicKey wrapping without creating a credential", async wrapped => {
    const options = { challenge: "login-challenge", rpId: "login.example.com", allowCredentials: [{ type: "public-key", id: "allowed-id" }] };
    expect(await authenticate(wrapped ? { publicKey: options } : options)).toBe(json);
    expect(TestPublicKeyCredential.parseRequestOptionsFromJSON).toHaveBeenCalledWith(options);
    expect(get).toHaveBeenCalledWith({ publicKey: { request: options } });
    expect(create).not.toHaveBeenCalled();
    expect(TestPublicKeyCredential.parseCreationOptionsFromJSON).not.toHaveBeenCalled();
  });

  it.each([false, true])("registers using %s publicKey wrapping without requesting a login proof", async wrapped => {
    const options = { challenge: "registration-challenge", user: { id: "user-id", name: "cat", displayName: "Cat" }, rp: { name: "wyid" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] };
    expect(await register(wrapped ? { publicKey: options } : options)).toBe(json);
    expect(TestPublicKeyCredential.parseCreationOptionsFromJSON).toHaveBeenCalledWith(options);
    expect(create).toHaveBeenCalledWith({ publicKey: { creation: options } });
    expect(get).not.toHaveBeenCalled();
    expect(TestPublicKeyCredential.parseRequestOptionsFromJSON).not.toHaveBeenCalled();
  });

  it.each([null, "invalid", []])("does not mistake malformed nested publicKey %j for an options object", async publicKey => {
    const options = { challenge: "challenge", publicKey };
    await authenticate(options);
    expect(TestPublicKeyCredential.parseRequestOptionsFromJSON).toHaveBeenCalledWith(options);
  });

  it.each(["NotAllowedError", "AbortError"])("explains %s cancellation for both get and create", async name => {
    const error = new Error("browser message"); error.name = name;
    get.mockRejectedValueOnce(error); create.mockRejectedValueOnce(error);
    await expect(authenticate({ challenge: "challenge" })).rejects.toThrow("操作已取消或超时");
    await expect(register({ challenge: "challenge" })).rejects.toThrow("操作已取消或超时");
  });

  it.each([
    ["InvalidStateError", "此设备或安全密钥已绑定"],
    ["SecurityError", "当前域名无法使用此凭据"],
    ["NotSupportedError", "当前设备不支持此验证方式"],
  ])("explains %s registration failures", async (name, message) => {
    const error = new Error("browser message"); error.name = name;
    create.mockRejectedValueOnce(error);
    await expect(register({ challenge: "challenge" })).rejects.toThrow(message);
  });

  it("rejects missing credentials rather than returning fabricated success", async () => {
    get.mockResolvedValueOnce(null); create.mockResolvedValueOnce(null);
    await expect(authenticate({ challenge: "challenge" })).rejects.toThrow("未完成通行密钥验证");
    await expect(register({ challenge: "challenge" })).rejects.toThrow("未完成设备凭据注册");
  });

  it("rejects a non-public-key credential", async () => {
    get.mockResolvedValueOnce({ toJSON: () => json }); create.mockResolvedValueOnce({ toJSON: () => json });
    await expect(authenticate({ challenge: "challenge" })).rejects.toThrow("未完成通行密钥验证");
    await expect(register({ challenge: "challenge" })).rejects.toThrow("未完成设备凭据注册");
  });

  it("reports unsupported browsers without requesting a credential", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    await expect(authenticate({})).rejects.toThrow("当前浏览器不支持通行密钥");
    await expect(register({})).rejects.toThrow("当前浏览器不支持设备凭据注册");
    expect(get).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it("reports a missing credentials API without throwing a navigator ReferenceError", async () => {
    vi.stubGlobal("navigator", undefined);
    await expect(authenticate({})).rejects.toThrow("当前浏览器不支持通行密钥");
    await expect(register({})).rejects.toThrow("当前浏览器不支持设备凭据注册");
  });

  it("converts malformed browser parsing failures into retryable errors", async () => {
    TestPublicKeyCredential.parseRequestOptionsFromJSON.mockImplementationOnce(() => { throw new TypeError("invalid JSON"); });
    TestPublicKeyCredential.parseCreationOptionsFromJSON.mockImplementationOnce(() => { throw new TypeError("invalid JSON"); });
    await expect(authenticate({})).rejects.toThrow("设备验证未能完成");
    await expect(register({})).rejects.toThrow("设备验证未能完成");
    expect(get).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});
