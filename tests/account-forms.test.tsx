import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { Submit } from "@/components/account/ui";

describe("account credential form fallback", () => {
  it("disables account submissions until client hydration", () => {
    const html = renderToStaticMarkup(<Submit busy={false}>保存</Submit>);
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(html).toContain("<noscript>");
  });
  it("never defaults account forms to GET, including password, email and factor setup", () => {
    const directory = new URL("../src/components/account/", import.meta.url);
    let forms = 0;
    for (const name of readdirSync(directory).filter(name => name.endsWith(".tsx"))) {
      const source = ts.createSourceFile(name, readFileSync(new URL(name, directory), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "form") {
          forms++;
          const method = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "method");
          expect(method?.getText(source), `${name}: never put credentials in a URL`).toBe('method="post"');
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(forms).toBeGreaterThan(10);
  });
});
