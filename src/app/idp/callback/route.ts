import { NextRequest, NextResponse } from "next/server";
import { completeIdentityProvider } from "@/server/actions";
import { readPendingSession } from "@/server/session";
import { getConfig } from "@/server/config";
import { siteUrl } from "@/lib/paths";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") || "";
  const pending = await readPendingSession();
  const login = siteUrl("/login", getConfig().appUrl);
  if (pending?.authRequestId) login.searchParams.set("authRequest", pending.authRequestId);
  if (params.get("failed") === "1") {
    login.searchParams.set("idpError", "1");
    return NextResponse.redirect(login);
  }
  const result = await completeIdentityProvider({
    idpIntentId: params.get("idp_intent_id") || params.get("idpIntentId") || "",
    idpIntentToken: params.get("idp_intent_token") || params.get("idpIntentToken") || "",
    state,
  });
  if (!result.ok) login.searchParams.set("idpError", "1");
  return NextResponse.redirect(result.ok && result.redirect ? siteUrl(result.redirect, getConfig().appUrl) : login);
}
