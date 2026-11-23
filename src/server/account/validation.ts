import { z } from "zod";
import { validateApplicationUrl, validateUriList } from "@/lib/account/application-validation";
import { usernameSchema } from "@/lib/auth";
import { AccountError } from "./errors";

export const applicationSchema = z.object({
  name: z.string().trim().min(1, "请输入应用名称。").max(200, "应用名称最多 200 个字符。"),
  website: z.string(),
  type: z.enum(["spa", "web"]),
  devMode: z.boolean().default(false),
  redirectUris: z.array(z.string()).max(50, "登录回调地址最多 50 条。").min(1, "请至少添加一条登录回调地址。"),
  postLogoutRedirectUris: z.array(z.string()).max(50, "退出后返回地址最多 50 条。"),
}).strict().superRefine((data, ctx) => {
  const websiteError = validateApplicationUrl(data.website, { devMode: data.devMode, originOnly: true });
  if (websiteError) {
    ctx.addIssue({ code: "custom", path: ["website"], message: websiteError });
  }
  const redirects = validateUriList(data.redirectUris, { devMode: data.devMode, required: true, label: "登录回调地址" });
  if (redirects.listError) {
    ctx.addIssue({ code: "custom", path: ["redirectUris"], message: redirects.listError });
  }
  redirects.items.forEach((error, index) => {
    if (error) ctx.addIssue({ code: "custom", path: ["redirectUris", index], message: error });
  });
  const postLogouts = validateUriList(data.postLogoutRedirectUris, { devMode: data.devMode, label: "退出后返回地址" });
  if (postLogouts.listError) {
    ctx.addIssue({ code: "custom", path: ["postLogoutRedirectUris"], message: postLogouts.listError });
  }
  postLogouts.items.forEach((error, index) => {
    if (error) ctx.addIssue({ code: "custom", path: ["postLogoutRedirectUris", index], message: error });
  });
}).transform(data => ({
  ...data,
  website: new URL(data.website).origin,
}));
const nickname = z.string().trim().min(1, "请输入昵称。").max(200, "昵称最多 200 个字符。");
export const profileSchema = z.object({ displayName: nickname, preferredLanguage: z.string().min(2).max(35) }).strict();
export const usernameUpdateSchema = z.object({ username: usernameSchema }).strict();
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
