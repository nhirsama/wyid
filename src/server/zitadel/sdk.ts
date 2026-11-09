import { createServerTransport } from "@zitadel/client/node";
import { createOIDCServiceClient, createSessionServiceClient, createSettingsServiceClient, createUserServiceClient } from "@zitadel/client/v2";
import { getConfig, zitadelRequestHeaders } from "@/server/config";

function createClients() {
  const config = getConfig();
  const headers = zitadelRequestHeaders(config);
  const transport = createServerTransport(config.token, {
    baseUrl: config.apiUrl,
    defaultTimeoutMs: 15_000,
    interceptors: [next => async request => {
      for (const [name, value] of Object.entries(headers)) request.header.set(name, value);
      return next(request);
    }],
  });
  return {
    session: createSessionServiceClient(transport), oidc: createOIDCServiceClient(transport),
    user: createUserServiceClient(transport), settings: createSettingsServiceClient(transport),
  };
}
let singleton: ReturnType<typeof createClients> | undefined;
export function getClients() { return singleton ??= createClients(); }
