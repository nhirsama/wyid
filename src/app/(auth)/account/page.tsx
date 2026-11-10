import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-shell";
import { Notice } from "@/components/ui/form";
import { readAuthenticatedSession } from "@/server/session";
import { inspectAuthentication, type AuthenticationState } from "@/server/authentication";
import { logout, resumeAccountAuthentication } from "@/server/actions";
import { getBrand } from "@/server/brand";

export const metadata = { title: "账号" };

export default async function AccountPage() {
  const session = await readAuthenticatedSession();
  const brand = getBrand();
  if (!session) redirect("/login");

  let state: AuthenticationState;
  let accountName: string;
  try {
    state = await inspectAuthentication(session, session.userId);
    const user = state.user;
    accountName = user.preferredLoginName || user.username;
  } catch {
    redirect("/login");
  }

  if (state.step !== "complete") return <AuthPanel title="继续身份验证" description="账号的验证要求尚未完成或已过期。">
    <div className="result-stack">
      <Notice>请完成账号要求的全部验证后再继续。</Notice>
      <form action={resumeAccountAuthentication}><button className="button primary-button wide" type="submit">继续身份验证</button></form>
      <form action={logout}><button className="button secondary-button wide" type="submit">重新登录</button></form>
    </div>
  </AuthPanel>;

  return <AuthPanel title="已登录" description={`你已通过 ${brand.nickname} 完成身份验证。`}>
    <div className="result-stack">
      <Notice kind="success">当前账号：{accountName}</Notice>
      <form action={logout}><button className="button secondary-button wide" type="submit">退出登录</button></form>
    </div>
  </AuthPanel>;
}
