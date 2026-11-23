import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  headers: vi.fn(),
  config: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@/server/config", () => ({ getConfig: mocks.config }));

import { currentSessionUserAgent, describeUserAgent, ensureDeviceFingerprint, readDeviceFingerprint } from "@/server/device-agent";

function cookieStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: vi.fn((name: string) => (map.has(name) ? { name, value: map.get(name)! } : undefined)),
    set: vi.fn((name: string, value: string) => { map.set(name, value); }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ appUrl: "https://login.example.com" });
});

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome · macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge · Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari · iPhone"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox · Linux"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Chrome · Android"],
    ["", "浏览器会话"],
    [null, "浏览器会话"],
  ])("formats %s as %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });
});

describe("device fingerprint cookies and session userAgent", () => {
  const validId = "a137fc65-3e87-4da0-b5cd-936eb5972868";

  it("reuses an existing valid __Host-wyid-device cookie on HTTPS", async () => {
    const store = cookieStore({ "__Host-wyid-device": validId });
    mocks.cookies.mockResolvedValue(store);
    expect(await readDeviceFingerprint()).toBe(validId);
    expect(await ensureDeviceFingerprint()).toBe(validId);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("creates and persists a new UUID device cookie when missing or invalid", async () => {
    mocks.config.mockReturnValue({ appUrl: "http://localhost:3000" });
    const store = cookieStore({ "wyid-device": "not-a-uuid" });
    mocks.cookies.mockResolvedValue(store);
    expect(await readDeviceFingerprint()).toBeUndefined();
    const created = await ensureDeviceFingerprint();
    expect(created).toMatch(/^[0-9a-f-]{36}$/i);
    expect(store.set).toHaveBeenCalledWith("wyid-device", created, expect.objectContaining({ httpOnly: true, secure: false, sameSite: "lax", path: "/" }));
  });

  it("builds session userAgent from request headers and device fingerprint", async () => {
    const store = cookieStore({ "__Host-wyid-device": validId });
    mocks.cookies.mockResolvedValue(store);
    mocks.headers.mockResolvedValue(new Headers({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36" }));
    expect(await currentSessionUserAgent()).toEqual({ fingerprintId: validId, description: "Chrome · macOS" });
  });

  it("returns undefined outside a Next.js request context", async () => {
    mocks.cookies.mockRejectedValue(new Error("outside request scope"));
    mocks.headers.mockRejectedValue(new Error("outside request scope"));
    expect(await currentSessionUserAgent()).toBeUndefined();
  });
});
