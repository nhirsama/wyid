import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { getConfig } from "./config";

// 这里只保存未完成的登录凭据；它不是应用自己的认证会话。
const pendingSchema = z.object({ authRequestId: z.string().min(1).max(1024).optional(), sessionId: z.string().max(1024), sessionToken: z.string().max(2048), methods: z.array(z.enum(["totp", "otpEmail", "otpSms", "u2f"])).optional(), userId: z.string().max(1024).optional(), factorVerified: z.boolean().optional(), idpState: z.string().uuid().optional(), idpCreationAllowed: z.boolean().optional(), idpAutoCreation: z.boolean().optional(), idpIntentId: z.string().max(1024).optional(), idpIntentToken: z.string().max(2048).optional(), idpNewUser: z.record(z.string(), z.unknown()).optional(), needsEnrollment: z.boolean().optional() });
export type PendingSession = z.infer<typeof pendingSchema>;
const authenticatedSchema = z.object({ sessionId: z.string().min(1).max(1024), sessionToken: z.string().min(1).max(2048), userId: z.string().min(1).max(1024) });
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
  const token = await new EncryptJWT(payload).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(issuer).setAudience("wyid:authenticated-session").setIssuedAt().setExpirationTime("12h").encrypt(key);
  (await cookies()).set(secure ? "__Host-wyid-session" : "wyid-session", token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 43_200 });
}

export async function readAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const { key, secure, issuer } = options();
  const token = (await cookies()).get(secure ? "__Host-wyid-session" : "wyid-session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, { issuer, audience: "wyid:authenticated-session", keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return authenticatedSchema.parse(payload);
  } catch { return null; }
}

export async function clearAuthenticatedSession() {
  const { secure } = options();
  (await cookies()).set(secure ? "__Host-wyid-session" : "wyid-session", "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}
