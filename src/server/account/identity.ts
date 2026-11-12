import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Account, PublicConfig } from "@/lib/account/types";
import { inspectAuthentication, type AuthenticationState } from "@/server/authentication";
import { getConfig } from "@/server/config";
import { readAuthenticatedSession, type AuthenticatedSession } from "@/server/session";
import { AccountError } from "./errors";

export type Identity = { ref: AuthenticatedSession; state: AuthenticationState; organizationId: string };

export async function accountIdentity(allowFactorCheck = false): Promise<Identity> {
  const ref = await readAuthenticatedSession();
  if (!ref) throw new AccountError(401, "authentication_required", "登录会话已失效，请重新登录。");
  let state: AuthenticationState;
  try { state = await inspectAuthentication(ref, ref.userId); }
  catch { throw new AccountError(401, "session_expired", "登录会话已失效，请重新登录。"); }
  if (state.step !== "complete" && !(allowFactorCheck && state.step === "mfa")) throw new AccountError(403, "authentication_incomplete", "请先完成账号要求的身份验证。");
  const organizationId = state.user.details?.resourceOwner || getConfig().organizationId;
  if (!organizationId) throw new AccountError(403, "organization_missing", "无法确定账号所属组织。");
  return { ref, state, organizationId };
}

export function accountProfile(user: AuthenticationState["user"]): Account {
  if (user.type.case !== "human") throw new Error("Expected human account");
  const { profile, email } = user.type.value;
  return { id: user.userId, displayName: profile?.displayName || user.username, givenName: profile?.givenName || "", familyName: profile?.familyName || "", email: email?.email || "", emailVerified: email?.isVerified === true, preferredLanguage: profile?.preferredLanguage || "zh-CN", avatarUrl: profile?.avatarUrl || undefined };
}

export function issuerOrigin() {
  const config = getConfig();
  const host = config.externalDomain || config.customRequestHeaders.host;
  return host ? `https://${host}` : config.apiUrl;
}
export function accountConfig(state: AuthenticationState): PublicConfig {
  const p = state.policy.passwordPolicy;
  return { configured: true, missing: [], issuer: issuerOrigin(), loginMethods: { password: state.policy.password, registration: state.policy.registration, passkey: state.policy.passkey }, passwordPolicy: { minLength: p.minLength, hasUppercase: p.uppercase, hasLowercase: p.lowercase, hasNumber: p.number, hasSymbol: p.symbol } };
}
export function isoDate(value?: Timestamp) {
  return value ? new Date(Number(value.seconds) * 1000 + value.nanos / 1_000_000).toISOString() : "";
}
