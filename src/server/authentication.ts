import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { factorSchema, type Factor, type LoginPolicy } from "@/lib/auth";
import { getConfig } from "./config";
import { AuthError } from "./errors";
import { zitadel, type SessionRef } from "./zitadel/service";

type Session = Awaited<ReturnType<typeof zitadel.session>>;
type User = Awaited<ReturnType<typeof zitadel.user>>;
export type AuthenticationStep = "complete" | "password-change" | "verify-email" | "mfa";
export type AuthenticationState = {
  step: AuthenticationStep;
  userId: string;
  session: Session;
  user: User;
  policy: LoginPolicy;
  methods: Factor[];
  needsEnrollment: boolean;
};

/** Only ZITADEL's timestamped session checks are proof, never a cookie flag. */
function checked(factor: { verifiedAt?: Timestamp } | undefined, lifetimeMs?: number, mfaStartedAt?: number) {
  if (!factor?.verifiedAt) return false;
  const now = Date.now();
  const verifiedAt = Number(factor.verifiedAt.seconds) * 1000 + factor.verifiedAt.nanos / 1_000_000;
  if (!Number.isFinite(verifiedAt) || verifiedAt > now + 5_000) return false;
  // A zero reuse window requires native proof from this login/step-up flow.
  // The encrypted flow boundary is only a lower bound, never proof by itself.
  // Completed portal visits retain their flow; every new login creates a new
  // Session and boundary, and re-entering step-up creates a fresh boundary.
  if (lifetimeMs === 0) return mfaStartedAt !== undefined && Number.isFinite(mfaStartedAt) && mfaStartedAt >= 0 && mfaStartedAt <= now && verifiedAt >= mfaStartedAt;
  return lifetimeMs === undefined || (Number.isFinite(lifetimeMs) && lifetimeMs >= 0 && now - verifiedAt <= lifetimeMs);
}

export function authenticationStep(session: Session, user: User, policy: LoginPolicy, enrolled: Factor[], requireMfa = false, mfaStartedAt?: number): Pick<AuthenticationState, "step" | "methods" | "needsEnrollment"> {
  const factors = session.factors;
  const password = checked(factors?.password);
  const external = checked(factors?.intent);
  const verifiedKey = factors?.webAuthN?.userVerified === true && checked(factors.webAuthN, policy.multiFactorLifetimeMs, mfaStartedAt);
  if (!password && !external && !(policy.passkey && factors?.webAuthN?.userVerified === true && checked(factors.webAuthN))) throw new AuthError("请先完成密码、通行密钥或身份提供方验证。");
  if (user.type.case !== "human") throw new AuthError("此账号无法使用网页登录。");
  const complete = { step: "complete" as const, methods: [], needsEnrollment: false };
  if (password && user.type.value.passwordChangeRequired) return { ...complete, step: "password-change" };
  if (user.type.value.email?.isVerified !== true) return { ...complete, step: "verify-email" };

  // A user-verified Passkey supplies both factors in a single ceremony.
  if (verifiedKey && (policy.passkey || policy.userVerifiedKey)) return complete;
  const methods = [...new Set(enrolled.filter(method => factorSchema.safeParse(method).success && policy.factors.includes(method)))];
  const local = password || (factors?.webAuthN?.userVerified === true && checked(factors.webAuthN));
  const forced = local ? policy.forceMfa || policy.forceMfaLocalOnly : policy.forceMfa && !policy.forceMfaLocalOnly;
  if (!requireMfa && !forced && methods.length === 0) return complete;
  const verified = methods.some(method => {
    if (method === "u2f") return checked(factors?.webAuthN, factors?.webAuthN?.userVerified ? policy.multiFactorLifetimeMs : policy.secondFactorLifetimeMs, mfaStartedAt);
    return checked(factors?.[method], policy.secondFactorLifetimeMs, mfaStartedAt);
  });
  if (verified) return complete;
  const enrollmentMethods = (["totp", "u2f", "otpEmail", "otpSms"] as Factor[]).filter(method => policy.factors.includes(method));
  if (!methods.length && !enrollmentMethods.length) throw new AuthError("账号策略要求额外验证，但没有可用的验证方式。请联系账号管理员。");
  return { step: "mfa", methods: methods.length ? methods : enrollmentMethods, needsEnrollment: methods.length === 0 };
}

/** Shared gate for direct login, OIDC consent/callback, and every account read. */
export async function inspectAuthentication(ref: SessionRef & { mfaStartedAt?: number }, expectedUserId?: string, requireMfa = false): Promise<AuthenticationState> {
  const session = await zitadel.session(ref);
  const userId = session.factors?.user?.id;
  if (!userId || (expectedUserId && userId !== expectedUserId)) throw new AuthError("登录账号已变化或会话已失效，请重新登录。");
  const user = await zitadel.user(userId);
  if (user.userId !== userId) throw new AuthError("登录账号与会话不匹配，请重新登录。");
  const [policy, methods] = await Promise.all([
    zitadel.policy(user.details?.resourceOwner || getConfig().organizationId),
    zitadel.methods(userId),
  ]);
  return { ...authenticationStep(session, user, policy, methods, requireMfa, ref.mfaStartedAt), session, user, userId, policy };
}
