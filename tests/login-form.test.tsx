import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LoginPolicy } from "@/lib/auth";

vi.mock("@/server/actions", () => ({}));
import { LoginForm } from "@/components/auth/forms";

const policy: LoginPolicy = {
  password: true, registration: false, passwordReset: true, passkey: true, forceMfa: false, forceMfaLocalOnly: false,
  factors: [], userVerifiedKey: false, identityProviders: [],
  passwordPolicy: { minLength: 8, uppercase: false, lowercase: false, number: false, symbol: false },
};

describe("existing login page presentation", () => {
  it("keeps username/password first and passkey below the original divider", () => {
    const html = renderToStaticMarkup(<LoginForm context={{}} policy={policy} />);
    expect(html.indexOf('name="loginName"')).toBeLessThan(html.indexOf('name="password"'));
    expect(html.indexOf('name="password"')).toBeLessThan(html.indexOf("其他登录方式"));
    expect(html.indexOf("其他登录方式")).toBeLessThan(html.indexOf("使用通行密钥登录"));
    expect(html).not.toContain("无需输入用户名");
    expect(html).not.toContain("选择其他通行密钥账号");
    expect(html).not.toContain("或使用密码登录");
    expect(html).not.toContain("继续使用通行密钥");
    expect(html).not.toContain("验证请求已准备好");
    expect(html).not.toContain("输入你的邮箱或用户名");
    expect(html).not.toContain("输入你的密码");
  });

  it("keeps the original account field and passkey button without a password when password login is disabled", () => {
    const html = renderToStaticMarkup(<LoginForm context={{}} policy={{ ...policy, password: false }} />);
    expect(html).toContain("使用通行密钥登录");
    expect(html).toContain('name="loginName"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("或使用密码登录");
  });

  it("preserves username/password login when passkeys are disabled", () => {
    const html = renderToStaticMarkup(<LoginForm context={{ loginHint: "user@example.com" }} policy={{ ...policy, passkey: false }} />);
    expect(html).toContain('name="loginName"');
    expect(html).toContain('name="password"');
    expect(html).toContain('method="post"');
    expect(html).not.toContain("使用通行密钥登录");
  });
});
