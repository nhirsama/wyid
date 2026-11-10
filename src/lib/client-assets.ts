/** Infer the deployment prefix from a script URL, not the build-time BASE_PATH. */
export function nextAssetPublicPath(scriptSource: string, documentUrl: string) {
  const url = new URL(scriptSource, documentUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const index = url.pathname.lastIndexOf("/_next/");
  if (index < 0) return undefined;
  return `${url.origin}${url.pathname.slice(0, index)}/_next/`;
}
