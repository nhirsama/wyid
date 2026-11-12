import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/server/actions", () => ({ decideConsent: vi.fn() }));
import { ConsentForm } from "@/components/auth/consent-form";
import styles from "@/components/auth/consent.module.css";

describe("reference consent presentation", () => {
  it("preserves the reference copy, account avatar, scopes and compact right-aligned actions", () => {
    const html = renderToStaticMarkup(<ConsentForm authRequestId="V2_test" consentToken="token" appName="Management Console"
      displayName="测试账号" email="user@example.test" scopes={["openid", "profile", "email"]} />);
    expect(html).toContain('<strong>Management Console</strong> 申请访问以下账号信息和权限，是否允许？');
    expect(html).toContain(`class="${styles.avatar}"`);
    expect(html).not.toContain("consent-avatar");
    expect(html).toContain("测试账号");
    expect(html).toContain("user@example.test");
    expect(html.match(/<li>/g)).toHaveLength(3);
    for (const scope of ["openid", "profile", "email"]) expect(html).toContain(`<code>${scope}</code>`);
    expect(html).toContain(`class="${styles.smallButton}">取消</button>`);
    expect(html).toContain('aria-busy="false">允许</button>');
    expect(html).not.toContain("允许并继续");
    expect(html).not.toContain("请确认这是你要登录的网站");
    expect(html).not.toContain("app-host");
    expect(html).toContain('method="post"');
  });

  it("hides project role entries entirely, not just their descriptions", () => {
    const memberScope = "urn:zitadel:iam:org:project:role:member";
    const adminScope = "urn:zitadel:iam:org:project:role:admin";
    const html = renderToStaticMarkup(<ConsentForm authRequestId="V2_test" consentToken="token" appName="Test App"
      displayName="测试账号" email="user@example.test" scopes={["openid", memberScope, "email", adminScope, memberScope]} />);
    expect(html).not.toContain(memberScope);
    expect(html).not.toContain(adminScope);
    expect(html).not.toContain("其他请求权限");
    expect(html).not.toContain("此网站请求的额外权限。");
    expect(html).toContain("<strong>账号标识</strong>：用于在该网站识别你的账号。 <code>openid</code>");
    expect(html).toContain("<strong>邮箱</strong>：邮箱地址及邮箱验证状态。 <code>email</code>");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it("keeps descriptions for unknown scopes, including similarly named scopes", () => {
    const scopes = ["custom:read", "urn:zitadel:iam:org:project:roles", "urn:zitadel:iam:org:project:roles:read"];
    const html = renderToStaticMarkup(<ConsentForm authRequestId="V2_test" consentToken="token" appName="Test App"
      displayName="测试账号" email="user@example.test" scopes={scopes} />);
    for (const scope of scopes) {
      expect(html).toContain(`<strong>其他请求权限</strong>：此网站请求的额外权限。 <code>${scope}</code>`);
    }
    expect(html.match(/<li>/g)).toHaveLength(scopes.length);
  });
});
