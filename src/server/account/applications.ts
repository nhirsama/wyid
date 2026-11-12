import { setTimeout as delay } from "node:timers/promises";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { AppSchema, AppState, OIDCAppType, OIDCAuthMethodType, OIDCGrantType, OIDCResponseType, OIDCTokenType, OIDCVersion, type App } from "@zitadel/proto/zitadel/app_pb.js";
import type { Application, ApplicationInput } from "@/lib/account/types";
import { siteUrl } from "@/lib/paths";
import { getConfig } from "@/server/config";
import { getOrganizationClients, getUserClients } from "@/server/zitadel/sdk";
import { assert } from "./errors";
import { isoDate, type Identity } from "./identity";

export function applicationIds(id: string) {
  const parts = id.split(":");
  assert(parts.length === 2 && parts.every(part => /^[\w-]{1,200}$/.test(part)), 400, "invalid_application", "应用标识无效。");
  return { projectId: parts[0], appId: parts[1] };
}
export function publicApplication(projectId: string, app: App): Application {
  assert(app.config.case === "oidcConfig", 404, "application_not_found", "没有此 OIDC 应用。");
  const config = app.config.value;
  let website = config.additionalOrigins[0] || "";
  if (!website && config.redirectUris[0]) { try { website = new URL(config.redirectUris[0]).origin; } catch { /* legacy application */ } }
  return { id: `${projectId}:${app.id}`, projectId, name: app.name, website, type: config.appType === OIDCAppType.OIDC_APP_TYPE_USER_AGENT ? "spa" : "web", enabled: app.state === AppState.ACTIVE, clientId: config.clientId, redirectUris: config.redirectUris, postLogoutRedirectUris: config.postLogoutRedirectUris, createdAt: isoDate(app.details?.creationDate), updatedAt: isoDate(app.details?.changeDate) };
}
export function appConfig(input: ApplicationInput) {
  return {
    redirectUris: [...new Set(input.redirectUris)], postLogoutRedirectUris: [...new Set(input.postLogoutRedirectUris)],
    responseTypes: [OIDCResponseType.OIDC_RESPONSE_TYPE_CODE], grantTypes: [OIDCGrantType.OIDC_GRANT_TYPE_AUTHORIZATION_CODE],
    appType: input.type === "spa" ? OIDCAppType.OIDC_APP_TYPE_USER_AGENT : OIDCAppType.OIDC_APP_TYPE_WEB,
    authMethodType: input.type === "spa" ? OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_NONE : OIDCAuthMethodType.OIDC_AUTH_METHOD_TYPE_BASIC,
    version: OIDCVersion.OIDC_VERSION_1_0, accessTokenType: OIDCTokenType.OIDC_TOKEN_TYPE_JWT,
    additionalOrigins: [new URL(input.website).origin],
    devMode: [input.website, ...input.redirectUris, ...input.postLogoutRedirectUris].some(uri => new URL(uri).protocol === "http:"),
    loginVersion: { version: { case: "loginV2" as const, value: { baseUri: siteUrl("/", getConfig().appUrl).toString() } } },
  };
}

export class Applications {
  private user;
  private bootstrap;
  constructor(private identity: Identity) {
    this.user = getUserClients(identity.ref.sessionToken, identity.organizationId).management;
    this.bootstrap = getOrganizationClients(identity.organizationId).management;
  }
  private async memberships() {
    const memberships = [];
    for (let offset = 0n; ;) {
      const page = await this.bootstrap.listUserMemberships({ userId: this.identity.ref.userId, query: { offset, limit: 100 } });
      memberships.push(...page.result.filter(item => item.userId === this.identity.ref.userId && item.details?.resourceOwner === this.identity.organizationId && item.type.case === "projectId"));
      offset += BigInt(page.result.length);
      if (!page.result.length || offset >= (page.details?.totalResult ?? offset)) return memberships;
    }
  }
  private async ownedProject() {
    return (await this.memberships()).filter(item => item.roles.includes("PROJECT_OWNER")).map(item => item.type.case === "projectId" ? item.type.value : "").filter(Boolean).sort()[0];
  }
  private async ensureProject() {
    const existing = await this.ownedProject();
    if (existing) return existing;
    let project;
    try {
      project = await this.bootstrap.addProject({ name: `wyid - ${this.identity.ref.userId}`, projectRoleAssertion: false, projectRoleCheck: false, hasProjectCheck: false });
    } catch (error) {
      if (!(error instanceof ConnectError) || error.code !== Code.AlreadyExists) throw error;
      for (const wait of [0, 50, 150, 300, 500]) {
        if (wait) await delay(wait);
        const id = await this.ownedProject();
        if (id) return id;
      }
      throw error;
    }
    assert(project.id, 502, "invalid_response", "身份服务未返回项目标识。");
    await this.bootstrap.addProjectMember({ projectId: project.id, userId: this.identity.ref.userId, roles: ["PROJECT_OWNER"] });
    return project.id;
  }
  async list() {
    const ids = [...new Set((await this.memberships()).map(item => item.type.case === "projectId" ? item.type.value : "").filter(Boolean))];
    const result: Application[] = [];
    for (const projectId of ids) {
      for (let offset = 0n; ;) {
        const page = await this.user.listApps({ projectId, query: { offset, limit: 100 } });
        result.push(...page.result.filter(app => app.config.case === "oidcConfig").map(app => publicApplication(projectId, app)));
        offset += BigInt(page.result.length);
        if (!page.result.length || offset >= (page.details?.totalResult ?? offset)) break;
      }
    }
    return result;
  }
  private async raw(id: string) {
    const ids = applicationIds(id);
    const member = (await this.memberships()).some(item => item.type.case === "projectId" && item.type.value === ids.projectId);
    assert(member, 404, "application_not_found", "没有此应用或你已不再是项目成员。");
    const { app } = await this.user.getAppByID(ids);
    assert(app?.id && app.config.case === "oidcConfig", 404, "application_not_found", "没有此 OIDC 应用。");
    return { ...ids, app };
  }
  async get(id: string) { const { projectId, app } = await this.raw(id); return publicApplication(projectId, app); }
  async create(input: ApplicationInput) {
    const projectId = await this.ensureProject();
    const result = await this.user.addOIDCApp({ projectId, name: input.name, ...appConfig(input) });
    assert(result.appId && result.clientId, 502, "invalid_response", "身份服务未返回完整应用标识。");
    const app = create(AppSchema, { id: result.appId, name: input.name, state: AppState.ACTIVE, details: result.details, config: { case: "oidcConfig", value: { ...appConfig(input), clientId: result.clientId } } });
    return { application: publicApplication(projectId, app), ...(result.clientSecret ? { clientSecret: result.clientSecret } : {}) };
  }
  async update(id: string, input: ApplicationInput) {
    const { projectId, appId, app } = await this.raw(id);
    assert(app.config.case === "oidcConfig", 404, "application_not_found", "没有此 OIDC 应用。");
    const original = publicApplication(projectId, app);
    assert(original.type === input.type, 400, "application_type_changed", "应用类型不能在创建后更改，请新建应用。");
    const { $typeName: _type, clientId: _clientId, allowedOrigins: _allowed, noneCompliant: _compliant, complianceProblems: _problems, ...existing } = app.config.value;
    void _type; void _clientId; void _allowed; void _compliant; void _problems;
    await this.user.updateOIDCAppConfig({ ...existing, ...appConfig(input), projectId, appId });
    if (app.name !== input.name) await this.user.updateApp({ projectId, appId, name: input.name });
    return this.get(id);
  }
  async enabled(id: string, enabled: boolean) {
    const { projectId, appId } = await this.raw(id);
    if (enabled) await this.user.reactivateApp({ projectId, appId });
    else await this.user.deactivateApp({ projectId, appId });
    return this.get(id);
  }
  async rotate(id: string) {
    const { projectId, appId, app } = await this.raw(id);
    assert(app.config.case === "oidcConfig" && app.config.value.appType === OIDCAppType.OIDC_APP_TYPE_WEB, 400, "public_client", "前端单页应用不使用 Client Secret。");
    const { clientSecret } = await this.user.regenerateOIDCClientSecret({ projectId, appId });
    assert(clientSecret, 502, "invalid_response", "身份服务未返回新密钥。");
    return { clientSecret };
  }
  async remove(id: string) { const { projectId, appId } = await this.raw(id); await this.user.removeApp({ projectId, appId }); }
}
