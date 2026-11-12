import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), config: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("@/server/config", () => ({ getConfig: mocks.config }));
import { clearAuthenticatedSession, readAuthenticatedSession, readPendingSession, writeAuthenticatedSession, writePendingSession } from "@/server/session";

const issuer = "https://login.example.com";
const secret = "test-session-secret-that-is-at-least-32-characters";
const key = createHash("sha256").update(secret).digest();
const session = { sessionId: "native-session", sessionToken: "native-secret-token", userId: "user-id", mfaStartedAt: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  mocks.config.mockReturnValue({ appUrl: issuer, sessionSecret: secret });
});
afterEach(() => vi.useRealTimers());

describe("encrypted reusable native session cookie", () => {
  it.each([issuer, "http://localhost:3000"])("encrypts credentials and uses secure cookie settings for %s", async appUrl => {
    mocks.config.mockReturnValue({ appUrl, sessionSecret: secret });
    const expiresAt = Date.now() + 90_250;
    await writeAuthenticatedSession({ ...session, expiresAt });
    const secure = appUrl.startsWith("https:");
    const name = secure ? "__Host-wyid-session" : "wyid-session";
    expect(mocks.set).toHaveBeenCalledWith(name, expect.any(String), { httpOnly: true, secure, sameSite: "lax", path: "/", expires: new Date(expiresAt) });
    const token = mocks.set.mock.calls[0][1];
    expect(token).not.toContain(session.sessionToken);
    const { payload } = await jwtDecrypt(token, key, { issuer: appUrl, audience: "wyid:authenticated-session" });
    expect(payload).toMatchObject({ ...session, expiresAt, exp: expiresAt / 1000 });
    mocks.get.mockReturnValue({ value: token });
    expect(await readAuthenticatedSession()).toEqual({ ...session, expiresAt });
    expect(await readPendingSession()).toBeNull();
    vi.advanceTimersByTime(90_251);
    expect(await readAuthenticatedSession()).toBeNull();
  });

  it("uses a browser session cookie when ZITADEL supplies no deadline instead of a fixed twelve-hour expiry", async () => {
    await writeAuthenticatedSession(session);
    const [, token, options] = mocks.set.mock.calls[0];
    expect(options).not.toHaveProperty("maxAge");
    expect(options).not.toHaveProperty("expires");
    expect((await jwtDecrypt(token, key)).payload).not.toHaveProperty("exp");
    mocks.get.mockReturnValue({ value: token });
    expect(await readAuthenticatedSession()).toEqual(session);
  });

  it("does not write a session with an already expired native deadline", async () => {
    await expect(writeAuthenticatedSession({ ...session, expiresAt: Date.now() })).rejects.toThrow("expired");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("ignores missing, tampered, wrong-audience, wrong-issuer and malformed credentials", async () => {
    expect(await readAuthenticatedSession()).toBeNull();
    mocks.get.mockReturnValue({ value: "tampered" });
    expect(await readAuthenticatedSession()).toBeNull();
    for (const payload of [
      { ...session, iss: issuer, aud: "wyid:pending-login" },
      { ...session, iss: "https://other.example.com", aud: "wyid:authenticated-session" },
      { ...session, sessionToken: "", iss: issuer, aud: "wyid:authenticated-session" },
    ]) {
      const token = await new EncryptJWT(payload).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).encrypt(key);
      mocks.get.mockReturnValue({ value: token });
      expect(await readAuthenticatedSession()).toBeNull();
    }
  });

  it("keeps pending flow credentials separate from the reusable completed login", async () => {
    await writePendingSession(session);
    mocks.get.mockReturnValue({ value: mocks.set.mock.calls[0][1] });
    expect(await readAuthenticatedSession()).toBeNull();
  });

  it("stores only the IDP flow binding and intent credentials, not a policy or profile snapshot", async () => {
    const pending = { sessionId: "", sessionToken: "", idpState: "00000000-0000-4000-8000-000000000000", idpId: "idp", idpOrganizationId: "org-id", idpIntentId: "intent", idpIntentToken: "intent-token" };
    await writePendingSession({ ...pending, idpCreationAllowed: true, idpAutoCreation: true, idpNewUser: { username: "stale-profile" } } as typeof pending);
    const token = mocks.set.mock.calls[0][1];
    const { payload } = await jwtDecrypt(token, key, { issuer, audience: "wyid:pending-login" });
    expect(payload).toMatchObject(pending);
    for (const field of ["idpCreationAllowed", "idpAutoCreation", "idpNewUser"]) expect(payload).not.toHaveProperty(field);
    mocks.get.mockReturnValue({ value: token });
    expect(await readPendingSession()).toEqual(pending);
  });

  it("does not retain legacy MFA requirements inferred from a callback error", async () => {
    await writePendingSession({ ...session, requireMfa: true } as typeof session);
    const token = mocks.set.mock.calls[0][1];
    const { payload } = await jwtDecrypt(token, key, { issuer, audience: "wyid:pending-login" });
    expect(payload).not.toHaveProperty("requireMfa");
    mocks.get.mockReturnValue({ value: token });
    expect(await readPendingSession()).toEqual(session);
    const legacy = await new EncryptJWT({ ...session, requireMfa: true }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer(issuer).setAudience("wyid:pending-login").setExpirationTime("10m").encrypt(key);
    mocks.get.mockReturnValue({ value: legacy });
    expect(await readPendingSession()).toEqual(session);
  });

  it("clears the reusable cookie on logout", async () => {
    await clearAuthenticatedSession();
    expect(mocks.set).toHaveBeenCalledWith("__Host-wyid-session", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  });
});
