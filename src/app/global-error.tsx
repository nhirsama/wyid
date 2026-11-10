"use client";

import { useEffect, useState } from "react";
import { nextAssetPublicPath } from "@/lib/client-assets";

function loginHref() {
  if (typeof document === "undefined") return "/login";
  for (const script of Array.from(document.scripts)) {
    if (!script.src) continue;
    const publicPath = nextAssetPublicPath(script.src, document.baseURI);
    if (publicPath) return new URL("../login", publicPath).pathname;
  }
  return "/login";
}

// Do not reuse the root layout, brand provider, icons, or external styles here:
// this boundary must still work when any of those failed to load.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [href] = useState(loginHref);
  useEffect(() => { console.error("[login] page render failed", error); }, [error]);
  return <html lang="zh-CN"><body style={{ margin: 0, background: "#f6f5f1", color: "#252525", fontFamily: "system-ui, sans-serif" }}>
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: "24px", boxSizing: "border-box" }}>
      <section style={{ width: "100%", maxWidth: "360px" }}>
        <h1 style={{ fontSize: "24px" }}>页面加载失败</h1>
        <p>请重新加载，或重新打开登录页。</p>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 20px", cursor: "pointer" }}>重新加载</button>
          <a href={href} style={{ color: "inherit" }}>打开登录页</a>
        </div>
      </section>
    </main>
  </body></html>;
}
