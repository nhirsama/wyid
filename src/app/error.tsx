"use client";

import Link from "next/link";
import { AuthPanel, AuthShell } from "@/components/auth/auth-shell";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const configurationMessage = error.name === "ConfigurationError" && error.message.startsWith("缺少或无效的服务端配置：") ? error.message : undefined;
  return <AuthShell><AuthPanel title={configurationMessage ? "服务配置不完整" : "稍等，遇到一点小问题"} description={configurationMessage || "页面暂时无法加载，尝试重新打开吧。"}>
    <div className="result-stack"><button className="button primary-button wide" onClick={reset}>重新加载</button><Link className="text-link centered" href="/login">返回登录</Link></div>
  </AuthPanel></AuthShell>;
}
