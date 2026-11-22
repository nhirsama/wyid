import { NextRequest, NextResponse } from "next/server";
import { completeIdentityProvider } from "@/server/actions";
import { clearPendingSession, readPendingSession } from "@/server/session";
import { getConfig } from "@/server/config";
import { siteUrl } from "@/lib/paths";

function idpErrorCode(message?: string) {
  if (message?.includes("不允许自动创建账号")) return "unlinked";
  if (message?.includes("此登录方式当前不可用")) return "disabled";
  return "1";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") || "";
  const pending = await readPendingSession();
  const login = siteUrl("/login", getConfig().appUrl);
  // A different tab can replace the shared pending cookie while this IDP
  // request is in flight. Bind even failure redirects before using its request.
  const matchesState = !!state && pending?.idpState === state;
  if (matchesState && pending.authRequestId) login.searchParams.set("authRequest", pending.authRequestId);
  if (!matchesState || params.get("failed") === "1") {
    if (matchesState) await clearPendingSession();
    login.searchParams.set("idpError", "1");
    return NextResponse.redirect(login);
  }
  const result = await completeIdentityProvider({
    idpIntentId: params.get("idp_intent_id") || params.get("idpIntentId") || "",
    idpIntentToken: params.get("idp_intent_token") || params.get("idpIntentToken") || "",
    state,
  });
  if (!result.ok) {
    if ((await readPendingSession())?.idpState === state) await clearPendingSession();
    login.searchParams.set("idpError", idpErrorCode(result.message));
  }
  return NextResponse.redirect(result.ok && result.redirect ? siteUrl(result.redirect, getConfig().appUrl) : login);
}
