import type { FactorType } from "./types";

export const methodReady = (state: string) => state === "READY";
export const factorNames: Record<FactorType, string> = {
  totp: "验证器 TOTP", passkey: "通行密钥 Passkey", webauthn: "安全密钥",
  "otp-email": "邮箱验证码", "otp-sms": "短信验证码",
};
