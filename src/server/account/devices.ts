import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Session } from "@zitadel/proto/zitadel/session/v2/session_pb.js";
import type { Device } from "@/lib/account/types";
import { clearAccountGrant, clearAuthenticatedSession, clearPendingSession } from "@/server/session";
import { getClients } from "@/server/zitadel/sdk";
import { assert } from "./errors";
import { isoDate, type Identity } from "./identity";

const PENDING_STALE_MS = 15 * 60 * 1000;
const MAX_CLEANUP_PER_LIST = 50;

function timestampMs(value?: Timestamp): number | undefined {
  if (!value) return undefined;
  const ms = Number(value.seconds) * 1000 + value.nanos / 1_000_000;
  return Number.isFinite(ms) ? ms : undefined;
}

function factorStatus(factor: { verifiedAt?: Timestamp } | undefined, lifetimeMs: number | undefined, now: number): "active" | "expired" | "missing" {
  if (!factor?.verifiedAt) return "missing";
  const verifiedAt = timestampMs(factor.verifiedAt);
  if (verifiedAt === undefined || verifiedAt > now + 5_000) return "expired";
  if (lifetimeMs !== undefined && lifetimeMs < 0) return "expired";
  if (lifetimeMs !== undefined && lifetimeMs > 0 && now - verifiedAt > lifetimeMs) return "expired";
  return "active";
}

function classifySession(session: Session, identity: Identity, now: number): "active" | "hidden" | "expired" {
  if (session.id === identity.ref.sessionId) return "active";
  if (session.expirationDate) {
    const expiresAt = timestampMs(session.expirationDate);
    if (expiresAt === undefined || expiresAt <= now) return "expired";
  }
  const { policy } = identity.state;
  const primary = [
    factorStatus(session.factors?.password, policy.passwordLifetimeMs, now),
    factorStatus(session.factors?.intent, policy.externalLoginLifetimeMs, now),
    session.factors?.webAuthN?.userVerified === true ? factorStatus(session.factors.webAuthN, policy.multiFactorLifetimeMs, now) : "missing",
  ];
  if (primary.includes("active")) return "active";
  if (primary.includes("expired")) return "expired";
  const lastActivity = timestampMs(session.changeDate) ?? timestampMs(session.creationDate);
  return lastActivity === undefined || now - lastActivity >= PENDING_STALE_MS ? "expired" : "hidden";
}

export async function devices(identity: Identity): Promise<Device[]> {
  const now = Date.now();
  const active: { session: Session; current: boolean; sortAt: number; createdAtMs: number }[] = [];
  const staleIds: string[] = [];

  for (let offset = 0n; ;) {
    const page = await getClients().session.listSessions({ query: { offset, limit: 100 }, queries: [{ query: { case: "userIdQuery", value: { id: identity.ref.userId } } }] });
    for (const session of page.sessions) {
      if (session.factors?.user?.id !== identity.ref.userId) continue;
      const status = classifySession(session, identity, now);
      if (status === "expired") {
        staleIds.push(session.id);
        continue;
      }
      if (status === "hidden") continue;
      const createdAtMs = timestampMs(session.creationDate) ?? 0;
      const sortAt = timestampMs(session.changeDate) ?? createdAtMs;
      active.push({ session, current: session.id === identity.ref.sessionId, sortAt, createdAtMs });
    }
    offset += BigInt(page.sessions.length);
    if (!page.sessions.length || offset >= (page.details?.totalResult ?? offset)) break;
  }

  active.sort((a, b) => Number(b.current) - Number(a.current) || b.sortAt - a.sortAt || b.createdAtMs - a.createdAtMs);

  const result: Device[] = [];
  const seenFingerprints = new Set<string>();
  for (const item of active) {
    const fingerprint = item.session.userAgent?.fingerprintId?.trim();
    if (fingerprint) {
      if (seenFingerprints.has(fingerprint)) {
        if (!item.current) staleIds.push(item.session.id);
        continue;
      }
      seenFingerprints.add(fingerprint);
    }
    result.push({
      id: item.session.id,
      name: item.session.userAgent?.description || "浏览器会话",
      createdAt: isoDate(item.session.creationDate),
      lastUsedAt: isoDate(item.session.changeDate),
      current: item.current,
    });
  }

  const toDelete = [...new Set(staleIds)].filter(id => id !== identity.ref.sessionId).slice(0, MAX_CLEANUP_PER_LIST);
  for (let i = 0; i < toDelete.length; i += 10) {
    await Promise.allSettled(toDelete.slice(i, i + 10).map(sessionId => getClients().session.deleteSession({ sessionId })));
  }

  return result;
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
