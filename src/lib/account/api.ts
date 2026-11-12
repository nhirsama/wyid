import type { ApiErrorBody } from "./types";
import { withBasePath } from "@/lib/paths";
const portalPath = (path: string) => withBasePath(path, typeof document === "undefined" ? "" : document.documentElement.dataset.basePath || "");

type ReadEntry = { value?: unknown; expires: number; pending?: Promise<unknown> };
const reads = new Map<string, ReadEntry>();
const readLifetime = 60_000;
const cacheableRead = (pathname: string) => /^\/apps(?:\/[^/]+)?$/.test(pathname) || ["/me", "/me/methods", "/me/sessions"].includes(pathname);

/** Private read data stays in this browser document, never in persistent storage. */
export function clearApiCache() { reads.clear(); }
export function cachedApiData<T>(pathname: string): T | null {
  if (typeof window === "undefined") return null;
  const entry = reads.get(pathname);
  return entry && entry.expires > Date.now() ? (entry.value as T | undefined) ?? null : null;
}
export function readApi<T>(pathname: string, refresh = false): Promise<T> {
  if (typeof window === "undefined" || !cacheableRead(pathname)) return api<T>(pathname);
  const cached = reads.get(pathname);
  if (cached?.pending) return cached.pending as Promise<T>;
  if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value as T);
  const entry: ReadEntry = { expires: 0 };
  const pending = api<T>(pathname).then(value => {
    // A mutation or sign-out may have invalidated this read while it was running.
    if (reads.get(pathname) === entry) { entry.value = value; entry.expires = Date.now() + readLifetime; entry.pending = undefined; }
    return value;
  }).catch(error => { if (reads.get(pathname) === entry) reads.delete(pathname); throw error; });
  entry.pending = pending;
  if (reads.size >= 100) reads.delete(reads.keys().next().value!);
  reads.set(pathname, entry);
  return pending;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, options?: ErrorOptions) {
    super(requestId ? `${message}（请求编号：${requestId}）` : message, options);
  }
}
export async function api<T>(pathname: string, options: RequestInit = {}): Promise<T> {
  const mutation = !["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
  if (mutation) clearApiCache();
  let response: Response;
  try {
    response = await fetch(portalPath(`/api/account${pathname}`), {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json", ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch (cause) {
    throw new ApiError(0, "network_error", "连接失败，请检查网络后重试。", undefined, { cause });
  }
  if (mutation || response.status === 401) clearApiCache();
  if (response.status === 204) return undefined as T;
  const requestId = response.headers.get("x-request-id") || undefined;
  let data: unknown;
  try { data = await response.json(); }
  catch (cause) { throw new ApiError(response.ok ? 502 : response.status, "invalid_response", "服务响应异常，请稍后重试。", requestId, { cause }); }
  if (!response.ok) {
    const error = data && typeof data === "object" ? (data as Partial<ApiErrorBody>).error : undefined;
    throw new ApiError(response.status, typeof error?.code === "string" && error.code ? error.code : "request_failed", typeof error?.message === "string" && error.message.trim() ? error.message : "请求失败，请稍后重试。", typeof error?.requestId === "string" && error.requestId ? error.requestId : requestId);
  }
  if (!data || typeof data !== "object") throw new ApiError(502, "invalid_response", "服务响应异常，请稍后重试。", requestId);
  return data as T;
}
export function post<T>(pathname: string, data: unknown = {}, options: RequestInit = {}) {
  return api<T>(pathname, { ...options, method: "POST", body: JSON.stringify(data) });
}
