import { beforeEach, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { identityFixture } from "./fixtures/account";
const mocks = vi.hoisted(() => ({ userClients: vi.fn(), profile: vi.fn(), email: vi.fn(), password: vi.fn(), user: vi.fn(), session: vi.fn(), update: vi.fn(), write: vi.fn(), pending: vi.fn(), clearAuth: vi.fn(), clearPending: vi.fn(), clearGrant: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ appUrl: "https://login.example.com" }) }));
vi.mock("@/server/zitadel/sdk", () => ({ getUserClients: mocks.userClients }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: { user: mocks.user, session: mocks.session, updateSession: mocks.update } }));
vi.mock("@/server/account/factors", () => ({ persistRotation: async (identity: ReturnType<typeof identityFixture>, result: { sessionToken: string }) => { identity.ref.sessionToken = result.sessionToken; await mocks.write(identity.ref); } }));
vi.mock("@/server/session", () => ({ writePendingSession: mocks.pending, clearAuthenticatedSession: mocks.clearAuth, clearPendingSession: mocks.clearPending, clearAccountGrant: mocks.clearGrant }));
import { updateProfile, updateUsername, updateEmail, updatePassword } from "@/server/account/profile";
import { accountProfile } from "@/server/account/identity";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BASE_PATH", "/id");
  mocks.userClients.mockReturnValue({ user: { updateHumanUser: mocks.profile, setEmail: mocks.email, setPassword: mocks.password } });
  mocks.user.mockResolvedValue(identityFixture().state.user);
  mocks.session.mockResolvedValue(identityFixture().state.session);
  mocks.update.mockResolvedValue({ sessionId: "session", sessionToken: "rotated-token" });
});
it("exposes both username and displayName in the account profile", () => {
  expect(accountProfile(identityFixture().state.user)).toMatchObject({
    username: "test-user",
    displayName: "Test User",
  });
});
it("changes only exposed profile fields while preserving given and family names", async () => {
  await updateProfile(identityFixture(), { displayName: "New name", preferredLanguage: "en" });
  expect(mocks.profile).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", profile: expect.objectContaining({ givenName: "Given", familyName: "Family", nickName: "New name", displayName: "New name", preferredLanguage: "en" }) }));
  expect(mocks.userClients).toHaveBeenCalledWith("user-session-token", "org");
});
it("updates username with user credentials and handles conflicts or session invalidation", async () => {
  const updatedUser = identityFixture().state.user;
  updatedUser.username = "new-user-01";
  mocks.user.mockResolvedValueOnce(updatedUser);
  const result = await updateUsername(identityFixture(), { username: "new-user-01" });
  expect(mocks.profile).toHaveBeenCalledWith({ userId: "user", username: "new-user-01" });
  expect(result).toMatchObject({ account: { username: "new-user-01" }, requiresRelogin: false });
  expect(mocks.clearAuth).not.toHaveBeenCalled();

  await expect(updateUsername(identityFixture(), { username: "test-user" })).rejects.toMatchObject({ code: "username_unchanged", status: 400 });

  mocks.profile.mockRejectedValueOnce(new ConnectError("already exists", Code.AlreadyExists));
  await expect(updateUsername(identityFixture(), { username: "taken-user" })).rejects.toMatchObject({ code: "username_taken", status: 409 });

  mocks.session.mockRejectedValueOnce(new Error("invalidated"));
  mocks.user.mockResolvedValueOnce(updatedUser);
  const relogin = await updateUsername(identityFixture(), { username: "new-user-01" });
  expect(relogin.requiresRelogin).toBe(true);
  expect(mocks.clearAuth).toHaveBeenCalledTimes(1);
  expect(mocks.clearPending).toHaveBeenCalledTimes(1);
  expect(mocks.clearGrant).toHaveBeenCalledTimes(1);
});
it("rejects malformed locale identifiers", async () => {
  await expect(updateProfile(identityFixture(), { displayName: "Name", preferredLanguage: "not_a_locale" })).rejects.toMatchObject({ code: "invalid_language" });
  expect(mocks.profile).not.toHaveBeenCalled();
});
it("reauthenticates email changes and persists the rotated token before any write", async () => {
  await updateEmail(identityFixture(), { email: "new@example.com", password: "current-password" });
  expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "rotated-token" }));
  expect(mocks.userClients).toHaveBeenCalledWith("rotated-token", "org");
  expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.email.mock.invocationCallOrder[0]);
  expect(mocks.email).toHaveBeenCalledWith({ userId: "user", email: "new@example.com", verification: { case: "sendCode", value: { urlTemplate: "https://login.example.com/id/verify-email?userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}" } } });
  expect(mocks.pending).toHaveBeenCalledWith(expect.objectContaining({ userId: "user", sessionId: "session", sessionToken: "rotated-token" }));
});
it("does not change email without native current-password verification", async () => {
  mocks.update.mockRejectedValue(new Error("wrong password"));
  await expect(updateEmail(identityFixture(), { email: "new@example.com", password: "wrong" })).rejects.toThrow("wrong password");
  expect(mocks.email).not.toHaveBeenCalled(); expect(mocks.pending).not.toHaveBeenCalled();
});
it("enforces the live password policy and uses native current-password verification", async () => {
  await expect(updatePassword(identityFixture(), { currentPassword: "current", password: "weak" })).rejects.toMatchObject({ code: "password_policy" });
  expect(mocks.password).not.toHaveBeenCalled();
  await updatePassword(identityFixture(), { currentPassword: "current", password: "NewPassword123" });
  expect(mocks.password).toHaveBeenCalledWith({ userId: "user", newPassword: { password: "NewPassword123", changeRequired: false }, verification: { case: "currentPassword", value: "current" } });
});
