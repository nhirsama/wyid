import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), config: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("@/server/config", () => ({ getConfig: mocks.config }));
import { readPasskeyAccount, writePasskeyAccount } from "@/server/passkey-account";
import { readAuthenticatedSession, readPendingSession } from "@/server/session";

const issuer = "https://login.example.com";
const secret = "test-session-secret-that-is-at-least-32-characters";
const key = createHash("sha256").update(secret).digest();
beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ appUrl: issuer, sessionSecret: secret });
});
afterEach(() => vi.useRealTimers());

describe("remembered passkey account is not authentication", () => {
  it.each([issuer, "http://localhost:3000"])("remembers only an encrypted account ID with HttpOnly cookies for %s", async appUrl => {
    mocks.config.mockReturnValue({ appUrl, sessionSecret: secret });
    await writePasskeyAccount("user-id");
    const secure = appUrl.startsWith("https:");
    const name = secure ? "__Host-wyid-passkey-account" : "wyid-passkey-account";
    expect(mocks.set).toHaveBeenCalledWith(name, expect.any(String), { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 2_592_000 });
    const token = mocks.set.mock.calls[0][1];
    expect(token).not.toContain("user-id");
    const { payload } = await jwtDecrypt(token, key, { issuer: appUrl, audience: "wyid:passkey-account" });
    expect(payload).toMatchObject({ userId: "user-id" });
    expect(payload).not.toHaveProperty("sessionToken");
    mocks.get.mockReturnValue({ value: token });
    expect(await readPasskeyAccount()).toEqual({ userId: "user-id" });
    expect(await readAuthenticatedSession()).toBeNull();
    expect(await readPendingSession()).toBeNull();
  });

  it("ignores a missing, tampered or expired account cookie", async () => {
    expect(await readPasskeyAccount()).toBeNull();
    mocks.get.mockReturnValue({ value: "tampered" });
    expect(await readPasskeyAccount()).toBeNull();
    vi.useFakeTimers();
    await writePasskeyAccount("user-id");
    mocks.get.mockReturnValue({ value: mocks.set.mock.calls[0][1] });
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);
    expect(await readPasskeyAccount()).toBeNull();
  });

  it.each([
    { aud: "wyid:authenticated-session", iss: issuer, userId: "user-id" },
    { aud: "wyid:passkey-account", iss: "https://other.example.com", userId: "user-id" },
    { aud: "wyid:passkey-account", iss: issuer, userId: "" },
  ])("rejects cross-audience, cross-issuer and invalid payloads: %j", async payload => {
    const token = await new EncryptJWT(payload).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setExpirationTime("1h").encrypt(key);
    mocks.get.mockReturnValue({ value: token });
    expect(await readPasskeyAccount()).toBeNull();
  });
});
