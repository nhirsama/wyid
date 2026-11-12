import { createServerTransport } from "@zitadel/client/node";
import { createAuthServiceClient, createManagementServiceClient } from "@zitadel/client/v1";
import { createOIDCServiceClient, createSessionServiceClient, createSettingsServiceClient, createUserServiceClient } from "@zitadel/client/v2";
import { getConfig, zitadelRequestHeaders } from "@/server/config";

function createClients(token?: string, organizationId?: string) {
  const config = getConfig();
  const headers = zitadelRequestHeaders(config);
  const transport = createServerTransport(token ?? config.token, {
    baseUrl: config.apiUrl,
    defaultTimeoutMs: 15_000,
    interceptors: [next => async request => {
      for (const [name, value] of Object.entries(headers)) request.header.set(name, value);
      if (organizationId) request.header.set("x-zitadel-orgid", organizationId);
      return next(request);
    }],
  });
  return {
    auth: createAuthServiceClient(transport),
    management: createManagementServiceClient(transport),
    session: createSessionServiceClient(transport), oidc: createOIDCServiceClient(transport),
    user: createUserServiceClient(transport), settings: createSettingsServiceClient(transport),
  };
}
let singleton: ReturnType<typeof createClients> | undefined;
export function getClients() { return singleton ??= createClients(); }

/** Self-service requests must never fall back to the service account. */
export function getUserClients(sessionToken: string, organizationId?: string) {
  if (!sessionToken) throw new Error("Missing user session token");
  return createClients(sessionToken, organizationId);
}
export function getOrganizationClients(organizationId: string) { return createClients(undefined, organizationId); }
