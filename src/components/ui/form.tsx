"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ComponentProps, type ReactNode } from "react";
import { CheckCircle, Eye, EyeSlash, Info, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { UseFormRegisterReturn } from "react-hook-form";
import type { ActionResult } from "@/lib/auth";
import { withBasePath } from "@/lib/paths";
import { useBasePath } from "@/components/auth/brand-provider";
import { useAuthActionFlow } from "@/components/auth/auth-action-provider";

type FieldProps = {
  label: string;
  error?: string;
  hint?: string;
  registration: UseFormRegisterReturn;
} & Omit<ComponentProps<"input">, "name" | "onChange" | "onBlur" | "ref">;

export function Field({ label, error, hint, registration, type = "text", ...props }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={isPassword ? "password-input" : "input-wrap"}>
        <input {...props} {...registration} id={id} type={isPassword && visible ? "text" : type}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} />
        {isPassword && <button className="icon-button password-toggle" type="button"
          aria-label={visible ? `隐藏${label}` : `显示${label}`} aria-pressed={visible} aria-controls={id}
          onClick={() => setVisible(value => !value)}>{visible ? <EyeSlash size={18} /> : <Eye size={18} />}</button>}
      </div>
      {error ? <small className="field-error" id={`${id}-error`} role="alert">{error}</small>
        : hint ? <small className="field-hint" id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}

const subscribeToHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

export function Submit({ pending, children, ...props }: ComponentProps<"button"> & { pending: boolean; children: ReactNode }) {
  // These forms depend on client handlers. Do not allow native submission before
  // hydration (or if a client chunk fails to load); explicit POST is the fallback.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  return <>
    <button {...props} type="submit" className="button primary-button wide" disabled={!hydrated || pending || props.disabled} aria-busy={pending}>
      {pending && <SpinnerGap size={18} className="spin" aria-hidden="true" />}{pending ? "正在处理…" : children}
    </button>
    <noscript><p className="field-error" role="alert">请启用 JavaScript 并重新加载页面后再提交。</p></noscript>
  </>;
}

export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "error" | "success" }) {
  const Icon = kind === "error" ? WarningCircle : kind === "success" ? CheckCircle : Info;
  return <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
    <Icon size={18} aria-hidden="true" /><div>{children}</div>
  </div>;
}

export function Feedback({ result }: { result: ActionResult | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (result && !result.ok) ref.current?.focus(); }, [result]);
  if (!result) return null;
  if (result.ok && !result.message) return null;
  return <div ref={ref} tabIndex={-1} className="form-feedback"><Notice kind={result.ok ? "success" : "error"}>
    {result.message}{!result.ok && result.requestId && <small className="request-id">请求编号：{result.requestId}</small>}
  </Notice></div>;
}

export function useAuthAction() {
  const basePath = useBasePath();
  const flow = useAuthActionFlow();
  const [transitionPending, startTransition] = useTransition();
  const [navigating, setNavigating] = useState(false);
  const locked = useRef(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  function run(task: () => Promise<ActionResult>) {
    // React's pending render is asynchronous; lock synchronously so repeated
    // submits cannot race a successful callback with a second, failed request.
    if (locked.current || (flow && !flow.begin())) return;
    locked.current = true;
    setResult(null);
    startTransition(async () => {
      try {
        const next = await task();
        if (next.ok && next.redirect) {
          setNavigating(true);
          flow?.redirect();
          window.location.assign(withBasePath(next.redirect, basePath));
          // Keep the guard and the submitted form pending until navigation.
          return;
        }
        setResult(next);
      } catch {
        setNavigating(false);
        setResult({ ok: false, message: "暂时无法确认操作结果，请检查网络后重试。" });
      }
      locked.current = false;
      flow?.finish();
    });
  }
  return { pending: transitionPending || navigating || !!flow && flow.phase !== "idle", result, run };
}
