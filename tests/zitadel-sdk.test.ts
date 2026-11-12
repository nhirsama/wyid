import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Http2Server, type IncomingHttpHeaders, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";

let server: Http2Server;
let receivedHeaders: IncomingHttpHeaders[];
const sessions = new Set<ServerHttp2Session>();

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("ZITADEL_SERVICE_TOKEN", "test-service-token");
  vi.stubEnv("ZITADEL_SERVICE_USER_TOKEN_FILE", "");
  vi.stubEnv("ZITADEL_EXTERNALDOMAIN", "");
  vi.stubEnv("CUSTOM_REQUEST_HEADERS", "");
  vi.stubEnv("SESSION_SECRET", "independent-test-session-secret-at-least-32-chars");
  vi.stubEnv("NODE_ENV", "test");

  receivedHeaders = [];
  server = createServer();
  server.on("session", session => {
    sessions.add(session);
    session.once("close", () => sessions.delete(session));
  });
  server.on("stream", (stream, headers) => {
    receivedHeaders.push(headers);
    stream.resume();
    stream.once("end", () => {
      stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
      stream.once("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
      // An uncompressed, zero-length protobuf response in a gRPC envelope.
      stream.end(Buffer.alloc(5));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("ZITADEL_API_URL", `http://127.0.0.1:${port}`);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const session of sessions) session.destroy();
  sessions.clear();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("ZITADEL gRPC transport", () => {
  it("uses an explicit user session token and organization without reusing the PAT singleton", async () => {
    vi.stubEnv("ZITADEL_EXTERNALDOMAIN", "id.example.com");
    const { getClients, getUserClients } = await import("@/server/zitadel/sdk");
    expect(() => getUserClients("")).toThrow("Missing user session token");
    await getUserClients("user-session-token", "user-org").user.getUserByID({ userId: "user" });
    await getClients().user.getUserByID({ userId: "user" });
    expect(receivedHeaders[0]).toMatchObject({ authorization: "Bearer user-session-token", "x-zitadel-orgid": "user-org" });
    expect(receivedHeaders[1]).toMatchObject({ authorization: "Bearer test-service-token" });
  });
  it.each([
    { externalDomain: "", customHeaders: "", expectedHost: undefined },
    { externalDomain: "id.example.com", customHeaders: "", expectedHost: "id.example.com" },
    { externalDomain: "", customHeaders: "Host:id.example.com,X-Custom:custom-value", expectedHost: "id.example.com" },
  ])("does not send Host alongside :authority with $externalDomain / $customHeaders", async ({ externalDomain, customHeaders, expectedHost }) => {
    vi.stubEnv("ZITADEL_EXTERNALDOMAIN", externalDomain);
    vi.stubEnv("CUSTOM_REQUEST_HEADERS", customHeaders);
    const { getClients } = await import("@/server/zitadel/sdk");
    const clients = getClients();
    await clients.settings.getLoginSettings({});
    expect(getClients()).toBe(clients);

    const apiHost = new URL(process.env.ZITADEL_API_URL!).host;
    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0]).toMatchObject({
      ":authority": apiHost,
      ":path": "/zitadel.settings.v2.SettingsService/GetLoginSettings",
      authorization: "Bearer test-service-token",
      "x-forwarded-proto": expectedHost ? "https" : "http",
      "x-zitadel-instance-host": expectedHost || apiHost,
      "x-zitadel-public-host": expectedHost || apiHost,
    });
    expect(receivedHeaders[0]).not.toHaveProperty("host");
    if (customHeaders) expect(receivedHeaders[0]["x-custom"]).toBe("custom-value");
  });
});
