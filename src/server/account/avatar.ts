import { AVATAR_MAX_BYTES, avatarFileError } from "@/lib/account/avatar";
import { assert, AccountError } from "./errors";

/** Parse a bounded multipart request in memory; ZITADEL stores the image. */
export async function avatarFile(request: Request): Promise<File> {
  const maxBody = 1024 * 1024;
  assert(Number(request.headers.get("content-length") || 0) <= maxBody, 413, "request_too_large", "上传内容过大，请选择不超过 512 KiB 的头像图片。");
  const reader = request.body?.getReader();
  assert(reader, 400, "avatar_required", "请选择头像图片。");
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBody) {
        await reader.cancel();
        throw new AccountError(413, "request_too_large", "上传内容过大，请选择不超过 512 KiB 的头像图片。");
      }
      chunks.push(Uint8Array.from(value).buffer);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try {
    form = await new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
  } catch { throw new AccountError(400, "invalid_upload", "上传内容格式无效，请重新选择头像图片。"); }
  const files = form.getAll("file");
  assert(files.length === 1 && files[0] instanceof File, 400, "avatar_required", "请选择一张头像图片。");
  const file = files[0];
  const error = avatarFileError(file);
  assert(!error, file.size > AVATAR_MAX_BYTES ? 413 : 400, "invalid_avatar", error);
  return file;
}
