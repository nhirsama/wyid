import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { ActionResult } from "@/lib/auth";
import { ConfigurationError } from "./config";

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = "AuthError"; }
}

export function actionError(error: unknown): Extract<ActionResult, { ok: false }> {
  if (error instanceof AuthError || error instanceof ConfigurationError) return { ok: false, message: error.message };
  if (error instanceof ZodError) return { ok: false, message: "提交的信息不完整或格式有误，请检查后重试。" };
  const requestId = randomUUID();
  const grpcCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  // 不记录完整 SDK 错误对象，它可能包含请求、密码、验证码和凭据。
  console.error("[auth] request failed", { requestId, code: typeof grpcCode === "number" ? grpcCode : undefined });
  const message = grpcCode === 16 ? "账号、密码或验证码不正确，请检查后重试。"
    : grpcCode === 8 ? "请求过于频繁，请稍后再试。"
    : grpcCode === 7 ? "当前请求未被允许，请确认登录策略或联系管理员。"
    : grpcCode === 9 ? "还需要完成额外的身份验证，请按账号策略继续操作。"
    : "暂时无法完成操作，请稍后重试。";
  return { ok: false, message, requestId };
}
