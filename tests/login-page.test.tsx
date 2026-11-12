import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "@bufbuild/protobuf";
import { AuthRequestSchema, ErrorReason, Prompt } from "@zitadel/proto/zitadel/oidc/v2/authorization_pb.js";
import type { AuthContext } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ request: vi.fn(), organization: vi.fn(), policy: vi.fn(), applicationName: vi.fn(), deny: vi.fn(), form: vi.fn(), session: vi.fn(), resume: vi.fn() }));
vi.mock("@/server/session", () => ({ readAuthenticatedSession: mocks.session }));
vi.mock("@/components/auth/resume-login-form", () => ({ ResumeLoginForm: (props: { context: AuthContext }) => {
  mocks.resume(props);
  return <div>resume-login</div>;
} }));
vi.mock("@/server/zitadel/service", () => ({ zitadel: {
  authRequest: mocks.request, organizationForAuth: mocks.organization, policy: mocks.policy,
  applicationName: mocks.applicationName, deny: mocks.deny,
} }));
vi.mock("@/server/brand", () => ({ getBrand: () => ({ nickname: "WY ID" }) }));
vi.mock("@/components/auth/forms", () => ({ LoginForm: (props: { context: AuthContext }) => {
  mocks.form(props);
  return <div>login-form</div>;
} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); } }));
import LoginPage from "@/app/(auth)/login/page";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.organization.mockResolvedValue("org-id");
  mocks.policy.mockResolvedValue({ password: true });
  mocks.applicationName.mockResolvedValue("Management Console");
  mocks.request.mockResolvedValue(create(AuthRequestSchema, {
    id: "V2_test", clientId: "console-client", redirectUri: "https://auth.wyyy.org/callback", loginHint: "user@example.com",
  }));
});

describe("login presentation is independent of the authorization entry point", () => {
  it.each([{}, { authRequest: "V2_test" }, { authRequestId: "V2_test" }])("keeps the same heading and description for %j", async params => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));
    expect(html).toContain("登录账号");
    expect(html).not.toContain("登录 WY ID");
    expect(html).toContain("一个账号，连接你的网站。");
    expect(html).toContain("login-form");
    expect(html).not.toContain("Management Console");
    expect(html).not.toContain("auth.wyyy.org");
    expect(html).not.toContain("继续登录");
    expect(mocks.applicationName).not.toHaveBeenCalled();
    expect(mocks.policy).toHaveBeenCalledWith("org-id");
    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ authRequestId: params.authRequest || params.authRequestId }) }));
  });

  it("still carries the upstream login hint into the form", async () => {
    const page = await LoginPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) });
    renderToStaticMarkup(page);
    expect(mocks.form).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ authRequestId: "V2_test", loginHint: "user@example.com" }) }));
  });

  it("still rejects interactive login for prompt=none", async () => {
    mocks.request.mockResolvedValue(create(AuthRequestSchema, { id: "V2_test", prompt: [Prompt.NONE] }));
    mocks.deny.mockResolvedValue("https://auth.wyyy.org/callback?error=login_required");
    await expect(LoginPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) })).rejects.toThrow("NEXT_REDIRECT:");
    expect(mocks.deny).toHaveBeenCalledWith("V2_test", ErrorReason.LOGIN_REQUIRED);
    expect(mocks.policy).not.toHaveBeenCalled();
  });

  it.each([{}, { authRequest: "V2_test" }])("continues an existing login through POST without exposing credentials for %j", async params => {
    mocks.session.mockResolvedValue({ sessionId: "secret-id", sessionToken: "secret-token", userId: "user-id" });
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));
    expect(html).toContain("resume-login");
    expect(html).not.toContain("login-form");
    expect(html).not.toContain("secret-token");
    expect(mocks.resume).toHaveBeenCalledWith({ context: expect.objectContaining({ authRequestId: params.authRequest }) });
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.deny).not.toHaveBeenCalled();
  });

  it("does not immediately reject prompt=none when an existing session can be checked", async () => {
    mocks.session.mockResolvedValue({ sessionId: "secret-id", sessionToken: "secret-token", userId: "user-id" });
    mocks.request.mockResolvedValue(create(AuthRequestSchema, { id: "V2_test", prompt: [Prompt.NONE] }));
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) }));
    expect(html).toContain("resume-login");
    expect(mocks.deny).not.toHaveBeenCalled();
  });

  it.each([
    { prompt: [Prompt.LOGIN] }, { prompt: [Prompt.SELECT_ACCOUNT] }, { prompt: [Prompt.CREATE] }, { maxAge: { seconds: 0n } },
  ])("keeps interactive login when requested by ZITADEL (case %#)", async overrides => {
    mocks.session.mockResolvedValue({ sessionId: "secret-id", sessionToken: "secret-token", userId: "user-id" });
    mocks.request.mockResolvedValue(create(AuthRequestSchema, { id: "V2_test", ...overrides }));
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ authRequest: "V2_test" }) }));
    expect(html).toContain("login-form");
    expect(html).not.toContain("resume-login");
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
