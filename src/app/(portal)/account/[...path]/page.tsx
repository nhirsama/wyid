import { notFound } from "next/navigation";
import { redirectToApp } from "@/server/redirect";
import { AccountPortal } from "@/components/account/portal";
import { accountConfig, accountIdentity, accountProfile } from "@/server/account/identity";
import { AccountError } from "@/server/account/errors";
import { decodeAccountSegments, isAccountRoute } from "@/lib/account/routes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "账号门户" };

export default async function AccountPortalPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  let route: string;
  try { route = `/${decodeAccountSegments(path).join("/")}`; }
  catch { notFound(); }
  if (!isAccountRoute(route)) notFound();
  let identity;
  try { identity = await accountIdentity(); }
  catch (error) {
    if (!(error instanceof AccountError)) throw error;
    redirectToApp(error.code === "authentication_incomplete" ? "/account" : "/login");
  }
  return <AccountPortal key={`${identity.ref.userId}:${identity.ref.sessionId}`} route={route} initialAccount={accountProfile(identity.state.user)} config={accountConfig(identity.state)} />;
}
