import { AuthPanel } from "@/components/auth/auth-shell";
import { VerifyEmailForm } from "@/components/auth/forms";
import { authContext } from "@/lib/auth";
export const metadata = { title: "验证邮箱" };
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = authContext(await searchParams);
  return <AuthPanel title="验证邮箱" description="输入验证邮件中的验证码，完成邮箱验证。"><VerifyEmailForm context={context} /></AuthPanel>;
}
