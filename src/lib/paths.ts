/** Next.js uses an empty string for the site root. BASE_PATH accepts / as well. */
export function normalizeBasePath(value?: string) {
  const path = value?.trim() || "/";
  if (path === "/") return "";
  const normalized = path.replace(/\/+$/, "");
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(normalized) ||
    normalized.split("/").some(segment => segment === "." || segment === "..")) {
    throw new Error("BASE_PATH 必须为 / 或以 / 开头的 URL 安全路径，不能包含空路径段、.、..、查询参数或片段。");
  }
  return normalized;
}

/** Read once from the server process environment when the app starts. */
export function runtimeBasePath() {
  return normalizeBasePath(process.env.BASE_PATH);
}

/** Prefix app-owned browser/server URLs. External identity-provider redirects remain unchanged. */
export function withBasePath(path: string, basePath = runtimeBasePath()) {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${basePath}${path}`;
}

export function siteUrl(path: string, origin: string) {
  return new URL(withBasePath(path), origin);
}
