import { AuthPanel } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";
import { authContext } from "@/lib/auth";
import { zitadel } from "@/server/zitadel/service";
import { Notice } from "@/components/ui/form";
import { ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import { redirect } from "next/navigation";
import { getBrand } from "@/server/brand";

export const metadata = { title: "登录" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const context = authContext(params);
  const brand = getBrand();
  const request = context.authRequestId ? await zitadel.authRequest(context.authRequestId) : undefined;
  if (request?.prompt.includes(Prompt.NONE)) redirect(await zitadel.deny(request.id, ErrorReason.LOGIN_REQUIRED));
  const policy = await zitadel.policy(await zitadel.organizationForAuth(context.authRequestId));
  const initialContext = { ...context, loginHint: context.loginHint || request?.loginHint };
  return <AuthPanel title="登录账号" description={request ? "登录后将返回你正在访问的应用。" : `使用 ${brand.nickname} 登录。`}>
    {params.idpError === "1" && <Notice kind="error">身份提供方登录未完成，请重试或选择其他登录方式。</Notice>}
    <LoginForm context={initialContext} policy={policy} />
  </AuthPanel>;
}
