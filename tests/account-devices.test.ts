import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { SessionSchema } from "@zitadel/proto/zitadel/session/v2/session_pb.js";
import { identityFixture } from "./fixtures/account";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), remove: vi.fn(), clear: vi.fn() }));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: () => ({ session: { listSessions: mocks.list, getSession: mocks.get, deleteSession: mocks.remove } }) }));
vi.mock("@/server/session", () => ({ clearAuthenticatedSession: mocks.clear, clearPendingSession: mocks.clear, clearAccountGrant: mocks.clear }));
import { devices, revokeDevice } from "@/server/account/devices";

const now = new Date("2026-11-23T12:00:00.000Z");
const at = (offsetMs: number) => timestampFromDate(new Date(now.getTime() + offsetMs));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => { vi.useRealTimers(); });

it("queries sessions by the authenticated user and filters unexpected foreign results", async () => {
  mocks.list.mockResolvedValue({ sessions: [create(SessionSchema, { id: "session", factors: { user: { id: "user" } } }), create(SessionSchema, { id: "foreign", factors: { user: { id: "other" } } })] });
  expect(await devices(identityFixture())).toEqual([expect.objectContaining({ id: "session", current: true })]);
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ queries: [{ query: { case: "userIdQuery", value: { id: "user" } } }] }));
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("filters out and deletes expired sessions, stale pending challenges, and same-device duplicates", async () => {
  const identity = identityFixture();
  identity.state.policy.passwordLifetimeMs = 60 * 60 * 1000;
  identity.state.policy.multiFactorLifetimeMs = 30 * 60 * 1000;
  identity.state.policy.externalLoginLifetimeMs = 60 * 60 * 1000;

  mocks.list.mockResolvedValue({
    sessions: [
      create(SessionSchema, { id: "other-active-older", creationDate: at(-20 * 60_000), changeDate: at(-10 * 60_000), userAgent: { fingerprintId: "fp-other", description: "Firefox · Linux" }, factors: { user: { id: "user" }, password: { verifiedAt: at(-20 * 60_000) } } }),
      create(SessionSchema, { id: "other-active-newer", creationDate: at(-15 * 60_000), changeDate: at(-2 * 60_000), userAgent: { fingerprintId: "fp-mobile", description: "Safari · iPhone" }, factors: { user: { id: "user" }, webAuthN: { verifiedAt: at(-5 * 60_000), userVerified: true } } }),
      create(SessionSchema, { id: "same-device-old", creationDate: at(-30 * 60_000), changeDate: at(-30 * 60_000), userAgent: { fingerprintId: "fp-current", description: "Chrome · macOS" }, factors: { user: { id: "user" }, password: { verifiedAt: at(-30 * 60_000) } } }),
      create(SessionSchema, { id: "session", creationDate: at(-5 * 60_000), changeDate: at(-1 * 60_000), userAgent: { fingerprintId: "fp-current", description: "Chrome · macOS" }, factors: { user: { id: "user" }, password: { verifiedAt: at(-5 * 60_000) } } }),
      create(SessionSchema, { id: "expired-by-date", expirationDate: at(-1000), factors: { user: { id: "user" }, password: { verifiedAt: at(-5 * 60_000) } } }),
      create(SessionSchema, { id: "expired-password", factors: { user: { id: "user" }, password: { verifiedAt: at(-61 * 60_000) } } }),
      create(SessionSchema, { id: "expired-passkey", factors: { user: { id: "user" }, webAuthN: { verifiedAt: at(-31 * 60_000), userVerified: true } } }),
      create(SessionSchema, { id: "expired-idp", factors: { user: { id: "user" }, intent: { verifiedAt: at(-61 * 60_000) } } }),
      create(SessionSchema, { id: "stale-pending", creationDate: at(-20 * 60_000), changeDate: at(-20 * 60_000), factors: { user: { id: "user" } } }),
      create(SessionSchema, { id: "active-pending", creationDate: at(-2 * 60_000), changeDate: at(-2 * 60_000), factors: { user: { id: "user" } } }),
    ],
  });

  const result = await devices(identity);
  expect(result.map(item => ({ id: item.id, name: item.name, current: item.current }))).toEqual([
    { id: "session", name: "Chrome · macOS", current: true },
    { id: "other-active-newer", name: "Safari · iPhone", current: false },
    { id: "other-active-older", name: "Firefox · Linux", current: false },
  ]);

  const deletedIds = mocks.remove.mock.calls.map(call => call[0].sessionId).sort();
  expect(deletedIds).toEqual([
    "expired-by-date",
    "expired-idp",
    "expired-passkey",
    "expired-password",
    "same-device-old",
    "stale-pending",
  ]);
});

it("does not delete another user's submitted session ID", async () => {
  mocks.get.mockResolvedValue({ session: create(SessionSchema, { id: "foreign", factors: { user: { id: "other" } } }) });
  await expect(revokeDevice(identityFixture(), "foreign")).rejects.toMatchObject({ status: 404 });
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("deleting the current owned session also clears all local credentials", async () => {
  mocks.get.mockResolvedValue({ session: identityFixture().state.session });
  await expect(revokeDevice(identityFixture(), "session")).resolves.toEqual({ signedOut: true });
  expect(mocks.remove).toHaveBeenCalledWith({ sessionId: "session" });
  expect(mocks.clear).toHaveBeenCalledTimes(3);
});
