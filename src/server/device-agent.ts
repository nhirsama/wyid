import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getConfig } from "./config";

export type SessionUserAgent = { fingerprintId?: string; description?: string };

const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deviceCookieOptions() {
  const secure = new URL(getConfig().appUrl).protocol === "https:";
  return { name: secure ? "__Host-wyid-device" : "wyid-device", secure };
}

export function describeUserAgent(ua?: string | null): string {
  const value = ua?.trim();
  if (!value) return "浏览器会话";
  const browser =
    /Edg(?:A|iOS)?\//i.test(value) ? "Edge"
    : /(?:OPR|Opera)\//i.test(value) ? "Opera"
    : /SamsungBrowser\//i.test(value) ? "Samsung Internet"
    : /(?:Firefox|FxiOS)\//i.test(value) ? "Firefox"
    : /(?:Chrome|CriOS)\//i.test(value) ? "Chrome"
    : /Safari\//i.test(value) && !/(?:Chrome|Chromium|Android)/i.test(value) ? "Safari"
    : "";
  const os =
    /iPhone/i.test(value) ? "iPhone"
    : /iPad/i.test(value) ? "iPad"
    : /Android/i.test(value) ? "Android"
    : /CrOS/i.test(value) ? "ChromeOS"
    : /Windows/i.test(value) ? "Windows"
    : /Macintosh|Mac OS X/i.test(value) ? "macOS"
    : /Linux/i.test(value) ? "Linux"
    : "";
  if (browser && os) return `${browser} · ${os}`;
  return browser || os || "浏览器会话";
}

export async function readDeviceFingerprint(): Promise<string | undefined> {
  try {
    const { name } = deviceCookieOptions();
    const value = (await cookies()).get(name)?.value?.trim();
    return value && FINGERPRINT_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function ensureDeviceFingerprint(): Promise<string | undefined> {
  try {
    const { name, secure } = deviceCookieOptions();
    const store = await cookies();
    const existing = store.get(name)?.value?.trim();
    if (existing && FINGERPRINT_PATTERN.test(existing)) return existing;
    const fingerprintId = randomUUID();
    store.set(name, fingerprintId, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_MAX_AGE });
    return fingerprintId;
  } catch {
    return undefined;
  }
}

export async function currentSessionUserAgent(): Promise<SessionUserAgent | undefined> {
  let ua: string | null = null;
  try { ua = (await headers()).get("user-agent"); } catch { /* Outside a request context (e.g. unit tests). */ }
  const fingerprintId = await ensureDeviceFingerprint();
  const description = ua?.trim() ? describeUserAgent(ua) : undefined;
  if (!fingerprintId && !description) return undefined;
  return { ...(fingerprintId ? { fingerprintId } : {}), ...(description ? { description } : {}) };
}
