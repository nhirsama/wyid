import { AuthPanel } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { authContext, authLink, type LoginPolicy } from "@/lib/auth";
import { withBasePath } from "@/lib/paths";
import { Notice } from "@/components/ui/form";
import { AppLink } from "@/components/ui/app-link";
import { actionError } from "@/server/errors";
import { zitadel } from "@/server/zitadel/service";

export const metadata = { title: "设置新密码" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams);
  if (!context.userId) {
    return <AuthPanel title="设置新密码">
      <div className="result-stack">
        <Notice kind="error">请从密码重置邮件中的链接打开此页面。</Notice>
        <AppLink className="button secondary-button wide" href={authLink("/login", context)}>返回登录</AppLink>
      </div>
    </AuthPanel>;
  }
  let policy: LoginPolicy | undefined;
  let failure: ReturnType<typeof actionError> | undefined;
  try {
    const organizationId = await zitadel.organizationForUser(context.userId);
    policy = await zitadel.policy(organizationId);
  } catch (error) {
    failure = actionError(error);
  }
  const reloadQuery = new URLSearchParams({ userId: context.userId });
  if (context.authRequestId) reloadQuery.set("authRequest", context.authRequestId);
  if (context.code) reloadQuery.set("code", context.code);
  return <AuthPanel title="设置新密码">
    {!policy ? <div className="result-stack">
      <Notice kind="error">{failure?.message || "暂时无法读取密码设置，请重新加载。"}{failure?.requestId && <small className="request-id">请求编号：{failure.requestId}</small>}</Notice>
      <a className="button primary-button wide" href={withBasePath(`/reset-password?${reloadQuery}`)}>重新加载</a>
      <AppLink className="text-link centered" href={authLink("/login", context)}>返回登录</AppLink>
    </div> : policy.passwordReset ? <ResetPasswordForm context={context} policy={policy} /> : <div className="result-stack"><Notice>此组织当前未开放密码重置。</Notice><AppLink className="button secondary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>}
  </AuthPanel>;
}
