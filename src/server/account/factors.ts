import type { JsonObject } from "@bufbuild/protobuf";
import { AuthFactorState } from "@zitadel/proto/zitadel/user/v2/user_pb.js";
import { UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb.js";
import type { AuthenticationMethod, FactorAvailability, FactorType, MethodsResponse } from "@/lib/account/types";
import { factorNames } from "@/lib/account/authentication";
import type { Factor } from "@/lib/auth";
import { inspectAuthentication } from "@/server/authentication";
import { getConfig } from "@/server/config";
import { clearAccountGrant, readAccountGrant, writeAccountGrant, writeAuthenticatedSession, type AccountGrant } from "@/server/session";
import { getClients, getUserClients } from "@/server/zitadel/sdk";
import { zitadel, type SessionRef } from "@/server/zitadel/service";
import { accountIdentity, type Identity } from "./identity";
import { assert } from "./errors";

const nativeFactors: Partial<Record<FactorType, Factor>> = { totp: "totp", webauthn: "u2f", "otp-email": "otpEmail", "otp-sms": "otpSms" };
export function availability(identity: Identity): FactorAvailability {
  const policy = identity.state.policy;
  return { totp: policy.factors.includes("totp"), webauthn: policy.factors.includes("u2f"), "otp-email": policy.factors.includes("otpEmail"), "otp-sms": policy.factors.includes("otpSms"), passkey: policy.passkey || policy.userVerifiedKey };
}
function allowed(identity: Identity, type: FactorType) { assert(availability(identity)[type], 403, "factor_disabled", "账号策略尚未启用此验证方式。"); }

export async function authenticationMethods(identity: Identity): Promise<MethodsResponse> {
  const userId = identity.ref.userId;
  const client = getClients().user;
  const [factors, keys] = await Promise.all([client.listAuthenticationFactors({ userId }), client.listPasskeys({ userId })]);
  const methods: AuthenticationMethod[] = factors.result.flatMap(factor => {
    const type: FactorType | undefined = factor.type.case === "otp" ? "totp" : factor.type.case === "u2f" ? "webauthn" : factor.type.case === "otpEmail" ? "otp-email" : factor.type.case === "otpSms" ? "otp-sms" : undefined;
    if (!type) return [];
    return [{ type, name: factor.type.case === "u2f" ? factor.type.value.name : factorNames[type], state: factor.state === AuthFactorState.READY ? "READY" : "NOT_READY", ...(factor.type.case === "u2f" ? { id: factor.type.value.id } : {}) }];
  });
  methods.push(...keys.result.map(key => ({ type: "passkey", id: key.id, name: key.name || factorNames.passkey, state: key.state === AuthFactorState.READY ? "READY" : "NOT_READY" })));
  const phone = identity.state.user.type.case === "human" ? identity.state.user.type.value.phone : undefined;
  return { methods, available: availability(identity), phone: { number: phone?.phone || "", verified: phone?.isVerified === true } };
}

async function startGrant(identity: Identity, type: AccountGrant["type"], phase: AccountGrant["phase"], id?: string) {
  const createdAt = Date.now();
  const grant: AccountGrant = { sessionId: identity.ref.sessionId, userId: identity.ref.userId, type, phase, id, createdAt, expiresAt: createdAt + 600_000 };
  await writeAccountGrant(grant);
  return grant;
}
export function assertBoundGrant(grant: AccountGrant | null, identity: Identity, type?: AccountGrant["type"], phase?: AccountGrant["phase"]): asserts grant is AccountGrant {
  assert(grant && grant.expiresAt > Date.now() && grant.createdAt <= Date.now() && grant.sessionId === identity.ref.sessionId && grant.userId === identity.ref.userId && (!type || grant.type === type) && (!phase || grant.phase === phase), 400, "enrollment_expired", "绑定请求已失效，请重新开始设置。");
}
export async function continuation(type?: AccountGrant["type"], phase?: AccountGrant["phase"]) {
  const identity = await accountIdentity(true);
  const grant = await readAccountGrant();
  assertBoundGrant(grant, identity, type, phase);
  allowed(identity, grant.type === "phone" ? "otp-sms" : grant.type);
  return { identity, grant };
}

function publicKeyOptions(options?: JsonObject) {
  const key = options?.publicKey;
  const result = key && typeof key === "object" && !Array.isArray(key) ? key : options;
  assert(result && typeof result.challenge === "string" && result.challenge, 502, "invalid_challenge", "身份服务未返回有效设备挑战。");
  return result;
}
export function discoverableOptions(options: JsonObject): JsonObject {
  const selection = options.authenticatorSelection;
  return { ...options, authenticatorSelection: { ...(selection && typeof selection === "object" && !Array.isArray(selection) ? selection : {}), residentKey: "required", requireResidentKey: true, userVerification: "required" } };
}
export async function startKey(identity: Identity, type: "passkey" | "webauthn") {
  allowed(identity, type);
  const client = getUserClients(identity.ref.sessionToken, identity.organizationId).user;
  const userId = identity.ref.userId, domain = new URL(getConfig().appUrl).hostname;
  if (type === "passkey") {
    // This endpoint requires user.passkey.write, not merely "authenticated".
    // Mint only for the live, fully authenticated caller's own user ID.
    const { code } = await getClients().user.createPasskeyRegistrationLink({ userId, medium: { case: "returnCode", value: {} } });
    assert(code?.id && code.code, 502, "invalid_registration", "身份服务未返回有效注册凭据。");
    const result = await client.registerPasskey({ userId, domain, code });
    assert(result.passkeyId, 502, "invalid_registration", "身份服务未返回通行密钥标识。");
    const publicKey = discoverableOptions(publicKeyOptions(result.publicKeyCredentialCreationOptions));
    await startGrant(identity, type, "register", result.passkeyId);
    return { publicKey };
  }
  const result = await client.registerU2F({ userId, domain });
  assert(result.u2fId, 502, "invalid_registration", "身份服务未返回安全密钥标识。");
  const publicKey = publicKeyOptions(result.publicKeyCredentialCreationOptions);
  await startGrant(identity, type, "register", result.u2fId);
  return { publicKey };
}
export async function finishKey(type: "passkey" | "webauthn", credential: JsonObject, name: string) {
  const { identity, grant } = await continuation(type, "register");
  assert(grant.id, 400, "invalid_registration", "缺少设备注册标识，请重新绑定。");
  const client = getClients().user;
  if (type === "passkey") await client.verifyPasskeyRegistration({ userId: identity.ref.userId, passkeyId: grant.id, publicKeyCredential: credential, passkeyName: name });
  else await client.verifyU2FRegistration({ userId: identity.ref.userId, u2fId: grant.id, publicKeyCredential: credential, tokenName: name });
  await writeAccountGrant({ ...grant, phase: "check" });
  return { verified: true };
}
export async function startTotp(identity: Identity) {
  allowed(identity, "totp");
  await startGrant(identity, "totp", "register");
  const result = await getUserClients(identity.ref.sessionToken, identity.organizationId).user.registerTOTP({ userId: identity.ref.userId });
  assert(result.secret && result.uri, 502, "invalid_registration", "身份服务未返回验证器密钥。");
  return { secret: result.secret, uri: result.uri };
}
export async function persistRotation(identity: Identity, updated: SessionRef) {
  identity.ref = { ...identity.ref, sessionToken: updated.sessionToken };
  // Persist first: a subsequent profile/policy read must not lose a rotated token.
  await writeAuthenticatedSession(identity.ref);
}
export function hasFreshFactor(identity: Identity, grant: AccountGrant) {
  const factors = identity.state.session.factors;
  const factor = grant.type === "passkey" || grant.type === "webauthn" ? factors?.webAuthN : grant.type === "phone" ? undefined : factors?.[nativeFactors[grant.type] as Exclude<Factor, "u2f">];
  if (!factor?.verifiedAt || grant.type === "passkey" && factors?.webAuthN?.userVerified !== true) return false;
  const verifiedAt = Number(factor.verifiedAt.seconds) * 1000 + factor.verifiedAt.nanos / 1_000_000;
  return verifiedAt >= grant.createdAt && verifiedAt <= Date.now() + 5000;
}
async function finishCheck(identity: Identity, grant: AccountGrant) {
  identity.state = await inspectAuthentication(identity.ref, identity.ref.userId);
  assert(hasFreshFactor(identity, grant), 403, "step_up_required", "请使用新绑定的验证方式完成身份验证。");
  assert(identity.state.step === "complete", 403, "authentication_incomplete", "账号还需要额外验证，请继续身份验证。");
  await clearAccountGrant();
  return { verified: true };
}
export async function confirmTotp(code: string) {
  const { identity, grant } = await continuation("totp");
  if (grant.phase === "register") {
    await getClients().user.verifyTOTPRegistration({ userId: identity.ref.userId, code });
    await writeAccountGrant({ ...grant, phase: "check" });
  }
  // Native enrollment is not session authentication proof.
  await persistRotation(identity, await zitadel.verifyFactor(identity.ref, "totp", code));
  return finishCheck(identity, grant);
}
export async function addOtp(identity: Identity, type: "otp-email" | "otp-sms") {
  allowed(identity, type);
  const human = identity.state.user.type;
  const contact = human.case === "human" ? type === "otp-email" ? human.value.email : human.value.phone : undefined;
  assert(contact?.isVerified, 400, "contact_verification_required", type === "otp-email" ? "请先验证账号邮箱。" : "请先验证手机号码。");
  await startGrant(identity, type, "check");
  const client = getUserClients(identity.ref.sessionToken, identity.organizationId).user;
  if (type === "otp-email") await client.addOTPEmail({ userId: identity.ref.userId });
  else await client.addOTPSMS({ userId: identity.ref.userId });
  return { added: true };
}
export async function sendCheck() {
  const { identity, grant } = await continuation(undefined, "check");
  assert(grant.type !== "phone", 400, "invalid_check", "请先验证手机号码。");
  if (grant.type === "totp") return { sent: false };
  if (grant.type === "passkey" || grant.type === "webauthn") {
    const updated = await zitadel.updateSession(identity.ref, undefined, { webAuthN: { domain: new URL(getConfig().appUrl).hostname, userVerificationRequirement: grant.type === "passkey" ? UserVerificationRequirement.REQUIRED : UserVerificationRequirement.DISCOURAGED } });
    await persistRotation(identity, updated);
    return { publicKey: publicKeyOptions(updated.challenges?.webAuthN?.publicKeyCredentialRequestOptions), method: grant.type === "passkey" ? "passkey" : "u2f" };
  }
  await persistRotation(identity, await zitadel.challenge(identity.ref, grant.type === "otp-email" ? "otpEmail" : "otpSms"));
  return { sent: true };
}
export async function checkFactor(input: { code?: string; credential?: JsonObject }) {
  const { identity, grant } = await continuation(undefined, "check");
  assert(grant.type !== "phone", 400, "invalid_check", "请先验证手机号码。");
  if (grant.type === "passkey" || grant.type === "webauthn") {
    assert(input.credential, 400, "invalid_credential", "请完成设备验证。");
    await persistRotation(identity, await zitadel.verifyWebAuthn(identity.ref, input.credential));
  } else {
    assert(input.code, 400, "invalid_code", "请输入验证码。");
    await persistRotation(identity, await zitadel.verifyFactor(identity.ref, nativeFactors[grant.type]!, input.code));
  }
  return finishCheck(identity, grant);
}
export async function removeFactor(identity: Identity, type: FactorType, id?: string) {
  const methods = await authenticationMethods(identity);
  assert(methods.methods.some(method => method.type === type && (type !== "passkey" && type !== "webauthn" || method.id === id)), 404, "factor_not_found", "此验证方式不存在，请刷新后重试。");
  const client = getUserClients(identity.ref.sessionToken, identity.organizationId).user;
  const userId = identity.ref.userId;
  if (type === "passkey") { assert(id, 400, "credential_required", "缺少凭据标识。"); await client.removePasskey({ userId, passkeyId: id }); }
  else if (type === "webauthn") { assert(id, 400, "credential_required", "缺少凭据标识。"); await client.removeU2F({ userId, u2fId: id }); }
  else if (type === "totp") await client.removeTOTP({ userId });
  else if (type === "otp-email") await client.removeOTPEmail({ userId });
  else await client.removeOTPSMS({ userId });
  await clearAccountGrant();
  return { removed: true };
}
export async function startPhone(identity: Identity, phone: string) {
  allowed(identity, "otp-sms");
  await startGrant(identity, "phone", "register");
  await getUserClients(identity.ref.sessionToken, identity.organizationId).user.setPhone({ userId: identity.ref.userId, phone, verification: { case: "sendCode", value: {} } });
  return { sent: true };
}
export async function confirmPhone(code: string) {
  const { identity, grant } = await continuation("phone", "register");
  await getClients().user.verifyPhone({ userId: identity.ref.userId, verificationCode: code });
  const factors = await getClients().user.listAuthenticationFactors({ userId: identity.ref.userId, states: [AuthFactorState.READY] });
  const checkRequired = factors.result.some(factor => factor.type.case === "otpSms" && factor.state === AuthFactorState.READY);
  if (checkRequired) await writeAccountGrant({ ...grant, type: "otp-sms", phase: "check" });
  else await clearAccountGrant();
  return { verified: true, checkRequired };
}
