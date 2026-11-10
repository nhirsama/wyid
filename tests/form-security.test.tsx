import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

vi.mock("@/server/actions", () => ({}));

import { passwordForms } from "./fixtures/password-forms";
import { actionError } from "@/server/errors";

afterEach(() => vi.restoreAllMocks());

describe("credential submission security", () => {
  it.each(passwordForms)("renders $name with POST and submission disabled before hydration", ({ element }) => {
    const html = renderToStaticMarkup(element);
    const forms = [...html.matchAll(/<form\b[^>]*>/g)];
    expect(forms.length).toBeGreaterThan(0);
    for (const [form] of forms) expect(form).toContain('method="post"');
    const buttons = [...html.matchAll(/<button\b[^>]*type="submit"[^>]*>/g)];
    expect(buttons.length).toBeGreaterThan(0);
    for (const [button] of buttons) expect(button).toContain("disabled");
    expect(html).toContain("<noscript>");
  });

  it("requires explicit POST on every client authentication form, including conditional MFA forms", () => {
    const directory = new URL("../src/components/auth/", import.meta.url);
    let forms = 0;
    for (const name of readdirSync(directory).filter(name => name.endsWith(".tsx"))) {
      const file = new URL(name, directory);
      const source = ts.createSourceFile(fileURLToPath(file), readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "form") {
          forms++;
          const method = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "method");
          expect(method?.getText(source), `${name}: native forms must never default to GET`).toBe('method="post"');
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(forms).toBeGreaterThan(0);
  });

  it("does not log passwords or credential-bearing upstream error URLs", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const password = "fixture-password-must-not-be-logged";
    const error = Object.assign(new Error(`https://upstream.example.test/login?password=${password}`), {
      code: 16, request: { password, confirmPassword: password },
    });
    const result = actionError(error);
    expect(result).toMatchObject({ ok: false, requestId: expect.any(String) });
    expect(log).toHaveBeenCalledWith("[auth] request failed", { requestId: result.requestId, code: 16 });
    expect(JSON.stringify([result, log.mock.calls])).not.toContain(password);
  });
});
