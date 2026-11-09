import { AuthPanel } from "@/components/auth/auth-shell";
import { AppLink } from "@/components/ui/app-link";
import { TotpEnrollmentForm, VerifyFactorForm } from "@/components/auth/forms";
import { Notice } from "@/components/ui/form";
import { authContext, authLink, type Factor } from "@/lib/auth";
import { readPendingSession } from "@/server/session";
export const metadata = { title: "身份验证" };
export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams); const pending = await readPendingSession();
  const valid = Boolean(pending && pending.authRequestId === context.authRequestId && pending.methods?.length);
  return <AuthPanel title="完成身份验证" description="根据账号的验证设置，完成下一步验证。" back={authLink("/login", context)}>
    {valid ? pending?.needsEnrollment ? <TotpEnrollmentForm context={context} /> : <VerifyFactorForm context={context} methods={pending!.methods as Factor[]} /> : <div className="result-stack"><Notice kind="error">登录验证会话已过期，请重新开始。</Notice><AppLink className="button primary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>}
  </AuthPanel>;
}
