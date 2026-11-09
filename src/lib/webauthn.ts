// 使用 WebAuthn 标准 JSON API；挑战、RP 和凭证验证全部由 ZITADEL 生成和处理。
export async function authenticate(options: Record<string, unknown>) {
  if (!globalThis.PublicKeyCredential?.parseRequestOptionsFromJSON) throw new Error("当前浏览器不支持通行密钥，请更新浏览器或使用其他登录方式。");
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options as unknown as PublicKeyCredentialRequestOptionsJSON);
  const credential = await navigator.credentials.get({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("未完成通行密钥验证。");
  return credential.toJSON();
}
