import type { NextConfig } from "next";
import { normalizeBasePath } from "./src/lib/paths";

const basePath = normalizeBasePath(process.env.BASE_PATH);

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
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

export default nextConfig;
