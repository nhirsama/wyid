import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import type { Duration } from "@bufbuild/protobuf/wkt";
import { makeReqCtx } from "@zitadel/client/v2";
import { CreateSessionRequestSchema, SetSessionRequestSchema } from "@zitadel/proto/zitadel/session/v2/session_service_pb.js";
import { CreateCallbackRequestSchema } from "@zitadel/proto/zitadel/oidc/v2/oidc_service_pb.js";
import { ErrorReason, type AuthRequest } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb.js";
import { PasskeysType, SecondFactorType, MultiFactorType } from "@zitadel/proto/zitadel/settings/v2/login_settings_pb.js";
import { AuthFactorState } from "@zitadel/proto/zitadel/user/v2/user_pb.js";
import { TextQueryMethod } from "@zitadel/proto/zitadel/object/v2/object_pb.js";
import { NotificationType } from "@zitadel/proto/zitadel/user/v2/password_pb.js";
import type { AddHumanUserRequest } from "@zitadel/proto/zitadel/user/v2/user_service_pb.js";
import { AddHumanUserRequestSchema } from "@zitadel/proto/zitadel/user/v2/user_service_pb.js";
import type { Factor, LoginPolicy, RegisterInput } from "@/lib/auth";
import { siteUrl } from "@/lib/paths";
import { getConfig } from "@/server/config";
import { AuthError } from "@/server/errors";
import { getClients } from "./sdk";

// 使用安装版本的消息类型，避免用字符串反射或自建 REST 协议绕过 SDK 校验。
type CheckInput = NonNullable<MessageInitShape<typeof CreateSessionRequestSchema>["checks"]>;
type ChallengeInput = NonNullable<MessageInitShape<typeof CreateSessionRequestSchema>["challenges"]>;
export type SessionRef = { sessionId: string; sessionToken: string };
function durationMs(value?: Duration): number | undefined {
  return value === undefined ? undefined : Number(value.seconds) * 1000 + value.nanos / 1_000_000;
}
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sessionRef(result: SessionRef): SessionRef {
  if (!result.sessionId || !result.sessionToken) throw new Error("ZITADEL returned an empty session");
  return { sessionId: result.sessionId, sessionToken: result.sessionToken };
}
function safeRedirect(value: string, allowHttp?: boolean) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  const localHttp = process.env.NODE_ENV !== "production" && url.protocol === "http:" && loopback;
  // OIDC callbacks pass an explicit application policy, overriding the local
  // development fallback used by identity-provider redirects.
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && (allowHttp ?? localHttp))) || url.username || url.password) throw new Error("Invalid upstream redirect");
  return value;
}
async function findOidcApplication(clientId: string) {
  if (!clientId) return undefined;
  let projectOffset = 0n;
  for (;;) {
    const projects = await getClients().management.listProjects({ query: { offset: projectOffset, limit: 100, asc: false }, queries: [] });
    for (const project of projects.result) {
      let appOffset = 0n;
      for (;;) {
        const apps = await getClients().management.listApps({ projectId: project.id, query: { offset: appOffset, limit: 100, asc: false }, queries: [] });
        const match = apps.result.find(app => app.config.case === "oidcConfig" && app.config.value.clientId === clientId);
        if (match) return match;
        const next = appOffset + BigInt(apps.result.length);
        if (!apps.result.length || next <= appOffset || next >= (apps.details?.totalResult ?? BigInt(apps.result.length))) break;
        appOffset = next;
      }
    }
    const next = projectOffset + BigInt(projects.result.length);
    if (!projects.result.length || next <= projectOffset || next >= (projects.details?.totalResult ?? BigInt(projects.result.length))) break;
    projectOffset = next;
  }
  return undefined;
}
async function callbackAllowsHttp(request: AuthRequest) {
  const http = new URL(request.redirectUri).protocol === "http:";
  safeRedirect(request.redirectUri, http);
  if (!http) return false;
  // Check before CreateCallback consumes the request. Unknown or unreadable
  // application settings must not grant an HTTP exemption, and are not MFA errors.
  const app = await findOidcApplication(request.clientId).catch(() => undefined);
  if (!app) throw new AuthError("无法读取当前应用的开发模式，不允许使用 HTTP 回调。");
  if (app.config.case !== "oidcConfig" || app.config.value.devMode !== true) throw new AuthError("当前应用未开启开发模式，不允许使用 HTTP 回调。");
  return true;
}
function mailTemplate(path: string, authRequestId?: string) {
  const base = siteUrl(path, getConfig().appUrl);
  if (authRequestId) base.searchParams.set("authRequest", authRequestId);
  // ZITADEL notification URL template variables are expanded by the upstream mailer.
  return `${base}${base.search ? "&" : "?"}userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}`;
}
export const zitadel = {
  async authRequest(authRequestId: string) {
    const result = await getClients().oidc.getAuthRequest({ authRequestId });
    if (!result.authRequest) throw new AuthError("登录请求已失效，请从应用重新发起登录。");
    return result.authRequest;
  },
  async canSkipConsent(clientId: string) {
    if (!clientId) return false;
    const config = getConfig();
    // Only an exact OIDC client ID found inside an explicitly trusted project
    // can bypass the confirmation screen. Any lookup failure fails closed.
    for (const projectId of config.skipConsentProjectIds) {
      try {
        let offset = 0n;
        for (;;) {
          const page = await getClients().management.listApps({ projectId, query: { offset, limit: 100, asc: false }, queries: [] });
          if (page.result.some(app => app.config.case === "oidcConfig" && app.config.value.clientId === clientId)) return true;
          const next = offset + BigInt(page.result.length);
          if (!page.result.length || next <= offset || next >= (page.details?.totalResult ?? BigInt(page.result.length))) break;
          offset = next;
        }
      } catch {
        // An unreadable or removed project must never silently grant an exemption.
      }
    }
    return false;
  },
  async applicationName(clientId: string) {
    try {
      return (await findOidcApplication(clientId))?.name.trim() || "";
    } catch {
      // The redirect host remains a useful display fallback when this service
      // account cannot inspect an application or project.
    }
    return "";
  },
  async organizationForAuth(auth?: string | AuthRequest) {
    if (!auth) return getConfig().organizationId;
    const request = typeof auth === "string" ? await this.authRequest(auth) : auth;
    const organizationScope = request.scope.find(scope => scope.startsWith("urn:zitadel:iam:org:id:"));
    return organizationScope?.slice("urn:zitadel:iam:org:id:".length) || getConfig().organizationId;
  },
  async policy(organizationId = getConfig().organizationId): Promise<LoginPolicy> {
    const request = { ctx: makeReqCtx(organizationId) };
    const settings = getClients().settings;
    const [login, password] = await Promise.all([settings.getLoginSettings(request), settings.getPasswordComplexitySettings(request)]);
    if (!login.settings || !password.settings) throw new Error("ZITADEL settings are missing");
    const value = login.settings;
    const p = password.settings;
    const providers = value.allowExternalIdp ? (await settings.getActiveIdentityProviders(request)).identityProviders : [];
    const factors: Factor[] = [];
    if (value.secondFactors.includes(SecondFactorType.OTP)) factors.push("totp");
    if (value.secondFactors.includes(SecondFactorType.OTP_EMAIL)) factors.push("otpEmail");
    if (value.secondFactors.includes(SecondFactorType.OTP_SMS)) factors.push("otpSms");
    if (value.secondFactors.includes(SecondFactorType.U2F)) factors.push("u2f");
    return {
      password: value.allowUsernamePassword, registration: value.allowRegister,
      passwordReset: value.allowUsernamePassword && !value.hidePasswordReset, passkey: value.passkeysType === PasskeysType.ALLOWED,
      forceMfa: value.forceMfa, forceMfaLocalOnly: value.forceMfaLocalOnly, factors,
      userVerifiedKey: value.multiFactors.includes(MultiFactorType.U2F_WITH_VERIFICATION),
      passwordLifetimeMs: durationMs(value.passwordCheckLifetime),
      externalLoginLifetimeMs: durationMs(value.externalLoginCheckLifetime),
      secondFactorLifetimeMs: durationMs(value.secondFactorCheckLifetime),
      multiFactorLifetimeMs: durationMs(value.multiFactorCheckLifetime),
      passwordPolicy: { minLength: Number(p.minLength), uppercase: p.requiresUppercase, lowercase: p.requiresLowercase, number: p.requiresNumber, symbol: p.requiresSymbol },
      identityProviders: providers.map(provider => ({ id: provider.id, name: provider.name, creationAllowed: Boolean(provider.options?.isCreationAllowed), autoCreation: Boolean(provider.options?.isAutoCreation) })),
    };
  },
  async createSession(checks: CheckInput, challenges?: ChallengeInput) {
    const result = await getClients().session.createSession(create(CreateSessionRequestSchema, { checks, challenges }));
    return { ...sessionRef(result), challenges: result.challenges };
  },
  async updateSession(session: SessionRef, checks?: CheckInput, challenges?: ChallengeInput) {
    const result = await getClients().session.setSession(create(SetSessionRequestSchema, { ...session, checks, challenges }));
    if (!result.sessionToken) throw new Error("ZITADEL returned an empty session token");
    return { ...session, sessionToken: result.sessionToken, challenges: result.challenges };
  },
  async session(session: SessionRef) {
    const result = await getClients().session.getSession(session);
    if (!result.session?.factors?.user) throw new AuthError("登录会话已失效，请重新登录。");
    return result.session;
  },
  async deleteSession(session: SessionRef) { await getClients().session.deleteSession(session); },
  async user(userId: string) {
    const { user } = await getClients().user.getUserByID({ userId });
    if (!user || user.type.case !== "human") throw new AuthError("此账号无法使用网页登录。");
    return user;
  },
  async organizationForUser(userId: string) {
    const user = await this.user(userId);
    return user.details?.resourceOwner || getConfig().organizationId;
  },
  async methods(userId: string): Promise<Factor[]> {
    // Only enrolled second factors can create two-step verification entries.
    // A passkey registration is not a U2F security-key registration.
    const authentication = await getClients().user.listAuthenticationFactors({ userId, states: [AuthFactorState.READY] });
    const factors = new Set<Factor>();
    for (const factor of authentication.result) {
      if (factor.state !== AuthFactorState.READY) continue;
      switch (factor.type.case) {
        case "otp": factors.add("totp"); break;
        case "otpEmail": factors.add("otpEmail"); break;
        case "otpSms": factors.add("otpSms"); break;
        case "u2f": factors.add("u2f"); break;
      }
    }
    return [...factors];
  },
  async callback(authRequestId: string, session: SessionRef) {
    const allowHttp = await callbackAllowsHttp(await this.authRequest(authRequestId));
    const result = await getClients().oidc.createCallback(create(CreateCallbackRequestSchema, { authRequestId, callbackKind: { case: "session", value: session } }));
    return safeRedirect(result.callbackUrl, allowHttp);
  },
  async deny(authRequestId: string, reason = ErrorReason.ACCESS_DENIED) {
    const allowHttp = await callbackAllowsHttp(await this.authRequest(authRequestId));
    const result = await getClients().oidc.createCallback({ authRequestId, callbackKind: { case: "error", value: { error: reason } } });
    return safeRedirect(result.callbackUrl, allowHttp);
  },
  async register(input: RegisterInput, organizationId?: string, authRequestId?: string) {
    const username = input.username.trim();
    const result = await getClients().user.addHumanUser({
      organization: organizationId ? { org: { case: "orgId", value: organizationId } } : undefined,
      username,
      // ZITADEL requires both name fields. Reuse the username without asking
      // for, or inventing, a separate given name and family name.
      profile: { givenName: username, familyName: username, nickName: username, displayName: username, preferredLanguage: "zh" },
      email: { email: input.email, verification: { case: "sendCode", value: { urlTemplate: mailTemplate("/verify-email", authRequestId) } } },
      passwordType: { case: "password", value: { password: input.password, changeRequired: false } },
    });
    if (!result.userId) throw new Error("ZITADEL returned an empty user ID");
    return result.userId;
  },
  async findUser(loginName: string, organizationId?: string) {
    const result = await getClients().user.listUsers({ queries: [
      { query: { case: "loginNameQuery", value: { loginName, method: TextQueryMethod.EQUALS_IGNORE_CASE } } },
      ...(organizationId ? [{ query: { case: "organizationIdQuery" as const, value: { organizationId } } }] : []),
    ], query: { limit: 2 } });
    return result.result.length === 1 ? result.result[0] : undefined;
  },
  async requestPasswordReset(userId: string, authRequestId?: string) {
    await getClients().user.passwordReset({ userId, medium: { case: "sendLink", value: { notificationType: NotificationType.Email, urlTemplate: mailTemplate("/reset-password", authRequestId) } } });
  },
  async resetPassword(userId: string, password: string, code: string) {
    await getClients().user.setPassword({ userId, newPassword: { password, changeRequired: false }, verification: { case: "verificationCode", value: code } });
  },
  async changePassword(userId: string, password: string) {
    await getClients().user.setPassword({ userId, newPassword: { password, changeRequired: false } });
  },
  async verifyEmail(userId: string, verificationCode: string) { await getClients().user.verifyEmail({ userId, verificationCode }); },
  async sendEmailCode(userId: string, authRequestId?: string) {
    await getClients().user.resendEmailCode({ userId, verification: { case: "sendCode", value: { urlTemplate: mailTemplate("/verify-email", authRequestId) } } });
  },
  async challenge(session: SessionRef, method: Exclude<Factor, "totp">) {
    const challenges: ChallengeInput = method === "otpEmail" ? { otpEmail: { deliveryType: { case: "sendCode", value: {} } } }
      : method === "otpSms" ? { otpSms: { returnCode: false } }
      // DISCOURAGED selects ZITADEL's U2F credentials, not its passkey store.
      : { webAuthN: { domain: new URL(getConfig().appUrl).hostname, userVerificationRequirement: UserVerificationRequirement.DISCOURAGED } };
    return this.updateSession(session, undefined, challenges);
  },
  async verifyFactor(session: SessionRef, method: Factor, code: string) {
    if (method === "u2f") throw new AuthError("请使用安全密钥完成验证。");
    const checks: CheckInput = method === "totp" ? { totp: { code } }
      : method === "otpEmail" ? { otpEmail: { code } } : { otpSms: { code } };
    return this.updateSession(session, checks);
  },
  async verifyWebAuthn(session: SessionRef, assertion: JsonObject) {
    return this.updateSession(session, { webAuthN: { credentialAssertionData: assertion } });
  },
  async enrollTotp(userId: string) { return getClients().user.registerTOTP({ userId }); },
  async confirmTotp(userId: string, code: string) { await getClients().user.verifyTOTPRegistration({ userId, code }); },
  async startKeyEnrollment(userId: string): Promise<{ id: string; options: JsonObject }> {
    const domain = new URL(getConfig().appUrl).hostname;
    const result = await getClients().user.registerU2F({ userId, domain });
    const enrollment = { id: result.u2fId, options: result.publicKeyCredentialCreationOptions };
    const publicKey = isJsonObject(enrollment.options?.publicKey) ? enrollment.options.publicKey : enrollment.options;
    if (!enrollment.id || !publicKey || typeof publicKey.challenge !== "string" || !publicKey.challenge) {
      throw new Error("ZITADEL returned an invalid key registration challenge");
    }
    return { id: enrollment.id, options: { ...publicKey } };
  },
  async finishKeyEnrollment(userId: string, id: string, credential: JsonObject, name: string) {
    await getClients().user.verifyU2FRegistration({ userId, u2fId: id, publicKeyCredential: credential, tokenName: name });
  },
  async enrollOtp(userId: string, type: "otpEmail" | "otpSms") {
    const user = await this.user(userId);
    if (user.type.case !== "human") throw new AuthError("此账号无法绑定验证方式。");
    const contact = type === "otpEmail" ? user.type.value.email : user.type.value.phone;
    if (!contact?.isVerified) throw new AuthError(type === "otpEmail" ? "请先验证账号邮箱。" : "请先添加并验证手机号码。");
    if (type === "otpEmail") await getClients().user.addOTPEmail({ userId });
    else await getClients().user.addOTPSMS({ userId });
  },
  async setEnrollmentPhone(userId: string, phone: string) {
    await getClients().user.setPhone({ userId, phone, verification: { case: "sendCode", value: {} } });
  },
  async verifyEnrollmentPhone(userId: string, code: string) {
    await getClients().user.verifyPhone({ userId, verificationCode: code });
  },
  async startIdp(idpId: string, state: string) {
    const url = siteUrl("/idp/callback", getConfig().appUrl);
    url.searchParams.set("state", state);
    const result = await getClients().user.startIdentityProviderIntent({ idpId, content: { case: "urls", value: { successUrl: url.toString(), failureUrl: `${url}&failed=1` } } });
    if (result.nextStep.case === "authUrl") return { ...result, nextStep: { case: "authUrl" as const, value: safeRedirect(result.nextStep.value) } };
    if (result.nextStep.case === "formData") return { ...result, nextStep: { case: "formData" as const, value: { ...result.nextStep.value, url: safeRedirect(result.nextStep.value.url) } } };
    return result;
  },
  async retrieveIdp(idpIntentId: string, idpIntentToken: string) {
    return getClients().user.retrieveIdentityProviderIntent({ idpIntentId, idpIntentToken });
  },
  async registerIdpUser(request: AddHumanUserRequest) {
    return getClients().user.addHumanUser(create(AddHumanUserRequestSchema, request));
  },
};
