"use server";

import { z } from "zod";
import type { JsonObject } from "@bufbuild/protobuf";
import { UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb.js";
import { authLink, canRegisterWithPassword, factorSchema, forgotPasswordSchema, loginSchema, loginNameSchema, passwordMeetsPolicy, registerSchema, resetPasswordSchema, verifyEmailSchema, verifyTotpSchema, type ActionResult, type AuthContext, type ChallengeResult, type Factor } from "@/lib/auth";
import { AuthError, actionError } from "./errors";
import { clearAuthenticatedSession, clearPendingSession, readAuthenticatedSession, readPendingSession, writeAuthenticatedSession, writePendingSession, type PendingSession } from "./session";
import { getConfig } from "./config";
import { zitadel, type SessionRef } from "./zitadel/service";
import { inspectAuthentication, type AuthenticationState } from "./authentication";
import { ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { redirect } from "next/navigation";
import { consentToken, matchesConsentToken } from "./consent";

const contextSchema = z.object({ authRequestId: z.string().min(1).max(1024).optional(), userId: z.string().min(1).max(1024).optional() });
function context(raw: AuthContext) { return contextSchema.parse(raw); }
const keyMethodSchema = z.enum(["passkey", "u2f"]);
const otpMethodSchema = z.enum(["otpEmail", "otpSms"]);

async function pendingFor(ctx: ReturnType<typeof context>) {
  const pending = await readPendingSession();
  if (!pending || pending.authRequestId !== ctx.authRequestId || !pending.sessionId || !pending.sessionToken || (ctx.userId && pending.userId !== ctx.userId)) {
    throw new AuthError("此登录会话已失效，请重新登录。");
  }
  if (pending.mfaStartedAt === undefined) {
    const initialized = { ...pending, mfaStartedAt: Date.now() };
    await writePendingSession(initialized);
    return initialized;
  }
  return pending;
}
async function inspectPending(pending: PendingSession) {
  return inspectAuthentication(pending, pending.userId, pending.requireMfa);
}
// Persist every rotated token before further remote reads, including reads that may fail.
async function saveUpdated(pending: PendingSession, result: SessionRef, patch: Partial<PendingSession> = {}) {
  const updated = { ...pending, sessionId: result.sessionId, sessionToken: result.sessionToken, ...patch };
  await writePendingSession(updated);
  return updated;
}
async function deferAuthentication(pending: PendingSession, state: AuthenticationState): Promise<ActionResult> {
  await clearAuthenticatedSession();
  await writePendingSession({ ...pending, userId: state.userId, methods: state.methods, needsEnrollment: state.needsEnrollment });
  return { ok: true, redirect: authLink("/verify", pending) };
}
async function callback(pending: PendingSession): Promise<ActionResult> {
  if (!pending.authRequestId) throw new AuthError("登录会话缺少授权请求。");
  try {
    const url = await zitadel.callback(pending.authRequestId, { sessionId: pending.sessionId, sessionToken: pending.sessionToken });
    await clearPendingSession();
    return { ok: true, redirect: url };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== 9) throw error;
    // An application may impose stricter authentication than the instance policy.
    // This flag only adds a requirement; it is never evidence of completion.
    const stricter = { ...pending, requireMfa: true };
    await writePendingSession(stricter);
    const state = await inspectPending(stricter);
    if (state.step === "complete") throw new AuthError("当前应用仍要求额外身份验证，请重新登录或联系账号管理员。");
    return await deferAuthentication(stricter, state);
  }
}
async function finish(pending: PendingSession, state: AuthenticationState): Promise<ActionResult> {
  if (state.step !== "complete") return await deferAuthentication(pending, state);
  if (!pending.authRequestId) {
    await writeAuthenticatedSession({ sessionId: pending.sessionId, sessionToken: pending.sessionToken, userId: state.userId, mfaStartedAt: pending.mfaStartedAt });
    await clearPendingSession();
    return { ok: true, redirect: "/account" };
  }
  const request = await zitadel.authRequest(pending.authRequestId);
  if (request.prompt.includes(Prompt.NONE)) {
    const url = await zitadel.deny(request.id, ErrorReason.CONSENT_REQUIRED);
    await clearPendingSession();
    return { ok: true, redirect: url };
  }
  if (request.prompt.includes(Prompt.CONSENT) || !await zitadel.canSkipConsent(request.clientId)) {
    await writePendingSession({ ...pending, authRequestId: request.id, methods: [], userId: state.userId, needsEnrollment: false });
    return { ok: true, redirect: authLink("/consent", { authRequestId: request.id }) };
  }
  return await callback(pending);
}
async function finishOrFactor(pending: PendingSession): Promise<ActionResult> {
  pending = { ...pending, mfaStartedAt: pending.mfaStartedAt ?? Date.now() };
  await writePendingSession(pending);
  return finish(pending, await inspectPending(pending));
}
export async function decideConsent(raw: unknown): Promise<ActionResult> {
  try {
    const input = z.object({ authRequestId: z.string().min(1).max(1024), consentToken: z.string().min(1).max(128), allow: z.boolean() }).parse(raw);
    const pending = await pendingFor({ authRequestId: input.authRequestId });
    if (!pending.userId) throw new AuthError("授权会话已过期，请返回应用重新登录。");
    const request = await zitadel.authRequest(input.authRequestId);
    if (!matchesConsentToken(consentToken(request, pending, getConfig().sessionSecret), input.consentToken)) throw new AuthError("授权请求或登录账号已变化，请重新确认。");
    if (!input.allow || request.prompt.includes(Prompt.NONE)) {
      const url = await zitadel.deny(request.id, input.allow ? ErrorReason.CONSENT_REQUIRED : ErrorReason.ACCESS_DENIED);
      await clearPendingSession();
      return { ok: true, redirect: url };
    }
    const state = await inspectPending(pending);
    if (state.step !== "complete") return await deferAuthentication(pending, state);
    return await callback(pending);
  } catch (error) { return actionError(error); }
}
async function beginLogin(input: { loginName: string; password?: string; passkey?: boolean }, ctx: ReturnType<typeof context>): Promise<ChallengeResult> {
  const previous = await readPendingSession();
  if (previous?.passkeyPending && previous.sessionId && previous.sessionToken) {
    try { await zitadel.deleteSession(previous); } catch { /* A stale challenge must not block a new login. */ }
  }
  await clearPendingSession();
  await clearAuthenticatedSession();
  const auth = ctx.authRequestId ? await zitadel.authRequest(ctx.authRequestId) : undefined;
  if (auth?.prompt.includes(Prompt.NONE)) return { ok: true, redirect: await zitadel.deny(auth.id, ErrorReason.LOGIN_REQUIRED) };
  const policy = await zitadel.policy(await zitadel.organizationForAuth(ctx.authRequestId));
  if (input.passkey && !policy.passkey) throw new AuthError("此组织未启用通行密钥登录。");
  if (!input.passkey && !policy.password) throw new AuthError("此组织未启用密码登录，请使用可用的其他登录方式。");
  const mfaStartedAt = Date.now();
  const created = input.passkey
    ? await zitadel.createSession({ user: { search: { case: "loginName", value: input.loginName } } }, { webAuthN: { domain: new URL(getConfig().appUrl).hostname, userVerificationRequirement: UserVerificationRequirement.REQUIRED } }, ctx.authRequestId ? 600 : undefined)
    : await zitadel.createSession({ user: { search: { case: "loginName", value: input.loginName } }, password: { password: input.password! } }, undefined, ctx.authRequestId ? 600 : undefined);
  const pending = { sessionId: created.sessionId, sessionToken: created.sessionToken, authRequestId: auth?.id, mfaStartedAt };
  if (input.passkey) {
    await writePendingSession({ ...pending, passkeyPending: true });
    const options = created.challenges?.webAuthN?.publicKeyCredentialRequestOptions;
    if (!options) throw new AuthError("ZITADEL 未返回通行密钥挑战，请检查账号是否已登记通行密钥。");
    return { ok: true, options: options as Record<string, unknown> };
  }
  return await finishOrFactor(pending);
}
export async function login(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try { return await beginLogin(loginSchema.parse(raw), context(rawContext)); }
  catch (error) { return actionError(error); }
}
export async function startPasskey(raw: unknown, rawContext: AuthContext): Promise<ChallengeResult> {
  try { return await beginLogin({ ...z.object({ loginName: loginNameSchema }).parse(raw), passkey: true }, context(rawContext)); }
  catch (error) { return actionError(error); }
}
export async function finishPasskey(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const assertion = z.record(z.string(), z.unknown()).parse(raw);
    const pending = await pendingFor(context(rawContext));
    if (!pending.passkeyPending) throw new AuthError("通行密钥登录已过期，请重新开始。");
    const updated = await saveUpdated(pending, await zitadel.verifyWebAuthn(pending, assertion as JsonObject), { passkeyPending: false });
    // The primary passkey ceremony must prove user verification, not just possession.
    const native = await zitadel.session(updated);
    if (!native.factors?.webAuthN?.userVerified || !native.factors.webAuthN.verifiedAt) throw new AuthError("请使用支持用户验证的通行密钥重新登录。");
    return await finishOrFactor(updated);
  } catch (error) { return actionError(error); }
}
async function factorState(pending: PendingSession, method: Factor, enrollment: boolean) {
  const state = await inspectPending(pending);
  if (state.step !== "mfa" || !state.methods.includes(method) || state.needsEnrollment !== enrollment) {
    throw new AuthError(enrollment ? "此账号当前不能绑定新的验证方式，请先完成已有方式的验证。" : "此登录会话或验证方式已失效，请重新选择验证方式。");
  }
  return state;
}
export async function verifyFactor(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = z.object({ method: z.enum(["totp", "otpEmail", "otpSms"]), code: z.string().trim().min(1).max(256) }).parse(raw);
    if (input.method === "totp") verifyTotpSchema.parse(input);
    const pending = await pendingFor(context(rawContext));
    await factorState(pending, input.method, false);
    if (input.method !== "totp" && pending.challengeMethod !== input.method) throw new AuthError("请先发送验证码。");
    const updated = await saveUpdated(pending, await zitadel.verifyFactor(pending, input.method, input.code), { challengeMethod: undefined });
    return await finishOrFactor(updated);
  } catch (error) { return actionError(error); }
}
export async function beginFactor(raw: unknown, rawContext: AuthContext): Promise<ChallengeResult> {
  try {
    const { method } = z.object({ method: factorSchema }).parse(raw);
    const pending = await pendingFor(context(rawContext));
    await factorState(pending, method, false);
    if (method === "totp") return { ok: true };
    const result = await zitadel.challenge(pending, method);
    await saveUpdated(pending, result, { challengeMethod: method });
    const options = result.challenges?.webAuthN?.publicKeyCredentialRequestOptions as Record<string, unknown> | undefined;
    if ((method === "passkey" || method === "u2f") && !options) throw new AuthError("ZITADEL 未返回设备验证请求，请重新开始。");
    return { ok: true, options, message: method === "otpSms" ? "短信验证码已发送。" : method === "otpEmail" ? "邮件验证码已发送。" : undefined };
  } catch (error) { return actionError(error); }
}
export async function finishWebAuthnFactor(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const assertion = z.record(z.string(), z.unknown()).parse(raw);
    const pending = await pendingFor(context(rawContext));
    const method = keyMethodSchema.parse(pending.challengeMethod);
    await factorState(pending, method, false);
    const updated = await saveUpdated(pending, await zitadel.verifyWebAuthn(pending, assertion as JsonObject), { challengeMethod: undefined });
    if (method === "passkey") {
      const native = await zitadel.session(updated);
      if (!native.factors?.webAuthN?.userVerified) throw new AuthError("此验证方式需要完成设备上的用户验证。");
    }
    return await finishOrFactor(updated);
  } catch (error) { return actionError(error); }
}
export async function startTotpEnrollment(rawContext: AuthContext): Promise<ChallengeResult> {
  try {
    const pending = await pendingFor(context(rawContext));
    const state = await factorState(pending, "totp", true);
    const result = await zitadel.enrollTotp(state.userId);
    await writePendingSession({ ...pending, userId: state.userId, totpEnrollmentStarted: true });
    return { ok: true, uri: result.uri, secret: result.secret };
  } catch (error) { return actionError(error); }
}
export async function finishTotpEnrollment(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { code } = verifyTotpSchema.parse(raw);
    const pending = await pendingFor(context(rawContext));
    if (!pending.totpEnrollmentStarted) throw new AuthError("请先开始验证器设置。");
    const state = await inspectPending(pending);
    if (state.step !== "mfa" || !state.methods.includes("totp")) throw new AuthError("此账号当前不需要验证器设置，请继续身份验证。");
    // Once registration succeeded, retries only repeat the native session check.
    if (state.needsEnrollment) await zitadel.confirmTotp(state.userId, code);
    const updated = await saveUpdated(pending, await zitadel.verifyFactor(pending, "totp", code), { totpEnrollmentStarted: false });
    return await finishOrFactor(updated);
  } catch (error) { return actionError(error); }
}
export async function startKeyEnrollment(raw: unknown, rawContext: AuthContext): Promise<ChallengeResult> {
  try {
    const { method } = z.object({ method: keyMethodSchema }).parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await factorState(pending, method, true);
    const result = await zitadel.startKeyEnrollment(state.userId, method);
    await writePendingSession({ ...pending, userId: state.userId, keyEnrollment: { method, id: result.id, expiresAt: Date.now() + 300_000 } });
    return { ok: true, options: result.options };
  } catch (error) { return actionError(error); }
}
export async function finishKeyEnrollment(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = z.object({ method: keyMethodSchema, name: z.string().trim().min(1).max(100), credential: z.record(z.string(), z.unknown()) }).parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await factorState(pending, input.method, true);
    const enrollment = pending.keyEnrollment;
    if (!enrollment || enrollment.method !== input.method || enrollment.expiresAt < Date.now()) throw new AuthError("设备绑定请求已过期，请重新开始。");
    await zitadel.finishKeyEnrollment(state.userId, input.method, enrollment.id, input.credential as JsonObject, input.name);
    const updated = { ...pending, keyEnrollment: undefined };
    await writePendingSession(updated);
    // Binding a credential does not authenticate the session. A new assertion follows.
    return await finishOrFactor(updated);
  } catch (error) { return actionError(error); }
}
export async function enrollOtpFactor(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { method } = z.object({ method: otpMethodSchema }).parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await factorState(pending, method, true);
    await zitadel.enrollOtp(state.userId, method);
    return await finishOrFactor(pending);
  } catch (error) { return actionError(error); }
}
export async function setEnrollmentPhone(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { phone } = z.object({ phone: z.string().trim().regex(/^\+[1-9]\d{1,14}$/, "请输入包含国家区号的手机号码，例如 +8613800138000。") }).parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await factorState(pending, "otpSms", true);
    await zitadel.setEnrollmentPhone(state.userId, phone);
    return { ok: true, message: "手机验证短信已发送，请输入验证码。" };
  } catch (error) { return actionError(error); }
}
export async function verifyEnrollmentPhone(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { code } = verifyEmailSchema.parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await factorState(pending, "otpSms", true);
    await zitadel.verifyEnrollmentPhone(state.userId, code);
    return { ok: true, message: "手机号码已验证，请继续启用短信验证。" };
  } catch (error) { return actionError(error); }
}
export async function changeLoginPassword(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = z.object({ password: z.string().min(1).max(1024), confirmPassword: z.string().min(1).max(1024) })
      .refine(value => value.password === value.confirmPassword).parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await inspectPending(pending);
    if (state.step !== "password-change") throw new AuthError("此登录会话不需要修改密码。");
    if (!passwordMeetsPolicy(input.password, state.policy.passwordPolicy)) throw new AuthError(passwordPolicyMessage(state.policy.passwordPolicy));
    await zitadel.changePassword(state.userId, input.password);
    const updated = await saveUpdated(pending, await zitadel.updateSession(pending, { password: { password: input.password } }));
    return await finishOrFactor(updated);
  } catch (error) { return actionError(error); }
}
export async function verifyLoginEmail(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { code } = verifyEmailSchema.parse(raw);
    const pending = await pendingFor(context(rawContext));
    const state = await inspectPending(pending);
    if (state.step !== "verify-email") throw new AuthError("此登录会话不需要验证邮箱。");
    await zitadel.verifyEmail(state.userId, code);
    return await finishOrFactor(pending);
  } catch (error) { return actionError(error); }
}
export async function resendLoginEmail(rawContext: AuthContext): Promise<ActionResult> {
  try {
    const pending = await pendingFor(context(rawContext));
    const state = await inspectPending(pending);
    if (state.step !== "verify-email") throw new AuthError("此登录会话不需要验证邮箱。");
    await zitadel.sendEmailCode(state.userId, pending.authRequestId);
    return { ok: true, message: "验证邮件已重新发送。" };
  } catch (error) { return actionError(error); }
}
export async function resumeAuthentication(rawContext: AuthContext): Promise<ActionResult> {
  try {
    const ctx = context(rawContext);
    const pending = await pendingFor(ctx);
    return await finishOrFactor(pending);
  } catch (error) { return actionError(error); }
}
export async function resumeAccountAuthentication() {
  const session = await readAuthenticatedSession();
  if (!session) redirect("/login");
  await clearAuthenticatedSession();
  const result = await finishOrFactor({ ...session, mfaStartedAt: Date.now() });
  if (result.ok && result.redirect) redirect(result.redirect);
  redirect("/login");
}
export async function register(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = registerSchema.parse(raw); const ctx = context(rawContext);
    const organizationId = await zitadel.organizationForAuth(ctx.authRequestId);
    const policy = await zitadel.policy(organizationId);
    // Re-read the live policy on submission; hiding the link is not sufficient
    // if an administrator disables signup after the form has been opened.
    if (!canRegisterWithPassword(policy)) throw new AuthError("当前未开放密码账号注册。");
    if (!passwordMeetsPolicy(input.password, policy.passwordPolicy)) throw new AuthError(passwordPolicyMessage(policy.passwordPolicy));
    const userId = await zitadel.register(input, organizationId, ctx.authRequestId);
    await clearPendingSession();
    return { ok: true, message: "账号已创建。验证邮件已发送，请打开邮件中的链接完成验证。", redirect: `/verify-email?userId=${encodeURIComponent(userId)}${ctx.authRequestId ? `&authRequest=${encodeURIComponent(ctx.authRequestId)}` : ""}` };
  } catch (error) { return actionError(error); }
}
export async function requestPasswordReset(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = forgotPasswordSchema.parse(raw); const ctx = context(rawContext);
    const organizationId = await zitadel.organizationForAuth(ctx.authRequestId);
    const policy = await zitadel.policy(organizationId);
    if (!policy.passwordReset) throw new AuthError("此组织未开放密码重置。");
    const user = await zitadel.findUser(input.loginName, organizationId);
    // Keep the response identical whether the user exists, to avoid exposing registered accounts.
    if (user?.type.case === "human" && user.type.value.email?.isVerified) await zitadel.requestPasswordReset(user.userId, ctx.authRequestId);
    return { ok: true, message: "如果账号存在且邮箱已验证，重置邮件将很快送达。" };
  } catch (error) { return actionError(error); }
}
export async function resetPassword(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = resetPasswordSchema.parse(raw); const ctx = context(rawContext);
    if (!ctx.userId) throw new AuthError("重置链接缺少账号标识，请重新打开重置邮件。");
    const organizationId = await zitadel.organizationForUser(ctx.userId);
    const policy = await zitadel.policy(organizationId);
    if (!policy.passwordReset) throw new AuthError("此组织未开放密码重置。");
    if (!passwordMeetsPolicy(input.password, policy.passwordPolicy)) throw new AuthError(passwordPolicyMessage(policy.passwordPolicy));
    await zitadel.resetPassword(ctx.userId, input.password, input.code);
    return { ok: true, message: "密码已更新。" };
  } catch (error) { return actionError(error); }
}
function passwordPolicyMessage(policy: { minLength: number; uppercase: boolean; lowercase: boolean; number: boolean; symbol: boolean }) {
  return `密码不符合要求：至少 ${policy.minLength} 个字符${policy.uppercase ? "，包含大写字母" : ""}${policy.lowercase ? "，包含小写字母" : ""}${policy.number ? "，包含数字" : ""}${policy.symbol ? "，包含特殊字符" : ""}。`;
}
export async function verifyEmail(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = verifyEmailSchema.parse(raw);
    const ctx = context(rawContext);
    if (!ctx.userId) throw new AuthError("验证链接缺少账号标识。");
    await zitadel.verifyEmail(ctx.userId, input.code);
    const pending = await readPendingSession();
    if (pending?.userId === ctx.userId && pending.authRequestId === ctx.authRequestId && pending.sessionId && pending.sessionToken) return await finishOrFactor(pending);
    return { ok: true, message: "邮箱已验证。" };
  }
  catch (error) { return actionError(error); }
}
export async function resendEmail(rawContext: AuthContext): Promise<ActionResult> {
  try { const ctx = context(rawContext); if (!ctx.userId) throw new AuthError("验证链接缺少账号标识。"); await zitadel.sendEmailCode(ctx.userId, ctx.authRequestId); return { ok: true, message: "验证邮件已重新发送。" }; }
  catch (error) { return actionError(error); }
}
export async function chooseIdentityProvider(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { id } = z.object({ id: z.string().min(1).max(1024) }).parse(raw); const ctx = context(rawContext);
    const policy = await zitadel.policy(await zitadel.organizationForAuth(ctx.authRequestId));
    if (!policy.identityProviders.some(item => item.id === id)) throw new AuthError("此登录方式当前不可用。");
    const state = crypto.randomUUID();
    const provider = policy.identityProviders.find(item => item.id === id)!;
    await clearAuthenticatedSession();
    await clearPendingSession();
    const response = await zitadel.startIdp(id, state);
    await writePendingSession({ authRequestId: ctx.authRequestId, sessionId: "", sessionToken: "", methods: [], userId: "", idpState: state, idpCreationAllowed: provider.creationAllowed, idpAutoCreation: provider.autoCreation });
    const next = response.nextStep;
    if (next.case === "authUrl") return { ok: true, redirect: next.value };
    if (next.case === "formData") return { ok: true, form: { action: new URL(next.value.url).toString(), fields: next.value.fields } };
    throw new AuthError("身份提供方没有返回可用的登录地址。");
  } catch (error) { return actionError(error); }
}

export async function logout() {
  const session = await readAuthenticatedSession();
  try {
    if (session) await zitadel.deleteSession(session);
  } catch {
    // Always remove the local credential even if ZITADEL has already expired the session.
  }
  await clearAuthenticatedSession();
  await clearPendingSession();
  redirect("/login");
}
export async function completeIdentityProvider(raw: unknown): Promise<ActionResult> {
  try {
    const input = z.object({ idpIntentId: z.string().min(1).max(1024), idpIntentToken: z.string().min(1).max(4096), state: z.string().uuid() }).parse(raw);
    const pending = await readPendingSession();
    if (!pending?.idpState || pending.idpState !== input.state) throw new AuthError("身份提供方登录状态无效，请重新开始。");
    const result = await zitadel.retrieveIdp(input.idpIntentId, input.idpIntentToken);
    let userId = result.userId;
    if (!userId && result.addHumanUser && pending.idpCreationAllowed && pending.idpAutoCreation) userId = (await zitadel.registerIdpUser(result.addHumanUser)).userId;
    if (!userId && result.addHumanUser && pending.idpCreationAllowed) {
      await writePendingSession({ ...pending, idpIntentId: input.idpIntentId, idpIntentToken: input.idpIntentToken, idpNewUser: result.addHumanUser });
      return { ok: true, redirect: `/idp/confirm?state=${encodeURIComponent(input.state)}` };
    }
    if (!userId) throw new AuthError("此身份提供方尚未关联账号，且当前组织不允许自动创建账号。");
    const session = await zitadel.createSession({ user: { search: { case: "userId", value: userId } }, idpIntent: { idpIntentId: input.idpIntentId, idpIntentToken: input.idpIntentToken } });
    return await finishOrFactor({ ...session, authRequestId: pending.authRequestId });
  } catch (error) { return actionError(error); }
}
export async function confirmIdentityProviderRegistration(raw: unknown): Promise<ActionResult> {
  try {
    const { state } = z.object({ state: z.string().uuid() }).parse(raw);
    const pending = await readPendingSession();
    if (!pending || pending.idpState !== state || !pending.idpCreationAllowed || !pending.idpIntentId || !pending.idpIntentToken || !pending.idpNewUser) throw new AuthError("身份提供方注册请求已过期，请重新开始。");
    const user = await zitadel.registerIdpUser(pending.idpNewUser as never);
    if (!user.userId) throw new AuthError("创建账号失败，请重新检查身份提供方返回资料。");
    const session = await zitadel.createSession({ user: { search: { case: "userId", value: user.userId } }, idpIntent: { idpIntentId: pending.idpIntentId, idpIntentToken: pending.idpIntentToken } });
    return await finishOrFactor({ ...session, authRequestId: pending.authRequestId });
  } catch (error) { return actionError(error); }
}
