"use client";

import { useEffect, useId, useRef, useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { CheckCircle, Eye, EyeSlash, Info, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import type { UseFormRegisterReturn } from "react-hook-form";
import type { ActionResult } from "@/lib/auth";
import { withBasePath } from "@/lib/paths";
import { useBasePath } from "@/components/auth/brand-provider";

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

export function Submit({ pending, children, ...props }: ComponentProps<"button"> & { pending: boolean; children: ReactNode }) {
  return <button {...props} type="submit" className="button primary-button wide" disabled={pending || props.disabled} aria-busy={pending}>
    {pending && <SpinnerGap size={18} className="spin" aria-hidden="true" />}{pending ? "正在处理…" : children}
  </button>;
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
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  function run(task: () => Promise<ActionResult>) {
    setResult(null);
    startTransition(async () => {
      try {
        const next = await task();
        if (next.ok && next.redirect) window.location.assign(withBasePath(next.redirect, basePath));
        else setResult(next);
      } catch {
        setResult({ ok: false, message: "连接中断，请检查网络后重试。" });
      }
    });
  }
  return { pending, result, run };
}
