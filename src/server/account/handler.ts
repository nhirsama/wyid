import { z } from "zod";
import { Code, ConnectError } from "@connectrpc/connect";
import { getConfig } from "@/server/config";
import { actionError } from "@/server/errors";
import { clearAccountGrant, clearAuthenticatedSession, clearPendingSession, readAuthenticatedSession } from "@/server/session";
import { zitadel } from "@/server/zitadel/service";
import { AccountError, assert } from "./errors";
import { accountIdentity, accountProfile } from "./identity";
import { Applications } from "./applications";
import { avatarFile } from "./avatar";
import { devices, revokeDevice } from "./devices";
import { addOtp, authenticationMethods, checkFactor, confirmPhone, confirmTotp, finishKey, removeFactor, sendCheck, startKey, startPhone, startTotp } from "./factors";
import { removeAvatar, updateEmail, updatePassword, updateProfile, uploadAvatar } from "./profile";
import { applicationSchema, parse, profileSchema } from "./validation";

const password = z.string().min(1).max(1024);
const code = z.string().trim().min(1).max(256);
const keyType = z.enum(["passkey", "webauthn"]);
const factorType = z.enum(["totp", "passkey", "webauthn", "otp-email", "otp-sms"]);
const credential = z.record(z.string(), z.json());

export async function readAccountBody(request: Request) {
  const limit = 128 * 1024;
  assert(Number(request.headers.get("content-length") || 0) <= limit, 413, "request_too_large", "提交内容过长。");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new AccountError(413, "request_too_large", "提交内容过长。"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return {};
  let data: unknown;
  try { data = JSON.parse(body); }
  catch { throw new AccountError(400, "invalid_json", "提交内容格式无效。"); }
  return parse(z.record(z.string(), z.unknown()), data);
}

export async function handleAccountRequest(request: Request, path: string[]) {
  const headers = { "Cache-Control": "no-store, private", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
  try {
    assert(path.length > 0 && path.length <= 5 && path.every(segment => segment && !/[\/\\\u0000-\u001f\u007f]/.test(segment)), 404, "not_found", "请求的功能不存在。");
    const pathname = `/${path.join("/")}`, method = request.method;
    const mutation = method !== "GET";
    const avatar = pathname === "/me/avatar" && method === "POST";
    assert(request.headers.get("sec-fetch-site") !== "cross-site", 403, "invalid_origin", "请求来源无效。");
    if (mutation) {
      assert(request.headers.get("origin") === getConfig().appUrl, 403, "invalid_origin", "请求来源无效，请从账号门户重新提交。");
      const content = request.headers.get("content-type")?.split(";")[0].trim();
      assert(content === (avatar ? "multipart/form-data" : "application/json"), 415, "invalid_content_type", "请求内容格式无效。");
    }
    const data = mutation && !avatar ? await readAccountBody(request) : {};
    if (pathname === "/logout" && method === "POST") {
      const ref = await readAuthenticatedSession();
      try { if (ref) await zitadel.deleteSession(ref); }
      catch { /* An already expired upstream session must not prevent local logout. */ }
      finally { await Promise.all([clearAuthenticatedSession(), clearPendingSession(), clearAccountGrant()]); }
      return json({ signedOut: true });
    }
    // These are the ONLY endpoints allowed to continue after newly enrolling a
    // factor changes the MFA policy. Each validates an encrypted, bound grant.
    if (method === "POST") {
      if (pathname === "/me/methods/key/verify") {
        const input = parse(z.object({ type: keyType, name: z.string().trim().min(1).max(200), credential }), data);
        return json(await finishKey(input.type, input.credential, input.name));
      }
      if (pathname === "/me/methods/totp/verify") return json(await confirmTotp(parse(z.object({ code: z.string().regex(/^\d{6}$/) }), data).code));
      if (pathname === "/me/methods/check/send") return json(await sendCheck());
      if (pathname === "/me/methods/check") return json(await checkFactor(parse(z.object({ code: code.optional(), credential: credential.optional() }), data)));
      if (pathname === "/me/phone/verify") return json(await confirmPhone(parse(z.object({ code }), data).code));
    }
    const identity = await accountIdentity();
    if (pathname === "/me" && method === "GET") return json({ account: accountProfile(identity.state.user) });
    if (pathname === "/me" && method === "PATCH") return json(await updateProfile(identity, parse(profileSchema, data)));
    if (pathname === "/me/email" && method === "POST") return json(await updateEmail(identity, parse(z.object({ email: z.email().max(320), password }), data)));
    if (pathname === "/me/password" && method === "POST") return json(await updatePassword(identity, parse(z.object({ currentPassword: password, password }), data)));
    if (pathname === "/me/avatar" && method === "POST") return json(await uploadAvatar(identity, await avatarFile(request)));
    if (pathname === "/me/avatar" && method === "DELETE") return json(await removeAvatar(identity));
    if (pathname === "/me/methods" && method === "GET") return json(await authenticationMethods(identity));
    if (pathname === "/me/methods" && method === "DELETE") {
      const input = parse(z.object({ type: factorType, id: z.string().min(1).max(1024).optional() }), data);
      return json(await removeFactor(identity, input.type, input.id));
    }
    if (pathname === "/me/methods/key" && method === "POST") return json(await startKey(identity, parse(z.object({ type: keyType }), data).type));
    if (pathname === "/me/methods/totp" && method === "POST") return json(await startTotp(identity));
    if (pathname === "/me/methods/otp" && method === "POST") return json(await addOtp(identity, parse(z.object({ type: z.enum(["otp-email", "otp-sms"]) }), data).type));
    if (pathname === "/me/phone" && method === "POST") return json(await startPhone(identity, parse(z.object({ phone: z.string().regex(/^\+[1-9]\d{1,14}$/, "请填写带国家区号的手机号码，例如 +8613800138000。") }), data).phone));
    if (pathname === "/me/sessions" && method === "GET") return json({ devices: await devices(identity) });
    if (path.length === 3 && path[0] === "me" && path[1] === "sessions" && method === "DELETE") return json(await revokeDevice(identity, path[2]));
    if (path[0] === "apps") {
      const apps = new Applications(identity);
      if (path.length === 1 && method === "GET") return json({ applications: await apps.list() });
      if (path.length === 1 && method === "POST") return json(await apps.create(parse(applicationSchema, data)), 201);
      if (path.length === 2 && method === "GET") return json({ application: await apps.get(path[1]) });
      if (path.length === 2 && method === "PATCH") return json({ application: await apps.update(path[1], parse(applicationSchema, data)) });
      if (path.length === 2 && method === "DELETE") { await apps.remove(path[1]); return json({ removed: true }); }
      if (path.length === 3 && path[2] === "state" && method === "POST") return json({ application: await apps.enabled(path[1], parse(z.object({ enabled: z.boolean() }), data).enabled) });
      if (path.length === 3 && path[2] === "secret" && method === "POST") return json(await apps.rotate(path[1]));
    }
    throw new AccountError(404, "not_found", "请求的功能不存在。");
  } catch (error) {
    if (error instanceof AccountError) return json({ error: { code: error.code, message: error.message } }, error.status);
    const result = actionError(error);
    const status = error instanceof ConnectError ? error.code === Code.PermissionDenied ? 403 : error.code === Code.Unauthenticated ? 401 : error.code === Code.NotFound ? 404 : error.code === Code.AlreadyExists ? 409 : 502 : 500;
    return json({ error: { code: status === 401 ? "authentication_required" : "request_failed", message: result.message, requestId: result.requestId } }, status);
  }
}
