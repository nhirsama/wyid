import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { ActionResult } from "@/lib/auth";
import { ConfigurationError } from "./config";
import { classifyCallbackError } from "./zitadel/errors";

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = "AuthError"; }
}

export function actionError(error: unknown): Extract<ActionResult, { ok: false }> {
  if (error instanceof AuthError || error instanceof ConfigurationError) return { ok: false, message: error.message };
  if (error instanceof ZodError) return { ok: false, message: "提交的信息不完整或格式有误，请检查后重试。" };
  const requestId = randomUUID();
  const grpcCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const callbackFailure = classifyCallbackError(error);
  // 不记录完整 SDK 错误对象，它可能包含请求、密码、验证码和凭据。
  console.error("[auth] request failed", { requestId, code: typeof grpcCode === "number" ? grpcCode : undefined });
  const message = callbackFailure === "request-handled" ? "此授权请求已处理，请回到应用重新发起登录。"
    : callbackFailure === "request-missing" ? "授权请求已失效，请回到应用重新发起登录。"
    : callbackFailure === "organization-mismatch" ? "当前账号不属于应用要求的组织，请使用正确的账号重新登录。"
    : callbackFailure === "session-invalid" ? "登录会话已失效，请重新登录。"
    : grpcCode === 16 ? "账号、密码或验证码不正确，请检查后重试。"
    : grpcCode === 8 ? "请求过于频繁，请稍后再试。"
    : grpcCode === 7 ? "当前请求未被允许，请确认登录策略或联系管理员。"
    : grpcCode === 9 ? "当前操作的前置条件未满足，请重新发起登录或联系管理员。"
    : "暂时无法完成操作，请稍后重试。";
  return { ok: false, message, requestId };
}
