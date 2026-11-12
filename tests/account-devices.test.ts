import { beforeEach, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "@zitadel/proto/zitadel/session/v2/session_pb.js";
import { identityFixture } from "./fixtures/account";
const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), remove: vi.fn(), clear: vi.fn() }));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: () => ({ session: { listSessions: mocks.list, getSession: mocks.get, deleteSession: mocks.remove } }) }));
vi.mock("@/server/session", () => ({ clearAuthenticatedSession: mocks.clear, clearPendingSession: mocks.clear, clearAccountGrant: mocks.clear }));
import { devices, revokeDevice } from "@/server/account/devices";
beforeEach(() => { vi.resetAllMocks(); });
it("queries sessions by the authenticated user and filters unexpected foreign results", async () => {
  mocks.list.mockResolvedValue({ sessions: [create(SessionSchema, { id: "session", factors: { user: { id: "user" } } }), create(SessionSchema, { id: "foreign", factors: { user: { id: "other" } } })] });
  expect(await devices(identityFixture())).toEqual([expect.objectContaining({ id: "session", current: true })]);
  expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ queries: [{ query: { case: "userIdQuery", value: { id: "user" } } }] }));
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
