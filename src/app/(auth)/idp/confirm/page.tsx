import { z } from "zod";
import { AuthPanel } from "@/components/auth/auth-shell";
import { IdentityProviderRegistration } from "@/components/auth/idp-registration";
import { Notice } from "@/components/ui/form";
import { readPendingSession } from "@/server/session";

export const metadata = { title: "确认创建账号" };

export default async function IdentityProviderConfirmation({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "";
  const pending = await readPendingSession();
  const valid = Boolean(pending?.idpState === state && pending.idpCreationAllowed && pending.idpIntentId && pending.idpIntentToken && pending.idpNewUser);
  const profile = valid ? z.object({ profile: z.object({ displayName: z.string().optional() }).optional(), email: z.object({ email: z.string().optional() }).optional() }).passthrough().safeParse(pending!.idpNewUser) : undefined;
  const label = profile?.success ? [profile.data.profile?.displayName, profile.data.email?.email].filter(Boolean).join(" · ") : "";
  return <AuthPanel title="确认创建账号" description="确认后将使用身份提供方的账号继续登录。">
    {valid ? <IdentityProviderRegistration state={state} accountLabel={label} /> : <Notice kind="error">账号创建请求已失效，请重新从应用发起登录。</Notice>}
  </AuthPanel>;
}
