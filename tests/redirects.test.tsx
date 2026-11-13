import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";

const mocks = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@/server/account/identity", () => ({ accountIdentity: mocks.identity, accountConfig: vi.fn(), accountProfile: vi.fn() }));
import { redirectToApp } from "@/server/redirect";
import Home from "@/app/page";
import AccountPortalPage from "@/app/(portal)/account/[...path]/page";
import { AccountError } from "@/server/account/errors";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_URL", "https://login.example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("runtime-aware server redirects", () => {
  it.each(["/", "/123/", "/account/login-ui", "/custom-login"])('uses the runtime prefix exactly once for BASE_PATH="%s"', async basePath => {
    vi.stubEnv("BASE_PATH", basePath);
    const normalized = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
    const prefix = normalized ? `https://login.example.com${normalized}` : "";
    for (const path of ["/login", "/account", "/account/apps", "/verify?authRequest=V2_test#form"]) {
      expect(() => redirectToApp(path)).toThrow(`NEXT_REDIRECT:${prefix}${path}`);
    }
    await expect(Home({ searchParams: Promise.resolve({ authRequest: "V2_a&b" }) })).rejects.toThrow(`NEXT_REDIRECT:${prefix}/login?authRequest=V2_a%26b`);
    const params = Promise.resolve({ path: ["settings", "profile"] });
    for (const [code, status, target] of [["authentication_required", 401, "/login"], ["authentication_incomplete", 403, "/account"]] as const) {
      mocks.identity.mockRejectedValueOnce(new AccountError(status, code, "重新验证"));
      await expect(AccountPortalPage({ params })).rejects.toThrow(`NEXT_REDIRECT:${prefix}${target}`);
    }
  });

  it("changes prefixes at runtime without a module reset or rebuild", () => {
    for (const basePath of ["/first", "/second/login", "/"]) {
      vi.stubEnv("BASE_PATH", basePath);
      const expected = basePath === "/" ? "/account/apps" : `https://login.example.com${basePath}/account/apps`;
      expect(() => redirectToApp("/account/apps")).toThrow(`NEXT_REDIRECT:${expected}`);
    }
  });

  it("does not prefix external authorization callbacks", () => {
    vi.stubEnv("BASE_PATH", "/custom-login");
    const target = "https://site.example.com/callback?code=test&state=state";
    expect(() => redirectToApp(target)).toThrow(`NEXT_REDIRECT:${target}`);
  });

  it("keeps app-owned page and action redirects behind the shared path resolver", () => {
    for (const file of ["src/app/page.tsx", "src/app/(auth)/account/page.tsx", "src/app/(auth)/consent/page.tsx", "src/app/(portal)/account/[...path]/page.tsx", "src/server/actions.ts"]) {
      const content = readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      expect(content, file).toContain("redirectToApp");
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "redirect") {
          // The only remaining raw Next redirect in these files returns the
          // authorization callback supplied by the identity provider.
          expect(node.arguments[0]?.getText(source), file).toBe("await zitadel.deny(request.id, ErrorReason.CONSENT_REQUIRED)");
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });
});
