import { z } from "zod";
import { AccountError } from "./errors";

// Validate raw text BEFORE URL parsing: WHATWG URL parsing strips newlines.
const url = z.string().max(2048).refine(value => !/[\\\u0000-\u0020\u007f]/.test(value), "网址不能包含空白或控制字符。").pipe(z.url("请输入完整的网址。").refine(value => {
  const parsed = new URL(value);
  return !/[\u0000-\u0020\u007f]/.test(value) && (parsed.protocol === "https:" || parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) && !parsed.username && !parsed.password && !parsed.hash;
}, "请输入 HTTPS 地址，本地开发可使用 HTTP 环回地址；地址应保留完整路径。"));
export const applicationSchema = z.object({
  name: z.string().trim().min(1, "请输入应用名称。").max(200, "应用名称最多 200 个字符。"),
  website: url.transform(value => new URL(value).origin),
  type: z.enum(["spa", "web"]),
  redirectUris: z.array(url).max(50).min(1, "请添加登录回调地址。"),
  postLogoutRedirectUris: z.array(url).max(50),
}).strict();
const nickname = z.string().trim().min(1, "请输入昵称。").max(200, "昵称最多 200 个字符。");
export const profileSchema = z.object({ displayName: nickname, preferredLanguage: z.string().min(2).max(35) }).strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input, {
    error: issue => issue.code === "invalid_format" && issue.format === "email" ? "请输入有效的邮箱地址。" : "请检查输入内容并填写完整信息。",
  });
  if (!result.success) {
    throw new AccountError(400, "invalid_input", result.error.issues[0]?.message || "请检查输入内容。");
  }
  return result.data;
}
export function distinctUris(values: string[]) { return [...new Set(values.map(v => v.trim()))]; }
