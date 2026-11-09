"use server";

import { z } from "zod";
import { factorSchema, forgotPasswordSchema, loginSchema, loginNameSchema, passwordMeetsPolicy, registerSchema, resetPasswordSchema, verifyEmailSchema, verifyTotpSchema, type ActionResult, type AuthContext, type ChallengeResult, type Factor } from "@/lib/auth";
import { AuthError, actionError } from "./errors";
import { clearAuthenticatedSession, clearPendingSession, readAuthenticatedSession, readPendingSession, writeAuthenticatedSession, writePendingSession, type PendingSession } from "./session";
import { getConfig } from "./config";
import { zitadel } from "./zitadel/service";
import { ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { redirect } from "next/navigation";

const contextSchema = z.object({ authRequestId: z.string().min(1).max(1024).optional(), userId: z.string().min(1).max(1024).optional() });
function context(raw: AuthContext) { return contextSchema.parse(raw); }
async function finish(session: PendingSession): Promise<ActionResult> {
  if (!session.authRequestId) throw new AuthError("登录会话缺少授权请求。");
  const redirect = await zitadel.callback(session.authRequestId, { sessionId: session.sessionId, sessionToken: session.sessionToken });
  await clearPendingSession();
  return { ok: true, redirect };
}
function pendingFor(input: { authRequestId?: string; sessionId: string; sessionToken: string }, methods: Factor[], userId: string): PendingSession {
  return { ...input, methods, userId };
}
async function finishOrFactor(input: { authRequestId?: string; sessionId: string; sessionToken: string }, methods?: Factor[], userId?: string, factorVerified = false): Promise<ActionResult> {
  if (!input.authRequestId) {
    const current = await zitadel.session(input);
    const resolvedUserId = userId || current.factors?.user?.id;
    if (!resolvedUserId) throw new AuthError("登录会话中没有账号信息，请重新登录。");
    const organizationId = await zitadel.organizationForUser(resolvedUserId);
    const policy = await zitadel.policy(organizationId);
    const isLocalLogin = Boolean(current.factors?.password || current.factors?.webAuthN);
    const requiresMfa = policy.forceMfa && (!policy.forceMfaLocalOnly || isLocalLogin);
    if (requiresMfa && !factorVerified) {
      const configured = methods?.length ? methods : await zitadel.methods(resolvedUserId);
      const allowed = configured.filter(method => policy.factors.includes(method));
      const needsEnrollment = allowed.length === 0 && policy.factors.includes("totp");
      if (!allowed.length && !needsEnrollment) throw new AuthError("账号策略要求额外验证，但没有可用的已登记验证方式。请联系账号管理员。");
      await writePendingSession({ ...pendingFor(input, needsEnrollment ? ["totp"] : allowed, resolvedUserId), ...(needsEnrollment ? { needsEnrollment: true } : {}) });
      return { ok: true, redirect: "/verify" };
    }
    await writeAuthenticatedSession({ sessionId: input.sessionId, sessionToken: input.sessionToken, userId: resolvedUserId });
    await clearPendingSession();
    return { ok: true, redirect: "/account" };
  }
  try { return await finish(input); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== 9) throw error;
    const current = await zitadel.session(input);
    const resolvedUserId = userId || current.factors?.user?.id;
    if (!resolvedUserId) throw new AuthError("账号要求额外验证，但登录会话中没有账号信息。");
    const organizationId = await zitadel.organizationForUser(resolvedUserId);
    const policy = await zitadel.policy(organizationId);
    const configured = methods?.length ? methods : await zitadel.methods(resolvedUserId);
    const allowed = configured.filter(method => policy.factors.includes(method));
    const needsEnrollment = allowed.length === 0 && policy.factors.includes("totp");
    if (!allowed.length && !needsEnrollment) throw new AuthError("账号策略要求额外验证，但没有可用的已登记验证方式。请联系账号管理员。");
    await writePendingSession({ ...pendingFor(input, needsEnrollment ? ["totp"] : allowed, resolvedUserId), ...(needsEnrollment ? { needsEnrollment: true } : {}) });
    return { ok: true, redirect: `/verify?authRequest=${encodeURIComponent(input.authRequestId)}` };
  }
}
async function beginLogin(input: { loginName: string; password?: string; passkey?: boolean }, ctx: ReturnType<typeof context>): Promise<ActionResult | ChallengeResult> {
  await clearPendingSession();
  const auth = ctx.authRequestId ? await zitadel.authRequest(ctx.authRequestId) : undefined;
  if (auth?.prompt.includes(Prompt.NONE)) return { ok: true, redirect: await zitadel.deny(auth.id, ErrorReason.LOGIN_REQUIRED) };
  const organizationId = await zitadel.organizationForAuth(ctx.authRequestId);
  const policy = await zitadel.policy(organizationId);
  if (input.passkey && !policy.passkey) throw new AuthError("此组织未启用通行密钥登录。");
  if (!input.passkey && !policy.password) throw new AuthError("此组织未启用密码登录，请使用可用的其他登录方式。");
  const created = input.passkey
    ? await zitadel.createSession({ user: { search: { case: "loginName", value: input.loginName } } }, { webAuthN: { domain: new URL(getConfig().appUrl).hostname, userVerificationRequirement: policy.userVerifiedKey ? 1 : 2 } }, ctx.authRequestId ? 600 : undefined)
    : await zitadel.createSession({ user: { search: { case: "loginName", value: input.loginName } }, password: { password: input.password! } }, undefined, ctx.authRequestId ? 600 : undefined);
  if (input.passkey) {
    const options = created.challenges?.webAuthN?.publicKeyCredentialRequestOptions;
    if (!options) throw new AuthError("ZITADEL 未返回通行密钥挑战，请检查账号是否已登记通行密钥。");
    await writePendingSession({ sessionId: created.sessionId, sessionToken: created.sessionToken, authRequestId: auth?.id, methods: [], userId: "" });
    return { ok: true, options: options as Record<string, unknown> };
  }
  return finishOrFactor({ ...created, authRequestId: auth?.id });
}
export async function login(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try { const input = loginSchema.parse(raw); return await beginLogin(input, context(rawContext)) as ActionResult; }
  catch (error) { return actionError(error); }
}
export async function startPasskey(raw: unknown, rawContext: AuthContext): Promise<ChallengeResult> {
  try { const input = z.object({ loginName: loginNameSchema }).parse(raw); return await beginLogin({ ...input, passkey: true }, context(rawContext)) as ChallengeResult; }
  catch (error) { return actionError(error); }
}
export async function finishPasskey(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const assertion = z.record(z.string(), z.unknown()).parse(raw);
    const ctx = context(rawContext); const session = await readPendingSession();
    if (!session || session.authRequestId !== ctx.authRequestId) throw new AuthError("通行密钥登录已过期，请重新开始。");
    const result = await zitadel.verifyWebAuthn(session, assertion as never);
    return await finishOrFactor({ ...session, ...result }, session.methods, session.userId);
  } catch (error) { return actionError(error); }
}
export async function verifyFactor(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = z.object({ method: factorSchema, code: z.string().trim().min(1).max(256) }).parse(raw);
    const ctx = context(rawContext); const session = await readPendingSession();
    if (!session || session.authRequestId !== ctx.authRequestId || !session.methods?.includes(input.method)) throw new AuthError("此登录会话或验证方式已失效，请重新登录。");
    if (session.needsEnrollment) throw new AuthError("请先完成验证方式设置。");
    const result = await zitadel.verifyFactor(session, input.method, input.code);
    return await finishOrFactor({ ...session, ...result }, session.methods, session.userId, true);
  } catch (error) { return actionError(error); }
}
export async function startTotpEnrollment(rawContext: AuthContext): Promise<ChallengeResult> {
  try {
    const ctx = context(rawContext); const session = await readPendingSession();
    if (!session || session.authRequestId !== ctx.authRequestId || !session.userId || !session.needsEnrollment) throw new AuthError("此登录会话不需要新的验证器设置。");
    const policy = await zitadel.policy(await zitadel.organizationForUser(session.userId));
    if (!policy.factors.includes("totp")) throw new AuthError("当前账号策略未允许验证器动态码。");
    const result = await zitadel.enrollTotp(session.userId);
    return { ok: true, uri: result.uri, secret: result.secret };
  } catch (error) { return actionError(error); }
}
export async function finishTotpEnrollment(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const { code } = verifyTotpSchema.parse(raw); const ctx = context(rawContext); const session = await readPendingSession();
    if (!session || session.authRequestId !== ctx.authRequestId || !session.userId || !session.needsEnrollment) throw new AuthError("此登录会话不需要新的验证器设置。");
    await zitadel.confirmTotp(session.userId, code);
    const updated = await zitadel.verifyFactor(session, "totp", code);
    return await finishOrFactor({ ...updated, authRequestId: session.authRequestId }, ["totp"], session.userId, true);
  } catch (error) { return actionError(error); }
}
export async function beginFactor(raw: unknown, rawContext: AuthContext): Promise<ChallengeResult> {
  try {
    const input = z.object({ method: z.enum(["otpEmail", "otpSms", "u2f"]) }).parse(raw);
    const ctx = context(rawContext); const session = await readPendingSession();
    if (!session || session.authRequestId !== ctx.authRequestId || !session.methods?.includes(input.method)) throw new AuthError("此登录会话或验证方式已失效，请重新登录。");
    const result = await zitadel.challenge(session, input.method);
    await writePendingSession({ sessionId: result.sessionId, sessionToken: result.sessionToken, authRequestId: session.authRequestId, methods: session.methods, userId: session.userId });
    return { ok: true, options: result.challenges?.webAuthN?.publicKeyCredentialRequestOptions as Record<string, unknown> | undefined };
  } catch (error) { return actionError(error); }
}
export async function register(raw: unknown, rawContext: AuthContext): Promise<ActionResult> {
  try {
    const input = registerSchema.parse(raw); const ctx = context(rawContext);
    const organizationId = await zitadel.organizationForAuth(ctx.authRequestId);
    const policy = await zitadel.policy(organizationId);
    if (!policy.registration) throw new AuthError("此组织未开放自主注册。");
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
  try { const input = verifyEmailSchema.parse(raw); const ctx = context(rawContext); if (!ctx.userId) throw new AuthError("验证链接缺少账号标识。"); await zitadel.verifyEmail(ctx.userId, input.code); return { ok: true, message: "邮箱已验证。" }; }
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
