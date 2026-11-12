import type { Application } from "./types";

export function reactExample(app: Pick<Application, "clientId" | "redirectUris" | "postLogoutRedirectUris">, issuer: string) {
  const values = [issuer, app.clientId, app.redirectUris[0] || "https://your-site.example/auth/callback", app.postLogoutRedirectUris[0] || "https://your-site.example"].map(v => JSON.stringify(v));
  return `import { AuthProvider, useAuth } from '@zitadel/react-auth';\n\nfunction LoginButton() {\n  const auth = useAuth();\n  if (auth.isLoading) return <span>正在读取登录状态…</span>;\n  if (auth.error) return <p>{auth.error.message}</p>;\n  if (auth.isAuthenticated) {\n    return <button onClick={() => void auth.signoutRedirect()}>退出登录</button>;\n  }\n  return <button onClick={() => void auth.signinRedirect()}>登录</button>;\n}\n\nexport default function App() {\n  return (\n    <AuthProvider\n      authority={${values[0]}}\n      client_id={${values[1]}}\n      redirect_uri={${values[2]}}\n      post_logout_redirect_uri={${values[3]}}\n      scope="openid profile email"\n      automaticSilentRenew={false}\n      onSigninCallback={() => {\n        window.history.replaceState({}, '', window.location.pathname);\n      }}\n    >\n      <LoginButton />\n    </AuthProvider>\n  );\n}`;
}
export function serverExample(app: Pick<Application, "clientId" | "redirectUris">, issuer: string) {
  return `# 配置在你的网站服务端\nOIDC_ISSUER=${JSON.stringify(issuer)}\nOIDC_CLIENT_ID=${JSON.stringify(app.clientId)}\nOIDC_CLIENT_SECRET="创建应用时取得的密钥"\nOIDC_REDIRECT_URI=${JSON.stringify(app.redirectUris[0] || "")}\n\n# 使用标准 OIDC 库完成：\n# 1. Discovery、state、nonce 与 PKCE\n# 2. 跳转 authorization_endpoint\n# 3. 回调校验与 code exchange\n# 4. 验证 ID token 并建立网站自己的会话`;
}
