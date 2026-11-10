import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { getConfig } from "./config";

const schema = z.object({ userId: z.string().min(1).max(1024) });
const audience = "wyid:passkey-account";
const maxAge = 30 * 24 * 60 * 60;

function settings() {
  const config = getConfig();
  const secure = new URL(config.appUrl).protocol === "https:";
  return {
    key: createHash("sha256").update(config.sessionSecret).digest(),
    name: secure ? "__Host-wyid-passkey-account" : "wyid-passkey-account",
    issuer: config.appUrl,
    secure,
  };
}

// This encrypted cookie remembers only which account to challenge. It is never
// accepted as login/MFA proof, and deliberately has a separate JWT audience.
export async function readPasskeyAccount() {
  const { key, name, issuer } = settings();
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, { issuer, audience, keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return schema.parse(payload);
  } catch { return null; }
}

export async function writePasskeyAccount(userId: string) {
  const { key, name, issuer, secure } = settings();
  const token = await new EncryptJWT(schema.parse({ userId })).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(`${maxAge}s`).encrypt(key);
  (await cookies()).set(name, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge });
}
