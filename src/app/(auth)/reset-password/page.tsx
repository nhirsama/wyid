import { AuthPanel } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { authContext } from "@/lib/auth";
import { Notice } from "@/components/ui/form";
import { zitadel } from "@/server/zitadel/service";
export const metadata = { title: "设置新密码" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams); const organizationId = context.userId ? await zitadel.organizationForUser(context.userId) : undefined; const policy = await zitadel.policy(organizationId);
  return <AuthPanel title="设置新密码" description="验证邮件中的验证码并设置新密码。">
    {!context.userId ? <Notice kind="error">请从密码重置邮件中的链接打开此页面。</Notice> : policy.passwordReset ? <ResetPasswordForm context={context} policy={policy} /> : <Notice>此组织当前未开放密码重置。</Notice>}
  </AuthPanel>;
}
