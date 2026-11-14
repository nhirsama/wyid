export function isAccountRoute(route: string) {
  return ["/apps", "/apps/new", "/settings/profile", "/settings/security", "/settings/devices", "/help", "/about"].includes(route) || /^\/apps\/[\w-]{1,200}:[\w-]{1,200}$/.test(route);
}

/** Resolve only portal pages; authentication and unknown URLs stay server-owned. */
export function accountRoute(pathname: string, basePath = ""): string | null {
  const prefix = `${basePath}/account/`;
  if (!pathname.startsWith(prefix)) return null;
  try {
    const route = `/${decodeAccountSegments(pathname.slice(prefix.length).split("/")).join("/")}`;
    return isAccountRoute(route) ? route : null;
  } catch { return null; }
}

/** Next's catch-all parameters may retain percent-encoded reserved characters. */
export function decodeAccountSegments(path: string[]) {
  return path.map(segment => {
    const value = decodeURIComponent(segment);
    if (!value || value.length > 2048 || value === "." || value === ".." || /[\/\\\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid account route");
    return value;
  });
}
