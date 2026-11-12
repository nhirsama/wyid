import { AuthPanel } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forms";
import { authContext } from "@/lib/auth";
import { Notice } from "@/components/ui/form";
import { zitadel } from "@/server/zitadel/service";
export const metadata = { title: "找回密码" };
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams); const policy = await zitadel.policy(await zitadel.organizationForAuth(context.authRequestId));
  return <AuthPanel title="找回密码" description="输入注册邮箱或用户名，我们会在账号符合条件时发送密码重置邮件。">
    {policy.passwordReset ? <ForgotPasswordForm context={context} /> : <Notice>此组织当前未开放密码重置。</Notice>}
  </AuthPanel>;
}
