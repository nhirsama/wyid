export type SiteBrand = { nickname: string; icon?: string };
// The server supplies SITE_NICKNAME; do not substitute a hard-coded brand.
export const defaultBrand: SiteBrand = { nickname: "" };

export function resolveBrand(input: Partial<SiteBrand>): SiteBrand {
  const nickname = input.nickname?.trim() || defaultBrand.nickname;
  const icon = input.icon?.trim() || undefined;
  if (icon) {
    const local = icon.startsWith("/") && !icon.startsWith("//");
    let remote = false;
    try { const url = new URL(icon); remote = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { /* local public asset */ }
    if ((!local && !remote) || /[\\\u0000-\u0020]/.test(icon)) throw new Error("SITE_ICON 必须是本站资源路径或 HTTP(S) 图片地址。");
  }
  return { nickname, icon };
}
