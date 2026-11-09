import { createHmac, timingSafeEqual } from "node:crypto";
import type { zitadel } from "./zitadel/service";

type AuthRequest = Awaited<ReturnType<typeof zitadel.authRequest>>;
type ConsentSession = { authRequestId?: string; sessionId: string; sessionToken: string; userId?: string };

/** Binds an approval to this exact ZITADEL request and the verified account session. */
export function consentToken(request: AuthRequest, session: ConsentSession, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify([
    "wyid:oauth-consent:v1", request.id, session.authRequestId, session.sessionId, session.sessionToken, session.userId,
    request.clientId, request.redirectUri, [...request.scope].sort(), [...request.prompt].sort((a, b) => a - b),
  ])).digest("base64url");
}

export function matchesConsentToken(expected: string, supplied: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
