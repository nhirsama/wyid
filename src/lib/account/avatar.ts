// ZITADEL's native avatar uploader accepts image/* up to 512 KiB.
export const AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_HINT = "选择图片作为头像，文件大小不超过 512 KiB。";

export function avatarFileError(file: Pick<Blob, "size" | "type">) {
  if (!file.size) return "请选择有内容的头像图片。";
  if (file.size > AVATAR_MAX_BYTES) return "头像图片不能超过 512 KiB，请选择较小的图片。";
  if (file.type && !file.type.startsWith("image/")) return "请选择图片文件作为头像。";
  return "";
}

export function avatarSource(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
