import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { normalizeBasePath } from "./src/lib/paths";

export default function nextConfig(phase: string): NextConfig {
  // Trace real paths, not pnpm's symlinks. Include protobuf too: proto's generated
  // modules need runtime entry points that automatic tracing also misses.
  const protoRuntimeFiles = ["@zitadel/proto", "@bufbuild/protobuf"].map(name =>
    `${relative(process.cwd(), realpathSync(`node_modules/${name}`)).replaceAll("\\", "/")}/**/*`,
  );
  return {
    // Keep production artifacts reusable; runtime-start injects the configured
    // path into the standalone server. Dev needs it directly from the env.
    basePath: phase === PHASE_DEVELOPMENT_SERVER ? normalizeBasePath(process.env.BASE_PATH) : "",
    poweredByHeader: false,
    output: "standalone",
    agentRules: false,
    experimental: { useTypeScriptCli: false },
    // ZITADEL SDK 仅在 Node.js 服务端加载，不进入客户端打包图。
    serverExternalPackages: ["@zitadel/client", "@zitadel/proto", "@bufbuild/protobuf"],
    outputFileTracingIncludes: { "/**": protoRuntimeFiles },
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
