import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RootLayout from "@/app/layout";

afterEach(() => vi.unstubAllEnvs());

describe("font loading", () => {
  it.each(["/", "/123/"])("loads both fonts directly from the CDN with BASE_PATH=%s", basePath => {
    vi.stubEnv("BASE_PATH", basePath);
    vi.stubEnv("SITE_NICKNAME", "WY ID");
    vi.stubEnv("SITE_ICON", "");
    const html = renderToStaticMarkup(<RootLayout>content</RootLayout>);
    expect(html).toContain('rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin="anonymous"');
    expect(html).toContain('rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css"');
    expect(html).toContain('rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.2.8/latin-400.css"');
    expect(html).not.toContain("jetbrains-mono-latin.woff2");
    expect(html).not.toContain("/123/https:");
  });
});
