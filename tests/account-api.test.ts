import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, cachedApiData, clearApiCache, post, readApi } from "@/lib/account/api";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: { basePath: "/id" } } });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  clearApiCache();
});
afterEach(() => { clearApiCache(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const success = (data: unknown) => Response.json(data);

describe("private account read cache", () => {
  it("reuses pending and completed reads without persisting account data", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = readApi("/apps");
    expect(readApi("/apps")).toBe(first);
    resolve(success({ applications: [] }));
    await expect(first).resolves.toEqual({ applications: [] });
    await expect(readApi("/apps")).resolves.toEqual({ applications: [] });
    expect(cachedApiData("/apps")).toEqual({ applications: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/id/api/account/apps", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });
  it("expires reads after one minute and deduplicates explicit refreshes", async () => {
    fetchMock.mockImplementation(async () => success({ applications: [] }));
    await readApi("/apps");
    vi.advanceTimersByTime(60_001);
    expect(cachedApiData("/apps")).toBeNull();
    await readApi("/apps");
    const refreshed = readApi("/apps", true);
    expect(readApi("/apps", true)).toBe(refreshed);
    await refreshed;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not repopulate invalidated data from an older in-flight read", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = readApi("/apps");
    clearApiCache();
    resolve(success({ applications: ["old"] }));
    await pending;
    expect(cachedApiData("/apps")).toBeNull();
  });
  it("invalidates reads on mutations so returning to the list shows current data", async () => {
    fetchMock.mockImplementation(async () => success({ applications: [] }));
    await readApi("/apps");
    await post("/apps", { name: "New" });
    expect(cachedApiData("/apps")).toBeNull();
    await readApi("/apps");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([[401, "session_expired"], [403, "authentication_incomplete"]])("invalidates all reads for authentication failure %s/%s", async (status, code) => {
    fetchMock.mockResolvedValueOnce(success({ applications: [] }));
    await readApi("/apps");
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code, message: "继续验证" } }, { status }));
    await expect(readApi("/me")).rejects.toMatchObject({ status, code });
    expect(cachedApiData("/apps")).toBeNull();
  });
  it("keeps unrelated reads after a temporary upstream failure and allows retry", async () => {
    fetchMock.mockResolvedValueOnce(success({ applications: [] }));
    await readApi("/apps");
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "unavailable", message: "稍后重试" } }, { status: 503 }));
    await expect(readApi("/me")).rejects.toBeInstanceOf(ApiError);
    expect(cachedApiData("/apps")).toEqual({ applications: [] });
    fetchMock.mockResolvedValueOnce(success({ account: { id: "user" } }));
    await expect(readApi("/me")).resolves.toEqual({ account: { id: "user" } });
  });
  it("never caches non-allowlisted API responses", async () => {
    fetchMock.mockImplementation(async () => success({ secret: "one-time" }));
    await readApi("/apps/project:app/secret");
    await api("/apps/project:app/secret");
    expect(cachedApiData("/apps/project:app/secret")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
