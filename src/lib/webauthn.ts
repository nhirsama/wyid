// 使用 WebAuthn 标准 JSON API；挑战、RP 和凭证验证全部由 ZITADEL 生成和处理。
function publicKeyOptions(options: Record<string, unknown>) {
  const publicKey = options.publicKey;
  return publicKey && typeof publicKey === "object" && !Array.isArray(publicKey)
    ? publicKey as Record<string, unknown> : options;
}

type KeyMethod = "passkey" | "u2f";

function keyOptions(options: Record<string, unknown>, method: KeyMethod, registration = false) {
  const publicKey = publicKeyOptions(options);
  if (method !== "u2f") return publicKey;
  const request = { ...publicKey, hints: ["security-key"] };
  if (!registration) return request;
  const selection = publicKey.authenticatorSelection;
  return { ...request, authenticatorSelection: {
    ...(selection && typeof selection === "object" && !Array.isArray(selection) ? selection : {}),
    authenticatorAttachment: "cross-platform", residentKey: "discouraged", requireResidentKey: false, userVerification: "discouraged",
  } };
}

function webauthnError(cause: unknown) {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return new Error("操作已取消或超时，请重试，也可以选择其他验证方式。");
  if (name === "InvalidStateError") return new Error("此设备或安全密钥已绑定，请使用其他设备。");
  if (name === "SecurityError") return new Error("当前域名无法使用此凭据，请通过账号服务的 HTTPS 登录域名重试。");
  if (name === "NotSupportedError") return new Error("当前设备不支持此验证方式，请使用其他设备或安全密钥。");
  return new Error("设备验证未能完成，请重新开始或选择其他验证方式。", { cause });
}

export async function authenticate(options: Record<string, unknown>, method: KeyMethod = "passkey") {
  const label = method === "u2f" ? "安全密钥" : "通行密钥";
  if (!globalThis.PublicKeyCredential?.parseRequestOptionsFromJSON || typeof navigator === "undefined" || !navigator.credentials?.get) throw new Error(`当前浏览器不支持${label}，请更新浏览器或使用其他登录方式。`);
  let credential: Credential | null;
  try {
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(keyOptions(options, method) as unknown as PublicKeyCredentialRequestOptionsJSON);
    credential = await navigator.credentials.get({ publicKey });
  } catch (cause) { throw webauthnError(cause); }
  if (!(credential instanceof PublicKeyCredential)) throw new Error(`未完成${label}验证。`);
  if (method === "u2f" && credential.authenticatorAttachment === "platform") throw new Error("请使用已绑定的外接安全密钥进行验证。");
  return credential.toJSON();
}

// Account discovery is only a lookup hint. ZITADEL must still verify a fresh,
// user-bound assertion before this user ID can become an authenticated session.
export function passkeyUserId(credential: unknown) {
  try {
    const handle = (credential as { response?: { userHandle?: unknown } })?.response?.userHandle;
    if (typeof handle !== "string" || !/^[A-Za-z0-9_-]{1,1366}$/.test(handle)) throw new Error();
    const bytes = Uint8Array.from(atob(handle.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    const userId = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!userId || userId.length > 1024 || /[\u0000-\u001f\u007f]/.test(userId)) throw new Error();
    return userId;
  } catch {
    throw new Error("此通行密钥未提供有效的账号标识，请选择其他通行密钥。");
  }
}

export async function register(options: Record<string, unknown>, method: KeyMethod = "passkey") {
  const label = method === "u2f" ? "安全密钥" : "设备凭据";
  if (!globalThis.PublicKeyCredential?.parseCreationOptionsFromJSON || typeof navigator === "undefined" || !navigator.credentials?.create) throw new Error(`当前浏览器不支持${label}注册，请更新浏览器或使用其他验证方式。`);
  let credential: Credential | null;
  try {
    const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(keyOptions(options, method, true) as unknown as PublicKeyCredentialCreationOptionsJSON);
    credential = await navigator.credentials.create({ publicKey });
  } catch (cause) { throw webauthnError(cause); }
  if (!(credential instanceof PublicKeyCredential)) throw new Error(`未完成${label}注册。`);
  if (method === "u2f" && credential.authenticatorAttachment === "platform") throw new Error("请使用外接安全密钥完成绑定。");
  return credential.toJSON();
}
