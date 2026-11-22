import type { ConnectError } from "@connectrpc/connect";

export class AccountError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type ApplicationRpc = "ListUserMemberships" | "AddProject" | "AddProjectMember" | "ListApps" | "AddOIDCApp";

export class ApplicationRpcError extends Error {
  constructor(readonly rpc: ApplicationRpc, readonly upstream: ConnectError) {
    super("ZITADEL application RPC failed");
  }
  get actor() { return this.rpc === "AddOIDCApp" || this.rpc === "ListApps" ? "user-session" : "service-account"; }
}
export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new AccountError(status, code, message);
}
