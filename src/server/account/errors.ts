export class AccountError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new AccountError(status, code, message);
}
