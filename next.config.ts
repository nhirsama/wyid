import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { normalizeBasePath } from "./src/lib/paths";

export default function nextConfig(phase: string): NextConfig {
  return {
    // Development uses the runtime path directly. Production builds stay at
    // root; runtime-start.mjs injects BASE_PATH into the standalone server config.
    basePath: phase === PHASE_DEVELOPMENT_SERVER ? normalizeBasePath(process.env.BASE_PATH) : "",
    poweredByHeader: false,
    output: "standalone",
    agentRules: false,
    experimental: { useTypeScriptCli: false },
    // ZITADEL SDK 仅在 Node.js 服务端加载，不进入客户端打包图。
    serverExternalPackages: ["@zitadel/client", "@zitadel/proto", "@bufbuild/protobuf"],
    async headers() {
      return [{
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cache-Control", value: "no-store" },
        ],
      }];
    },
  };
}
