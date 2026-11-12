import { passwordHint, passwordMeetsPolicy } from "@/lib/auth";
import { siteUrl } from "@/lib/paths";
import { getConfig, zitadelRequestHeaders } from "@/server/config";
import { writePendingSession } from "@/server/session";
import { getUserClients } from "@/server/zitadel/sdk";
import { zitadel } from "@/server/zitadel/service";
import { assert } from "./errors";
import { persistRotation } from "./factors";
import { accountProfile, type Identity } from "./identity";

export async function updateProfile(identity: Identity, input: { displayName: string; preferredLanguage: string }) {
  assert(identity.state.user.type.case === "human", 400, "human_required", "此账号无法修改个人资料。");
  try { new Intl.Locale(input.preferredLanguage); }
  catch { assert(false, 400, "invalid_language", "通知语言格式无效。"); }
  const profile = identity.state.user.type.value.profile;
  assert(profile?.givenName && profile.familyName, 400, "profile_missing", "账号资料不完整，请联系管理员。");
  await getUserClients(identity.ref.sessionToken, identity.organizationId).user.updateHumanUser({ userId: identity.ref.userId, profile: { givenName: profile.givenName, familyName: profile.familyName, nickName: profile.nickName, gender: profile.gender, displayName: input.displayName, preferredLanguage: input.preferredLanguage } });
  return { account: accountProfile(await zitadel.user(identity.ref.userId)) };
}
export async function updateEmail(identity: Identity, input: { email: string; password: string }) {
  await persistRotation(identity, await zitadel.updateSession(identity.ref, { password: { password: input.password } }));
  const url = `${siteUrl("/verify-email", getConfig().appUrl)}?userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}`;
  await getUserClients(identity.ref.sessionToken, identity.organizationId).user.setEmail({ userId: identity.ref.userId, email: input.email, verification: { case: "sendCode", value: { urlTemplate: url } } });
  // Reuse the current project's email-verification flow, not a second login system.
  await writePendingSession({ sessionId: identity.ref.sessionId, sessionToken: identity.ref.sessionToken, userId: identity.ref.userId, mfaStartedAt: identity.ref.mfaStartedAt });
  return { userId: identity.ref.userId, account: accountProfile(await zitadel.user(identity.ref.userId)) };
}
export async function updatePassword(identity: Identity, input: { currentPassword: string; password: string }) {
  assert(passwordMeetsPolicy(input.password, identity.state.policy.passwordPolicy), 400, "password_policy", `密码不符合要求：${passwordHint(identity.state.policy.passwordPolicy)}。`);
  await getUserClients(identity.ref.sessionToken, identity.organizationId).user.setPassword({ userId: identity.ref.userId, newPassword: { password: input.password, changeRequired: false }, verification: { case: "currentPassword", value: input.currentPassword } });
  return { updated: true };
}
export async function uploadAvatar(identity: Identity, file: File) {
  const config = getConfig();
  const form = new FormData(); form.append("file", file);
  const response = await fetch(`${config.apiUrl}/assets/v1/users/me/avatar`, { method: "POST", headers: { ...zitadelRequestHeaders(config), Authorization: `Bearer ${identity.ref.sessionToken}` }, body: form, signal: AbortSignal.timeout(15_000), redirect: "error", cache: "no-store" });
  assert(response.ok, 502, "avatar_upload_failed", "头像上传失败，请确认图片格式后重试。");
  await response.body?.cancel();
  return { account: accountProfile(await zitadel.user(identity.ref.userId)) };
}
export async function removeAvatar(identity: Identity) {
  await getUserClients(identity.ref.sessionToken, identity.organizationId).auth.removeMyAvatar({});
  return { account: accountProfile(await zitadel.user(identity.ref.userId)) };
}
