"use client";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Eye, EyeSlash, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";
import { AccountLink as Link } from "./navigation";
import { ApiError } from "@/lib/account/api";

export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "error" | "success" }) {
  return <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>{kind === "error" && <WarningCircle size={18} />}<div>{children}</div></div>;
}
export function Loading({ text = "正在读取…" }: { text?: string }) {
  return <div className="loading" role="status"><SpinnerGap size={23} className="spin" /><span>{text}</span></div>;
}
export function Title({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="page-title"><div><h1>{title}</h1><p>{description}</p></div>{children}</header>;
}
export function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div><div className="panel-body">{children}</div></section>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": hint ? `${id}-hint` : undefined }) : children}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Password({ name = "password", autoComplete = "current-password", required = true, id: suppliedId, "aria-describedby": description }: { name?: string; autoComplete?: string; required?: boolean; id?: string; "aria-describedby"?: string }) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return <span className="password-input"><input id={id} aria-describedby={description} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required={required} /><button type="button" className="icon-button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-controls={id} onClick={() => setVisible(!visible)}>{visible ? <EyeSlash size={18} /> : <Eye size={18} />}</button></span>;
}
const subscribeToHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;
export function Submit({ busy, children, disabled }: { busy: boolean; children: ReactNode; disabled?: boolean }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  return <><button className="primary-button" type="submit" disabled={!hydrated || busy || disabled}>{busy && <SpinnerGap size={16} className="spin" />}{busy ? "正在处理…" : children}</button><noscript><p className="field-error">请启用 JavaScript 并重新加载页面后再提交。</p></noscript></>;
}
export function CopyValue({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [revealed, setRevealed] = useState(!secret);
  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); } }, [copied]);
  return <div className="copy-field"><span>{label}</span><div><code>{revealed ? value : "••••••••••••••••••••••••"}</code>{secret && <button className="icon-button" aria-label={revealed ? "隐藏密钥" : "显示密钥"} onClick={() => setRevealed(!revealed)}>{revealed ? <EyeSlash size={17} /> : <Eye size={17} />}</button>}<button className="icon-button" aria-label={`复制 ${label}`} title={copied ? "已复制" : "复制"} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setError(false); } catch { setError(true); } }}>{copied ? <Check size={17} /> : <Copy size={17} />}</button></div>{copied && <small role="status">已复制</small>}{error && <small role="alert">复制失败，请选中文字手动复制。</small>}</div>;
}
export function CodeBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="code-block"><button className="small-button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setFailed(false); } catch { setFailed(true); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "已复制" : "复制代码"}</button><pre><code>{value}</code></pre>{failed && <p role="alert">请选中代码手动复制。</p>}</div>;
}
export function Modal({ open, onClose, title, description, children, busy = false }: { open: boolean; onClose: () => void; title: string; description: string; children: ReactNode; busy?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}><Dialog.Portal><div className="account-ui"><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description><Dialog.Close className="icon-button dialog-close" aria-label="关闭" disabled={busy}><X size={20} /></Dialog.Close>{children}</Dialog.Content></div></Dialog.Portal></Dialog.Root>;
}
export function useTask() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  async function run(action: () => Promise<void>, success = "") {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(""); setMessage(""); setLoginRequired(false);
    try { await action(); if (success) setMessage(success); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失败，请重试。"); setLoginRequired(error instanceof ApiError && ["authentication_required", "authentication_incomplete", "session_expired", "session_mismatch", "step_up_required"].includes(error.code)); }
    finally { running.current = false; setBusy(false); }
  }
  return { busy, error, message, loginRequired, run, clear: () => { setError(""); setMessage(""); setLoginRequired(false); } };
}
export function TaskNotice({ task }: { task: ReturnType<typeof useTask> }) {
  return <>{task.error && <Notice kind="error">{task.error}{task.loginRequired && <Link href="/login">重新登录</Link>}</Notice>}{task.message && <Notice kind="success">{task.message}</Notice>}</>;
}
export const formValue = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) || "");
export const formatDate = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
