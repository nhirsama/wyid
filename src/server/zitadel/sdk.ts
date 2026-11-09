import { createServerTransport } from "@zitadel/client/node";
import { createOIDCServiceClient, createSessionServiceClient, createSettingsServiceClient, createUserServiceClient } from "@zitadel/client/v2";
import { getConfig } from "@/server/config";

function createClients() {
  const config = getConfig();
  const transport = createServerTransport(config.token, { baseUrl: config.apiUrl, defaultTimeoutMs: 15_000 });
  return {
    session: createSessionServiceClient(transport), oidc: createOIDCServiceClient(transport),
    user: createUserServiceClient(transport), settings: createSettingsServiceClient(transport),
  };
}
let singleton: ReturnType<typeof createClients> | undefined;
export function getClients() { return singleton ??= createClients(); }
