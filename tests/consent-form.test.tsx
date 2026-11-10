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
});
