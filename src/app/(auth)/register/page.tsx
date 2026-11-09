import { AuthPanel } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/forms";
import { authContext, authLink } from "@/lib/auth";
import { Notice } from "@/components/ui/form";
import { zitadel } from "@/server/zitadel/service";
import { AppLink } from "@/components/ui/app-link";
export const metadata = { title: "创建账号" };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams); const policy = await zitadel.policy(await zitadel.organizationForAuth(context.authRequestId));
  return <AuthPanel title="创建账号" description="填写账号信息，创建新账号。" back={authLink("/login", context)}>
    {policy.registration && policy.password ? <RegisterForm context={context} policy={policy} /> : <div className="result-stack"><Notice>此组织当前未开放密码账号注册。</Notice><AppLink className="button secondary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>}
  </AuthPanel>;
}
