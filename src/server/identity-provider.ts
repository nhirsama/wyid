import type { PendingSession } from "./session";
import { AuthError } from "./errors";
import { zitadel } from "./zitadel/service";

type IntentRef = { idpIntentId: string; idpIntentToken: string };

/** Revalidate the selected provider and retrieve intent data at every boundary. */
export async function inspectIdentityProvider(pending: PendingSession, intent: IntentRef) {
  // Old flow cookies without a provider/organization binding must restart.
  if (!pending.idpId || pending.idpOrganizationId === undefined) throw new AuthError("身份提供方登录请求已过期，请重新开始。");
  const organizationId = await zitadel.organizationForAuth(pending.authRequestId);
  if ((organizationId || "") !== pending.idpOrganizationId) throw new AuthError("登录请求的组织已变化，请重新开始身份提供方登录。");
  const policy = await zitadel.policy(organizationId);
  const provider = policy.identityProviders.find(item => item.id === pending.idpId);
  if (!provider) throw new AuthError("此登录方式当前不可用，请重新选择登录方式。");
  const result = await zitadel.retrieveIdp(intent.idpIntentId, intent.idpIntentToken);
  if (result.idpInformation?.idpId !== provider.id) throw new AuthError("身份提供方与本次登录请求不匹配，请重新开始。");
  return { provider, result };
}
