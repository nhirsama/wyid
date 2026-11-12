import { AuthPanel } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";
import { authContext, authLink, type LoginPolicy } from "@/lib/auth";
import { withBasePath } from "@/lib/paths";
import { zitadel } from "@/server/zitadel/service";
import { Notice } from "@/components/ui/form";
import { ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { redirect } from "next/navigation";
import { actionError } from "@/server/errors";
import { AppLink } from "@/components/ui/app-link";
import { ResumeLoginForm } from "@/components/auth/resume-login-form";
import { readAuthenticatedSession } from "@/server/session";
import { requiresFreshLogin } from "@/server/authentication";

export const metadata = { title: "登录" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const context = authContext(params);
  const panel = { title: "登录账号", description: "一个账号，连接你的网站。" };
  let request: Awaited<ReturnType<typeof zitadel.authRequest>> | undefined;
  let policy: LoginPolicy | undefined;
  let callbackUrl: string | undefined;
  let reuse = false;
  let failure: ReturnType<typeof actionError> | undefined;
  try {
    request = context.authRequestId ? await zitadel.authRequest(context.authRequestId) : undefined;
    // Only expose flow context to the client, never the encrypted Session
    // credential. The POST action rechecks all live ZITADEL requirements.
    reuse = !requiresFreshLogin(request) && !!await readAuthenticatedSession();
    if (!reuse && request?.prompt.includes(Prompt.NONE)) {
      callbackUrl = await zitadel.deny(request.id, ErrorReason.LOGIN_REQUIRED);
    } else if (!reuse) {
      // Reuse the verified request. A second lookup adds latency and can expire
      // between reads, even though the page already has the organization scope.
      policy = await zitadel.policy(await zitadel.organizationForAuth(request));
    }
  } catch (error) {
    failure = actionError(error);
  }
  // Next redirects are control flow, not upstream errors.
  if (callbackUrl) redirect(callbackUrl);
  if (reuse) return <AuthPanel {...panel}><ResumeLoginForm context={context} /></AuthPanel>;
  if (!policy) return <AuthPanel {...panel}>
    <Notice kind="error">{failure?.message || "暂时无法读取登录方式，请重新加载。"}</Notice>
    <div className="result-stack">
      <a className="button primary-button wide" href={withBasePath(authLink("/login", context))}>重新加载</a>
      {context.authRequestId && <AppLink className="text-link centered" href="/login">直接登录账号</AppLink>}
    </div>
  </AuthPanel>;
  const initialContext = { ...context, loginHint: context.loginHint || request?.loginHint };
  return <AuthPanel {...panel}>
    {params.idpError === "1" && <Notice kind="error">身份提供方登录未完成，请重试或选择其他登录方式。</Notice>}
    <LoginForm context={initialContext} policy={policy} />
  </AuthPanel>;
}
