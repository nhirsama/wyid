import { redirect } from "next/navigation";
import { AuthPanel } from "@/components/auth/auth-shell";
import { Notice } from "@/components/ui/form";
import { readAuthenticatedSession } from "@/server/session";
import { zitadel } from "@/server/zitadel/service";
import { logout } from "@/server/actions";

export const metadata = { title: "账号" };

export default async function AccountPage() {
  const session = await readAuthenticatedSession();
  if (!session) redirect("/login");

  let accountName: string;
  try {
    await zitadel.session(session);
    const user = await zitadel.user(session.userId);
    accountName = user.preferredLoginName || user.username;
  } catch {
    return <AuthPanel title="登录状态已失效" description="请重新登录以继续使用账号。">
      <Notice kind="error">账号会话已失效，请重新验证。</Notice>
      <form action={logout}><button className="button primary-button wide" type="submit">返回登录</button></form>
    </AuthPanel>;
  }

  return <AuthPanel title="已登录" description="你已通过 ZITADEL 完成身份验证。">
    <div className="result-stack">
      <Notice kind="success">当前账号：{accountName}</Notice>
      <form action={logout}><button className="button secondary-button wide" type="submit">退出登录</button></form>
    </div>
  </AuthPanel>;
}
