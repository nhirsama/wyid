import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserVerificationRequirement } from "@zitadel/proto/zitadel/session/v2/challenge_pb.js";
import { identityFixture } from "./fixtures/account";
import type { AccountGrant } from "@/server/session";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(), readGrant: vi.fn(), writeGrant: vi.fn(), clearGrant: vi.fn(), writeSession: vi.fn(), inspect: vi.fn(),
  clients: vi.fn(), userClients: vi.fn(),
  user: { createPasskeyRegistrationLink: vi.fn(), registerPasskey: vi.fn(), registerU2F: vi.fn(), verifyPasskeyRegistration: vi.fn(), verifyU2FRegistration: vi.fn(), registerTOTP: vi.fn(), verifyTOTPRegistration: vi.fn(), listAuthenticationFactors: vi.fn(), listPasskeys: vi.fn(), removePasskey: vi.fn() },
  update: vi.fn(), factor: vi.fn(), webauthn: vi.fn(), challenge: vi.fn(),
}));
vi.mock("@/server/account/identity", () => ({ accountIdentity: mocks.identity }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com" }) }));
vi.mock("@/server/session", () => ({ readAccountGrant: mocks.readGrant, writeAccountGrant: mocks.writeGrant, clearAccountGrant: mocks.clearGrant, writeAuthenticatedSession: mocks.writeSession }));
vi.mock("@/server/authentication", () => ({ inspectAuthentication: mocks.inspect }));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: mocks.clients, getUserClients: mocks.userClients }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: { updateSession: mocks.update, verifyFactor: mocks.factor, verifyWebAuthn: mocks.webauthn, challenge: mocks.challenge } }));
import { assertBoundGrant, checkFactor, confirmTotp, discoverableOptions, finishKey, hasFreshFactor, removeFactor, sendCheck, startKey } from "@/server/account/factors";

const grantFixture = (type: AccountGrant["type"] = "passkey", phase: AccountGrant["phase"] = "check"): AccountGrant => ({ userId: "user", sessionId: "session", type, phase, id: "registration-id", createdAt: Date.now() - 1000, expiresAt: Date.now() + 600_000 });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue(identityFixture());
  mocks.clients.mockReturnValue({ user: mocks.user }); mocks.userClients.mockReturnValue({ user: mocks.user });
  mocks.readGrant.mockResolvedValue(grantFixture());
  mocks.user.createPasskeyRegistrationLink.mockResolvedValue({ code: { id: "code-id", code: "one-time-code" } });
  mocks.user.registerPasskey.mockResolvedValue({ passkeyId: "registration-id", publicKeyCredentialCreationOptions: { publicKey: { challenge: "register", authenticatorSelection: { authenticatorAttachment: "cross-platform" } } } });
  mocks.user.registerU2F.mockResolvedValue({ u2fId: "security-key-id", publicKeyCredentialCreationOptions: { challenge: "u2f-register" } });
  mocks.update.mockResolvedValue({ sessionId: "session", sessionToken: "rotated-token", challenges: { webAuthN: { publicKeyCredentialRequestOptions: { challenge: "fresh-challenge" } } } });
  mocks.webauthn.mockResolvedValue({ sessionId: "session", sessionToken: "rotated-token" });
  mocks.factor.mockResolvedValue({ sessionId: "session", sessionToken: "rotated-token" });
  mocks.inspect.mockResolvedValue(identityFixture().state);
});

describe("discoverable passkey registration", () => {
  it("requires resident keys and user verification while retaining supplied options", () => {
    const options = { challenge: "c", authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "discouraged" } };
    expect(discoverableOptions(options)).toMatchObject({ challenge: "c", authenticatorSelection: { authenticatorAttachment: "cross-platform", residentKey: "required", requireResidentKey: true, userVerification: "required" } });
    expect(options.authenticatorSelection.residentKey).toBe("discouraged");
  });
  it("registers on the login RP domain using a one-time native code", async () => {
    const result = await startKey(identityFixture(), "passkey");
    expect(mocks.user.registerPasskey).toHaveBeenCalledWith({ userId: "user", domain: "login.example.com", code: { id: "code-id", code: "one-time-code" } });
    expect(result.publicKey).toMatchObject({ authenticatorSelection: { residentKey: "required", userVerification: "required" } });
    expect(mocks.writeGrant).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", sessionId: "session", type: "passkey", phase: "register", id: "registration-id" }));
    expect(mocks.writeSession).not.toHaveBeenCalled();
  });
  it("keeps U2F registration separate from the passwordless store", async () => {
    const result = await startKey(identityFixture(), "webauthn");
    expect(result.publicKey).toEqual({ challenge: "u2f-register" });
    expect(mocks.user.registerPasskey).not.toHaveBeenCalled();
    expect(mocks.writeGrant).toHaveBeenCalledWith(expect.objectContaining({ type: "webauthn", id: "security-key-id" }));
  });
  it("does not offer a disabled factor", async () => {
    const identity = identityFixture(); identity.state.policy.passkey = false; identity.state.policy.userVerifiedKey = false;
    await expect(startKey(identity, "passkey")).rejects.toMatchObject({ code: "factor_disabled" });
    expect(mocks.user.registerPasskey).not.toHaveBeenCalled();
  });
  it("uses the cookie-bound registration ID, then requires a fresh assertion", async () => {
    mocks.readGrant.mockResolvedValue(grantFixture("passkey", "register"));
    await finishKey("passkey", { id: "browser-credential" }, "Bitwarden");
    expect(mocks.user.verifyPasskeyRegistration).toHaveBeenCalledWith({ userId: "user", passkeyId: "registration-id", publicKeyCredential: { id: "browser-credential" }, passkeyName: "Bitwarden" });
    expect(mocks.writeGrant).toHaveBeenCalledWith(expect.objectContaining({ phase: "check" }));
    expect(mocks.writeSession).not.toHaveBeenCalled();
    expect(mocks.clearGrant).not.toHaveBeenCalled();
  });
});

describe("limited enrollment continuations", () => {
  it.each([
    { userId: "other" }, { sessionId: "other" }, { expiresAt: 1 }, { createdAt: Date.now() + 600_000 },
    { type: "totp" as const }, { phase: "register" as const },
  ])("rejects grant substitution: %j", value => {
    expect(() => assertBoundGrant({ ...grantFixture(), ...value }, identityFixture(), "passkey", "check")).toThrow();
  });
  it("does not continue without an enrollment grant", async () => {
    mocks.readGrant.mockResolvedValue(null);
    await expect(sendCheck()).rejects.toMatchObject({ code: "enrollment_expired" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["passkey", "webauthn"] as const)("requests the right native store for %s and persists rotation", async type => {
    mocks.readGrant.mockResolvedValue(grantFixture(type));
    const result = await sendCheck();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session" }), undefined, { webAuthN: { domain: "login.example.com", userVerificationRequirement: type === "passkey" ? UserVerificationRequirement.REQUIRED : UserVerificationRequirement.DISCOURAGED } });
    expect(result).toMatchObject({ method: type === "passkey" ? "passkey" : "u2f" });
    expect(mocks.writeSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "rotated-token" }));
  });
  it("persists a verified token before a failing profile/policy read", async () => {
    mocks.inspect.mockRejectedValue(new Error("policy unavailable"));
    await expect(checkFactor({ credential: { id: "assertion" } })).rejects.toThrow("policy unavailable");
    expect(mocks.writeSession).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "rotated-token" }));
    expect(mocks.clearGrant).not.toHaveBeenCalled();
    expect(mocks.writeSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.inspect.mock.invocationCallOrder[0]);
  });
  it("registration success and an old assertion are not new authentication proof", async () => {
    const identity = identityFixture(), grant = grantFixture();
    identity.state.session.factors!.webAuthN = { $typeName: "zitadel.session.v2.WebAuthNFactor", userVerified: true, verifiedAt: { $typeName: "google.protobuf.Timestamp", seconds: 1n, nanos: 0 } };
    expect(hasFreshFactor(identity, grant)).toBe(false);
    mocks.inspect.mockResolvedValue(identity.state);
    await expect(checkFactor({ credential: { id: "assertion" } })).rejects.toMatchObject({ code: "step_up_required" });
    expect(mocks.clearGrant).not.toHaveBeenCalled();
  });
  it("clears the limited grant only after native fresh UV proof and complete authentication", async () => {
    const identity = identityFixture();
    identity.state.session.factors!.webAuthN = { $typeName: "zitadel.session.v2.WebAuthNFactor", userVerified: true, verifiedAt: { $typeName: "google.protobuf.Timestamp", seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: Date.now() % 1000 * 1_000_000 } };
    mocks.inspect.mockResolvedValue(identity.state);
    await expect(checkFactor({ credential: { id: "assertion" } })).resolves.toEqual({ verified: true });
    expect(mocks.clearGrant).toHaveBeenCalledTimes(1);
  });
  it("does not reconfirm a TOTP enrollment if its native session check needs retry", async () => {
    mocks.readGrant.mockResolvedValue(grantFixture("totp", "check"));
    mocks.inspect.mockRejectedValue(new Error("read failed"));
    await expect(confirmTotp("123456")).rejects.toThrow("read failed");
    expect(mocks.user.verifyTOTPRegistration).not.toHaveBeenCalled();
    expect(mocks.factor).toHaveBeenCalledWith(expect.anything(), "totp", "123456");
  });
  it("does not remove another credential ID", async () => {
    mocks.user.listAuthenticationFactors.mockResolvedValue({ result: [] });
    mocks.user.listPasskeys.mockResolvedValue({ result: [{ id: "own-key", name: "Own", state: 1 }] });
    await expect(removeFactor(identityFixture(), "passkey", "other-key")).rejects.toMatchObject({ code: "factor_not_found" });
    expect(mocks.user.removePasskey).not.toHaveBeenCalled();
  });
});
