import Link from "next/link";
import { AuthPanel, AuthShell } from "@/components/auth/auth-shell";

export default function NotFound() {
  return <AuthShell><AuthPanel title="好像走错地方了" description="这个页面不存在，或已经搬到了别处。">
    <p className="error-code">404 / PAGE NOT FOUND</p><Link className="button primary-button wide" href="/login">回到登录页</Link>
  </AuthPanel></AuthShell>;
}
