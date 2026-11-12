import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { getConfig } from "./config";
import { factorSchema } from "@/lib/auth";

// Flow metadata only: authentication/MFA completion is always read from ZITADEL.
const pendingSchema = z.object({
  authRequestId: z.string().min(1).max(1024).optional(), sessionId: z.string().max(1024), sessionToken: z.string().max(2048),
  methods: z.array(factorSchema).optional(), userId: z.string().max(1024).optional(), needsEnrollment: z.boolean().optional(),
  mfaStartedAt: z.number().finite().nonnegative().optional(), requireMfa: z.boolean().optional(), passkeyPending: z.boolean().optional(), challengeMethod: factorSchema.optional(), totpEnrollmentStarted: z.boolean().optional(),
  keyEnrollment: z.object({ method: z.literal("u2f"), id: z.string().min(1).max(1024), expiresAt: z.number().finite() }).optional(),
  idpState: z.string().uuid().optional(), idpCreationAllowed: z.boolean().optional(), idpAutoCreation: z.boolean().optional(),
  idpIntentId: z.string().max(1024).optional(), idpIntentToken: z.string().max(2048).optional(), idpNewUser: z.record(z.string(), z.unknown()).optional(),
});
export type PendingSession = z.infer<typeof pendingSchema>;
const authenticatedSchema = z.object({ mfaStartedAt: z.number().finite().nonnegative().optional(), sessionId: z.string().min(1).max(1024), sessionToken: z.string().min(1).max(2048), userId: z.string().min(1).max(1024), expiresAt: z.number().finite().positive().optional() });
export type AuthenticatedSession = z.infer<typeof authenticatedSchema>;

function options() {
  const config = getConfig();
  const secure = new URL(config.appUrl).protocol === "https:";
  return {
    key: createHash("sha256").update(config.sessionSecret).digest(),
    name: secure ? "__Host-wyid-pending" : "wyid-pending",
    secure,
    issuer: config.appUrl,
  };
}

export async function writePendingSession(input: PendingSession) {
  const { key, name, secure, issuer } = options();
  const payload = pendingSchema.parse(input);
  const token = await new EncryptJWT(payload).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(issuer).setAudience("wyid:pending-login").setIssuedAt().setExpirationTime("10m").encrypt(key);
  if (token.length > 3800) throw new Error("Pending session exceeds cookie size");
  (await cookies()).set(name, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
}

export async function readPendingSession(): Promise<PendingSession | null> {
  const { key, name, issuer } = options();
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, { issuer, audience: "wyid:pending-login", keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return pendingSchema.parse(payload);
  } catch { return null; }
}

export async function clearPendingSession() {
  const { name, secure } = options();
  (await cookies()).set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function writeAuthenticatedSession(input: AuthenticatedSession) {
  const { key, secure, issuer } = options();
  const payload = authenticatedSchema.parse(input);
  const jwt = new EncryptJWT(payload).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(issuer).setAudience("wyid:authenticated-session").setIssuedAt();
  // No local sliding timeout: the absolute deadline comes from ZITADEL's
  // expiration_date and verified_at + login policy. Without one, use a browser
  // session cookie; every account read and reuse still checks ZITADEL live.
  if (payload.expiresAt !== undefined) {
    if (payload.expiresAt <= Date.now()) throw new Error("Authenticated session has expired");
    jwt.setExpirationTime(payload.expiresAt / 1000);
  }
  const token = await jwt.encrypt(key);
  if (token.length > 3800) throw new Error("Authenticated session exceeds cookie size");
  (await cookies()).set(secure ? "__Host-wyid-session" : "wyid-session", token, { httpOnly: true, secure, sameSite: "lax", path: "/", ...(payload.expiresAt === undefined ? {} : { expires: new Date(payload.expiresAt) }) });
}

export async function readAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const { key, secure, issuer } = options();
  const token = (await cookies()).get(secure ? "__Host-wyid-session" : "wyid-session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, { issuer, audience: "wyid:authenticated-session", keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    const session = authenticatedSchema.parse(payload);
    return session.expiresAt !== undefined && session.expiresAt <= Date.now() ? null : session;
  } catch { return null; }
}

export async function clearAuthenticatedSession() {
  const { secure } = options();
  (await cookies()).set(secure ? "__Host-wyid-session" : "wyid-session", "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}
