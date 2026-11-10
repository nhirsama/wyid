import { AuthPanel } from "@/components/auth/auth-shell";
import { AppLink } from "@/components/ui/app-link";
import { ContinueAuthenticationForm, LoginEmailVerificationForm, LoginPasswordChangeForm, MfaEnrollmentForm, MfaVerificationForm } from "@/components/auth/mfa-forms";
import { Notice } from "@/components/ui/form";
import { authContext, authLink } from "@/lib/auth";
import { inspectAuthentication, type AuthenticationState } from "@/server/authentication";
import { readPendingSession } from "@/server/session";

export const metadata = { title: "身份验证" };
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams);
  const pending = await readPendingSession();
  let state: AuthenticationState | undefined;
  if (pending && pending.authRequestId === context.authRequestId && pending.sessionId && pending.sessionToken) {
    try { state = await inspectAuthentication(pending, pending.userId, pending.requireMfa); }
    catch { /* No authentication UI or success state may rely on stale cookie metadata. */ }
  }
  const title = state?.step === "password-change" ? "更新登录密码" : state?.step === "verify-email" ? "验证账号邮箱" : state?.step === "mfa" && state.needsEnrollment ? "设置验证方式" : "验证你的身份";
  return <AuthPanel title={title} description="完成验证后即可继续登录。">
    {!state ? <div className="result-stack"><Notice kind="error">登录验证会话不可用，请重试或重新登录。</Notice><AppLink className="button primary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>
      : state.step === "password-change" ? <LoginPasswordChangeForm context={context} policy={state.policy} />
      : state.step === "verify-email" ? <LoginEmailVerificationForm context={context} />
      : state.step === "mfa" ? state.needsEnrollment ? <MfaEnrollmentForm context={context} methods={state.methods} /> : <MfaVerificationForm context={context} methods={state.methods} />
      : <ContinueAuthenticationForm context={context} />}
  </AuthPanel>;
}
