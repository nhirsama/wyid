"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

type Phase = "idle" | "checking" | "redirecting";
type AuthActionFlow = {
  phase: Phase;
  begin: () => boolean;
  finish: () => void;
  redirect: () => void;
};

const AuthActionContext = createContext<AuthActionFlow | null>(null);

// This provider lives above the route. Cookie changes in a Server Action can
// refresh/unmount the old form before its promise delivers the redirect URL.
export function AuthActionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const locked = useRef(false);
  const flow: AuthActionFlow = {
    phase,
    begin() {
      if (locked.current) return false;
      locked.current = true;
      setPhase("checking");
      return true;
    },
    finish() { locked.current = false; setPhase("idle"); },
    redirect() { setPhase("redirecting"); },
  };
  return <AuthActionContext.Provider value={flow}>{children}</AuthActionContext.Provider>;
}

export function useAuthActionFlow() { return useContext(AuthActionContext); }
