import type { Device } from "@/lib/account/types";
import { clearAccountGrant, clearAuthenticatedSession, clearPendingSession } from "@/server/session";
import { getClients } from "@/server/zitadel/sdk";
import { assert } from "./errors";
import { isoDate, type Identity } from "./identity";

export async function devices(identity: Identity): Promise<Device[]> {
  const result: Device[] = [];
  for (let offset = 0n; ;) {
    const page = await getClients().session.listSessions({ query: { offset, limit: 100 }, queries: [{ query: { case: "userIdQuery", value: { id: identity.ref.userId } } }] });
    for (const session of page.sessions) {
      if (session.factors?.user?.id !== identity.ref.userId) continue;
      result.push({ id: session.id, name: session.userAgent?.description || "浏览器会话", createdAt: isoDate(session.creationDate), lastUsedAt: isoDate(session.changeDate), current: session.id === identity.ref.sessionId });
    }
    offset += BigInt(page.sessions.length);
    if (!page.sessions.length || offset >= (page.details?.totalResult ?? offset)) return result;
  }
}
export async function revokeDevice(identity: Identity, sessionId: string) {
  // Never accept a submitted session ID as evidence of ownership.
  const { session } = await getClients().session.getSession({ sessionId });
  assert(session?.id === sessionId && session.factors?.user?.id === identity.ref.userId, 404, "session_not_found", "没有此登录设备。");
  await getClients().session.deleteSession({ sessionId });
  const signedOut = sessionId === identity.ref.sessionId;
  if (signedOut) await Promise.all([clearAuthenticatedSession(), clearPendingSession(), clearAccountGrant()]);
  return { signedOut };
}
