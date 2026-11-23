import { AuthPanel } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forms";
import { authContext, authLink, type LoginPolicy } from "@/lib/auth";
import { withBasePath } from "@/lib/paths";
import { Notice } from "@/components/ui/form";
import { AppLink } from "@/components/ui/app-link";
import { actionError } from "@/server/errors";
import { zitadel } from "@/server/zitadel/service";

export const metadata = { title: "找回密码" };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams);
  let policy: LoginPolicy | undefined;
  let failure: ReturnType<typeof actionError> | undefined;
  try {
    policy = await zitadel.policy(await zitadel.organizationForAuth(context.authRequestId));
  } catch (error) {
    failure = actionError(error);
  }
  return <AuthPanel title="找回密码" description="输入注册邮箱或用户名以接收密码重置邮件。">
    {!policy ? <div className="result-stack">
      <Notice kind="error">{failure?.message || "暂时无法读取密码重置设置，请重新加载。"}{failure?.requestId && <small className="request-id">请求编号：{failure.requestId}</small>}</Notice>
      <a className="button primary-button wide" href={withBasePath(authLink("/forgot-password", context))}>重新加载</a>
      <AppLink className="text-link centered" href={authLink("/login", context)}>返回登录</AppLink>
    </div> : policy.passwordReset ? <ForgotPasswordForm context={context} /> : <div className="result-stack"><Notice>此组织当前未开放密码重置。</Notice><AppLink className="button secondary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>}
  </AuthPanel>;
}
