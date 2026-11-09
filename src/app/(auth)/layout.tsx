import { AuthShell } from "@/components/auth/auth-shell";
import { AuthPanel } from "@/components/auth/auth-shell";
import { Notice } from "@/components/ui/form";
import { ConfigurationError, getConfig } from "@/server/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  let configurationMessage: string | undefined;
  try {
    getConfig();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    configurationMessage = error.message;
  }
  if (configurationMessage) return <AuthShell><AuthPanel title="服务配置不完整" description="请设置以下服务端环境变量后刷新页面。"><Notice kind="error">{configurationMessage}</Notice></AuthPanel></AuthShell>;
  return <AuthShell>{children}</AuthShell>;
}
