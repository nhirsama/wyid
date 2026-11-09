import { redirect } from "next/navigation";
import { ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { AuthPanel } from "@/components/auth/auth-shell";
import { ConsentForm } from "@/components/auth/consent-form";
import { AppLink } from "@/components/ui/app-link";
import { Notice } from "@/components/ui/form";
import { authContext, authLink } from "@/lib/auth";
import { consentToken } from "@/server/consent";
import { getConfig } from "@/server/config";
import { readPendingSession } from "@/server/session";
import { zitadel } from "@/server/zitadel/service";

export const metadata = { title: "确认授权" };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams);
  const pending = await readPendingSession();
  if (!context.authRequestId || !pending || pending.authRequestId !== context.authRequestId || !pending.sessionId || !pending.sessionToken || !pending.userId || pending.methods?.length) {
    return <AuthPanel title="授权会话已过期" description="请回到你正在访问的网站，重新发起登录。">
      <div className="result-stack"><Notice kind="error">无法恢复这次授权请求，请重新登录后继续。</Notice><AppLink className="button primary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>
    </AuthPanel>;
  }

  let request: Awaited<ReturnType<typeof zitadel.authRequest>> | undefined;
  try { request = await zitadel.authRequest(context.authRequestId); }
  catch { request = undefined; }
  if (!request) {
    return <AuthPanel title="授权请求不可用" description="登录请求可能已过期或发生变化。">
      <div className="result-stack"><Notice kind="error">请回到你正在访问的网站，重新发起登录。</Notice><AppLink className="button primary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>
    </AuthPanel>;
  }
  if (request.prompt.includes(Prompt.NONE)) redirect(await zitadel.deny(request.id, ErrorReason.CONSENT_REQUIRED));

  let view: { appName: string; appHost: string; token: string; scopes: string[]; displayName: string; email: string } | undefined;
  try {
    const [session, user] = await Promise.all([zitadel.session(pending), zitadel.user(pending.userId)]);
    if (session.factors?.user?.id !== pending.userId || user.type.case !== "human") throw new Error("invalid account session");
    const appHost = new URL(request.redirectUri).host;
    const registeredAppName = await zitadel.applicationName(request.clientId);
    const appName = registeredAppName || appHost;
    const profile = user.type.value.profile;
    const email = user.type.value.email?.email || "";
    const displayName = profile?.displayName || profile?.nickName || user.preferredLoginName || user.username;
    view = { appName, appHost, scopes: request.scope, displayName, email, token: consentToken(request, pending, getConfig().sessionSecret) };
  } catch { view = undefined; }
  if (!view) {
    return <AuthPanel title="授权请求不可用" description="登录请求可能已过期或发生变化。">
      <div className="result-stack"><Notice kind="error">请回到你正在访问的网站，重新发起登录。</Notice><AppLink className="button primary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>
    </AuthPanel>;
  }

  return <AuthPanel title="确认授权" description={<>继续登录 <strong>{view.appName}</strong>{view.appHost !== view.appName && <small className="app-host">{view.appHost}</small>}</>}>
    <ConsentForm authRequestId={request.id} consentToken={view.token} scopes={view.scopes} displayName={view.displayName} email={view.email} />
  </AuthPanel>;
}
