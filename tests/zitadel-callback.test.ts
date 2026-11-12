import { create } from "@bufbuild/protobuf";
import { ListAppsResponseSchema, ListProjectsResponseSchema } from "@zitadel/proto/zitadel/management_pb.js";
import { CreateCallbackResponseSchema, GetAuthRequestResponseSchema } from "@zitadel/proto/zitadel/oidc/v2/oidc_service_pb.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/server/errors";
import type { getClients } from "@/server/zitadel/sdk";

type Clients = ReturnType<typeof getClients>;
const mocks = vi.hoisted(() => ({
  oidc: {
    getAuthRequest: vi.fn<Clients["oidc"]["getAuthRequest"]>(),
    createCallback: vi.fn<Clients["oidc"]["createCallback"]>(),
  },
  management: {
    listProjects: vi.fn<Clients["management"]["listProjects"]>(),
    listApps: vi.fn<Clients["management"]["listApps"]>(),
  },
}));
vi.mock("@/server/zitadel/sdk", () => ({ getClients: () => mocks }));
import { zitadel } from "@/server/zitadel/service";

const session = { sessionId: "session-id", sessionToken: "session-token" };
const flows = [
  { name: "authorization", kind: "session", run: () => zitadel.callback("V2_test", session) },
  { name: "denial", kind: "error", run: () => zitadel.deny("V2_test") },
];

function redirect(uri: string, callbackUrl = `${uri}?result=opaque`) {
  mocks.oidc.getAuthRequest.mockResolvedValue(create(GetAuthRequestResponseSchema, {
    authRequest: { id: "V2_test", clientId: "client-id", redirectUri: uri },
  }));
  mocks.oidc.createCallback.mockResolvedValue(create(CreateCallbackResponseSchema, { callbackUrl }));
  return callbackUrl;
}
function application(devMode?: boolean) {
  mocks.management.listApps.mockResolvedValue(create(ListAppsResponseSchema, {
    result: [{ id: "app-id", name: "Test App", config: { case: "oidcConfig", value: { clientId: "client-id", devMode } } }],
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  mocks.management.listProjects.mockResolvedValue(create(ListProjectsResponseSchema, { result: [{ id: "project-id" }] }));
  redirect("http://localhost:3000/callback");
  application(true);
});
afterEach(() => vi.unstubAllEnvs());

describe.each(flows)("OIDC $name callback policy", ({ run, kind }) => {
  it.each([
    "http://localhost:3000/callback", "http://127.0.0.1:3000/callback",
    "http://192.168.1.10:8080/callback", "http://app.example.com/callback",
  ])("allows %s in production when this application's devMode is true", async uri => {
    const url = redirect(uri);
    expect(await run()).toBe(url);
    expect(mocks.oidc.getAuthRequest).toHaveBeenCalledWith({ authRequestId: "V2_test" });
    expect(mocks.management.listApps).toHaveBeenCalledWith({
      projectId: "project-id", query: { offset: 0n, limit: 100, asc: false }, queries: [],
    });
    expect(mocks.oidc.createCallback).toHaveBeenCalledWith(expect.objectContaining({
      authRequestId: "V2_test", callbackKind: expect.objectContaining({ case: kind }),
    }));
    expect(mocks.management.listApps.mock.invocationCallOrder[0]).toBeLessThan(mocks.oidc.createCallback.mock.invocationCallOrder[0]);
  });

  it.each(["production", "development", "test"])("rejects HTTP without app devMode even with NODE_ENV=%s", async nodeEnv => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    application(false);
    await expect(run()).rejects.toThrow("当前应用未开启开发模式");
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it("does not treat an omitted devMode field as enabled", async () => {
    application();
    await expect(run()).rejects.toBeInstanceOf(AuthError);
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it("keeps HTTPS working without Management API access", async () => {
    const url = redirect("https://app.example.com/callback");
    mocks.management.listProjects.mockRejectedValue({ code: 7 });
    expect(await run()).toBe(url);
    expect(mocks.management.listProjects).not.toHaveBeenCalled();
    expect(mocks.management.listApps).not.toHaveBeenCalled();
  });

  it.each(["listProjects", "listApps"] as const)("rejects HTTP before consuming the request when %s fails", async method => {
    mocks.management[method].mockRejectedValue({ code: 9 });
    await expect(run()).rejects.toThrow("无法读取当前应用的开发模式");
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it("does not use a different application's development-mode setting", async () => {
    mocks.management.listApps.mockResolvedValue(create(ListAppsResponseSchema, {
      result: [
        { config: { case: "oidcConfig", value: { clientId: "different-client", devMode: true } } },
        { config: { case: "oidcConfig", value: { clientId: "client-id", devMode: false } } },
      ],
    }));
    await expect(run()).rejects.toThrow("当前应用未开启开发模式");
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it("rejects HTTP if the exact OIDC application cannot be found", async () => {
    mocks.management.listApps.mockResolvedValue(create(ListAppsResponseSchema, {
      result: [{ config: { case: "apiConfig", value: { clientId: "client-id" } } }],
    }));
    await expect(run()).rejects.toThrow("无法读取当前应用的开发模式");
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it("reads all project and application pages until the exact client is found", async () => {
    mocks.management.listProjects
      .mockResolvedValueOnce(create(ListProjectsResponseSchema, { result: [{ id: "other-project" }], details: { totalResult: 2n } }))
      .mockResolvedValueOnce(create(ListProjectsResponseSchema, { result: [{ id: "project-id" }], details: { totalResult: 2n } }));
    mocks.management.listApps
      .mockResolvedValueOnce(create(ListAppsResponseSchema))
      .mockResolvedValueOnce(create(ListAppsResponseSchema, {
        result: [{ config: { case: "oidcConfig", value: { clientId: "different-client", devMode: true } } }], details: { totalResult: 2n },
      }));
    expect(await run()).toBe("http://localhost:3000/callback?result=opaque");
    expect(mocks.management.listProjects).toHaveBeenNthCalledWith(2, {
      query: { offset: 1n, limit: 100, asc: false }, queries: [],
    });
    expect(mocks.management.listApps).toHaveBeenNthCalledWith(3, {
      projectId: "project-id", query: { offset: 1n, limit: 100, asc: false }, queries: [],
    });
  });

  it("re-reads devMode rather than retaining an exemption after it is disabled", async () => {
    await run();
    mocks.oidc.createCallback.mockClear();
    application(false);
    await expect(run()).rejects.toThrow("当前应用未开启开发模式");
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(1)", "ftp://app.example.com/callback", "not-a-url",
    "http://user:password@localhost:3000/callback", "https://user:password@app.example.com/callback",
  ])("rejects an invalid request redirect %s before consuming authorization", async uri => {
    redirect(uri);
    await expect(run()).rejects.toThrow();
    expect(mocks.oidc.createCallback).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "http://user:password@localhost:3000/callback"])("still rejects an unsafe callback result %s in app devMode", async url => {
    redirect("http://localhost:3000/callback", url);
    await expect(run()).rejects.toThrow("Invalid upstream redirect");
  });

  it("does not allow an unexpected HTTP result for an HTTPS authorization request", async () => {
    vi.stubEnv("NODE_ENV", "development");
    redirect("https://app.example.com/callback", "http://localhost:3000/callback");
    await expect(run()).rejects.toThrow("Invalid upstream redirect");
  });

  it("preserves upstream callback failures after the redirect policy check", async () => {
    const error = { code: 9 };
    mocks.oidc.createCallback.mockRejectedValue(error);
    await expect(run()).rejects.toBe(error);
  });
});

describe("shared OIDC application lookup", () => {
  it("continues to resolve the application name", async () => {
    expect(await zitadel.applicationName("client-id")).toBe("Test App");
  });

  it("keeps the display fallback when app lookup is unavailable", async () => {
    mocks.management.listProjects.mockRejectedValue({ code: 7 });
    expect(await zitadel.applicationName("client-id")).toBe("");
  });
});
