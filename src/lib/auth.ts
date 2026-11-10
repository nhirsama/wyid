import { z } from "zod";

export const loginNameSchema = z.string().trim().min(1, "请输入邮箱或用户名。").max(320, "账号长度不能超过 320 个字符。");
const password = z.string().min(1, "请输入密码。").max(1024, "密码过长，请重新输入。");
const code = z.string().trim().min(1, "请输入验证码。").max(256);
export const factorSchema = z.enum(["totp", "otpEmail", "otpSms", "u2f", "passkey"]);
export type Factor = z.infer<typeof factorSchema>;
export const loginSchema = z.object({ loginName: loginNameSchema, password });
export const registerSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名。").max(100, "用户名不能超过 100 个字符。"),
  email: z.email("请输入有效的邮箱地址。").max(320),
  password, confirmPassword: password,
}).refine(value => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "两次输入的密码不一致。" });
export const forgotPasswordSchema = z.object({ loginName: loginNameSchema });
export const resetPasswordSchema = z.object({ password, confirmPassword: password, code }).refine(
  value => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "两次输入的密码不一致。" },
);
export const verifyEmailSchema = z.object({ code });
export const verifyTotpSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "请输入动态验证码。") });
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type VerifyTotpInput = z.infer<typeof verifyTotpSchema>;

export type PasswordPolicy = { minLength: number; uppercase: boolean; lowercase: boolean; number: boolean; symbol: boolean };
export type LoginPolicy = {
  password: boolean; registration: boolean; passwordReset: boolean; passkey: boolean;
  forceMfa: boolean; forceMfaLocalOnly: boolean; factors: Factor[]; userVerifiedKey: boolean;
  secondFactorLifetimeMs?: number; multiFactorLifetimeMs?: number;
  passwordPolicy: PasswordPolicy; identityProviders: { id: string; name: string; creationAllowed: boolean; autoCreation: boolean }[];
};
export function canRegisterWithPassword(policy: Pick<LoginPolicy, "registration" | "password">) {
  return policy.registration === true && policy.password === true;
}
export type AuthContext = { authRequestId?: string; userId?: string; code?: string; loginHint?: string };
export type ActionResult = { ok: true; message?: string; redirect?: string; form?: { action: string; fields: Record<string, string> } } | { ok: false; message: string; requestId?: string };
export type ChallengeResult = (ActionResult & { options?: Record<string, unknown>; secret?: string; uri?: string });
export type PasskeyChallengeResult = ChallengeResult & { discoverUser?: boolean };

// 保留应用内路径；AppLink 或服务器跳转会按运行时 BASE_PATH 添加前缀。
// 仅转发协议上下文，不允许浏览器指定任意回跳地址或传播验证码。
export function authLink(path: string, context: AuthContext) {
  const query = new URLSearchParams();
  if (context.authRequestId) query.set("authRequest", context.authRequestId);
  return `${path}${query.size ? `?${query}` : ""}`;
}
type SearchParams = Record<string, string | string[] | undefined>;
export function authContext(params: SearchParams): AuthContext {
  const read = (name: string, max = 1024) => typeof params[name] === "string" ? params[name].slice(0, max) : undefined;
  return {
    authRequestId: read("authRequest") || read("authRequestId"), userId: read("userID") || read("userId"),
    code: read("code", 256), loginHint: read("loginHint", 320),
  };
}
export function passwordHint(policy: PasswordPolicy) {
  return [`至少 ${policy.minLength} 个字符`, policy.uppercase && "大写字母", policy.lowercase && "小写字母", policy.number && "数字", policy.symbol && "特殊字符"].filter(Boolean).join(" · ");
}
export function passwordMeetsPolicy(password: string, policy: PasswordPolicy) {
  return [...password].length >= policy.minLength && (!policy.uppercase || /[A-Z]/.test(password)) &&
    (!policy.lowercase || /[a-z]/.test(password)) && (!policy.number || /[0-9]/.test(password)) &&
    (!policy.symbol || /[^a-zA-Z0-9]/.test(password));
}
