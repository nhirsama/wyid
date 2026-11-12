"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { useBrand } from "./brand-provider";
import { useAuthActionFlow } from "./auth-action-provider";

export function AuthShell({ children }: { children: ReactNode }) {
  const brand = useBrand();
  return (
    <main className="auth-page" id="main-content">
      <div className="auth-container">
        <div className="auth-brand">
          {brand.icon && <Image src={brand.icon} alt="" width={36} height={40} priority unoptimized />}
          <span>{brand.nickname}</span>
        </div>
        {children}
      </div>
    </main>
  );
}

type AuthPanelProps = {
  title: string;
  description: ReactNode;
  children: ReactNode;
  reference?: boolean;
  className?: string;
};

export function AuthPanel(props: AuthPanelProps) {
  const flow = useAuthActionFlow();
  const busy = !!flow && flow.phase !== "idle";
  const [idleProps, setIdleProps] = useState(props);
  // Cookie-triggered refreshes must not replace the submitted form with a
  // stale failure page before the action has returned its actual result.
  if (!busy && idleProps !== props) setIdleProps(props);
  const { title, description, children, reference = false, className } = busy ? idleProps : props;
  return <section className={["auth-card", reference && "reference-auth-card", className].filter(Boolean).join(" ")} aria-labelledby="auth-title" aria-busy={busy}>
    <div className="auth-panel-content">
    <header className="auth-heading"><h1 id="auth-title">{title}</h1><p>{description}</p></header>
    {children}
    </div>
  </section>;
}
