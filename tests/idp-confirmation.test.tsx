import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ pending: vi.fn(), organization: vi.fn(), policy: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/server/session", () => ({ readPendingSession: mocks.pending }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: { organizationForAuth: mocks.organization, policy: mocks.policy, retrieveIdp: mocks.retrieve } }));
vi.mock("@/server/actions", () => ({ confirmIdentityProviderRegistration: vi.fn() }));

import IdentityProviderConfirmation from "@/app/(auth)/idp/confirm/page";

const state = "00000000-0000-4000-8000-000000000000";
const pending = { sessionId: "", sessionToken: "", authRequestId: "V2_test", idpId: "idp", idpOrganizationId: "org-id", idpState: state, idpIntentId: "intent-id", idpIntentToken: "intent-token" };
const provider = { id: "idp", creationAllowed: true, autoCreation: false };
const render = async () => renderToStaticMarkup(await IdentityProviderConfirmation({ searchParams: Promise.resolve({ state }) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.pending.mockResolvedValue(pending);
  mocks.organization.mockResolvedValue("org-id");
  mocks.policy.mockResolvedValue({ identityProviders: [provider] });
  mocks.retrieve.mockResolvedValue({ idpInformation: { idpId: "idp" }, userId: "", addHumanUser: { profile: { displayName: "Live Profile" }, email: { email: "live@example.com" } } });
});
afterEach(() => vi.restoreAllMocks());

describe("IDP registration confirmation uses live backend state", () => {
  it("renders fresh profile data rather than a cookie snapshot", async () => {
    mocks.pending.mockResolvedValue({ ...pending, idpNewUser: { profile: { displayName: "Stale Profile" } } });
    const html = await render();
    expect(html).toContain("Live Profile");
    expect(html).toContain("live@example.com");
    expect(html).not.toContain("Stale Profile");
    expect(html).toContain("创建账号并继续");
    expect(html).not.toContain("intent-token");
    expect(mocks.organization).toHaveBeenCalledWith("V2_test");
    expect(mocks.policy).toHaveBeenCalledWith("org-id");
    expect(mocks.retrieve).toHaveBeenCalledWith("intent-id", "intent-token");
  });

  it.each(["disabled provider", "disabled creation", "changed organization", "wrong provider", "expired intent", "legacy cookie"])("does not render an actionable form for %s", async reason => {
    if (reason === "disabled provider") mocks.policy.mockResolvedValue({ identityProviders: [] });
    if (reason === "disabled creation") mocks.policy.mockResolvedValue({ identityProviders: [{ ...provider, creationAllowed: false }] });
    if (reason === "changed organization") mocks.organization.mockResolvedValue("other-org");
    if (reason === "wrong provider") mocks.retrieve.mockResolvedValue({ idpInformation: { idpId: "other-idp" }, addHumanUser: {} });
    if (reason === "expired intent") mocks.retrieve.mockRejectedValue({ code: 9 });
    if (reason === "legacy cookie") mocks.pending.mockResolvedValue({ ...pending, idpId: undefined, idpCreationAllowed: true });
    const html = await render();
    expect(html).not.toContain("创建账号并继续");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Live Profile");
  });

  it("offers login instead of duplicate registration if the account was linked in the meantime", async () => {
    mocks.policy.mockResolvedValue({ identityProviders: [{ ...provider, creationAllowed: false }] });
    mocks.retrieve.mockResolvedValue({ idpInformation: { idpId: "idp" }, userId: "existing-user" });
    const html = await render();
    expect(html).toContain("账号已关联");
    expect(html).toContain("继续登录");
    expect(html).not.toContain("创建账号并继续");
  });

  it.each(["policy", "retrieve"] as const)("does not render a form if %s is unavailable", async operation => {
    mocks[operation].mockRejectedValue({ code: 14 });
    const html = await render();
    expect(html).toContain("请求编号：");
    expect(html).not.toContain("创建账号并继续");
  });

  it("does not read backend data for a different flow state", async () => {
    const html = renderToStaticMarkup(await IdentityProviderConfirmation({ searchParams: Promise.resolve({ state: "different-state" }) }));
    expect(html).not.toContain("创建账号并继续");
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
});
