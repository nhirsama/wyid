import { AuthShell } from "@/components/auth/auth-shell";

export default function Loading() {
  return <AuthShell><section className="auth-card skeleton-card" aria-busy="true" aria-label="正在加载页面"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-description" /><div className="skeleton skeleton-field" /><div className="skeleton skeleton-field" /><div className="skeleton skeleton-button" /></section></AuthShell>;
}
