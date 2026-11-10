import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { applyRuntimeAssetPrefix, withRuntimeBasePath } from "./runtime-config.mjs";
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/dist/server/lib/start-server"));
const { loadEnvConfig } = nextRequire("@next/env");

// Load local env files first, then validate/canonicalize BASE_PATH before the
// Next server starts. Docker-provided environment values take precedence.
loadEnvConfig(process.cwd());

const rawBasePath = process.env.BASE_PATH?.trim() || "/";
const isRootPath = rawBasePath === "/";
const basePath = isRootPath ? "" : rawBasePath.replace(/\/+$/, "");
if (!isRootPath && (!basePath || !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(basePath) || basePath.split("/").some(segment => segment === "." || segment === ".."))) {
  console.error("BASE_PATH 必须为 / 或以 / 开头的 URL 安全路径，不能包含空路径段、.、..、查询参数或片段。");
  process.exit(1);
}
process.env.BASE_PATH = basePath || "/";

const requiredFiles = JSON.parse(readFileSync(resolve(process.cwd(), ".next/required-server-files.json"), "utf8"));
const nextConfig = withRuntimeBasePath(requiredFiles.config, basePath);
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);
// React emits module-preload script tags from these manifests independently
// of Next's HTML assetPrefix, so both must agree before any route is loaded.
applyRuntimeAssetPrefix(resolve(process.cwd(), ".next/server/app"), basePath);

const { startServer } = nextRequire("next/dist/server/lib/start-server");
const port = Number.parseInt(process.env.PORT || "3000", 10);
const keepAliveTimeout = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT || "", 10);
startServer({
  dir: process.cwd(),
  isDev: false,
  config: nextConfig,
  hostname: process.env.HOSTNAME || "0.0.0.0",
  port: Number.isFinite(port) ? port : 3000,
  allowRetry: false,
  keepAliveTimeout: Number.isFinite(keepAliveTimeout) && keepAliveTimeout >= 0 ? keepAliveTimeout : undefined,
}).catch(error => {
  console.error("无法启动 Next.js 服务：", error);
  process.exit(1);
});
