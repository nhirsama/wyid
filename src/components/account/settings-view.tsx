"use client";

import { AccountLink as Link } from "./navigation";
import { useAccountRouter as useRouter } from "./navigation";
import { useEffect, useState } from "react";
import { Desktop, SignOut } from "@phosphor-icons/react";
import { api, cachedApiData, post, readApi } from "@/lib/account/api";
import type { Account, Device, PublicConfig } from "@/lib/account/types";
import { AuthenticationSettings } from "./authentication-settings";
import { PasswordHint } from "./password-hint";
import { AvatarSettings } from "./avatar-settings";
import { Field, Loading, Modal, Notice, Panel, Password, Submit, TaskNotice, Title, formValue, formatDate, useTask } from "./ui";

function Profile({ account, onAccount }: { account: Account; onAccount: (value: Account) => void }) {
  const profileTask = useTask();
  const emailTask = useTask();
  const [verificationUserId, setVerificationUserId] = useState("");
  return <><AvatarSettings account={account} onAccount={onAccount} /><Panel title="个人资料" description="你的账号基础资料。"><TaskNotice task={profileTask} /><form method="post" className="form settings-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const data = { displayName: formValue(form, "displayName"), preferredLanguage: formValue(form, "preferredLanguage") }; profileTask.run(async () => { const result = await api<{ account: Account }>("/me", { method: "PATCH", body: JSON.stringify(data) }); onAccount(result.account); }, "个人资料已保存。"); }}><Field label="昵称"><input name="displayName" autoComplete="nickname" defaultValue={account.displayName} maxLength={200} required /></Field><Field label="通知语言"><select name="preferredLanguage" defaultValue={account.preferredLanguage}><option value="zh-CN">简体中文</option><option value="en">English</option>{!["zh-CN", "en"].includes(account.preferredLanguage) && <option value={account.preferredLanguage}>{account.preferredLanguage}</option>}</select></Field><div className="form-actions"><Submit busy={profileTask.busy}>保存资料</Submit></div></form></Panel><Panel title="邮箱"><div className="email-current"><strong>{account.email}</strong><span className={`status-tag ${account.emailVerified ? "ok" : "pending"}`}>{account.emailVerified ? "已验证" : "待验证"}</span></div><TaskNotice task={emailTask} />{verificationUserId && <Notice kind="success">验证邮件已发送。<Link href={`/verify-email?userID=${encodeURIComponent(verificationUserId)}`}>输入验证码</Link></Notice>}<form method="post" className="form settings-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const data = { email: formValue(form, "email"), password: formValue(form, "password") }; emailTask.run(async () => { const result = await post<{ userId: string; account: Account }>("/me/email", data); setVerificationUserId(result.userId); onAccount(result.account); form.reset(); }); }}><Field label={account.emailVerified ? "新邮箱" : "邮箱"}><input name="email" type="email" autoComplete="email" defaultValue={account.emailVerified ? "" : account.email} required /></Field><Field label="当前登录密码"><Password /></Field><div className="form-actions"><Submit busy={emailTask.busy}>保存并发送验证邮件</Submit></div></form></Panel></>;
}

function Security({ config }: { config: PublicConfig }) {
  const passwordTask = useTask();
  return <><Panel title="修改密码"><TaskNotice task={passwordTask} /><form method="post" className="form settings-form" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const data = { currentPassword: formValue(form, "currentPassword"), password: formValue(form, "password") }; if (data.password !== formValue(form, "confirm")) { passwordTask.run(async () => { throw new Error("两次输入的密码不一致。"); }); return; } passwordTask.run(async () => { await post("/me/password", data); form.reset(); }, "密码已更新。"); }}><Field label="当前密码"><Password name="currentPassword" /></Field><Field label="新密码"><Password autoComplete="new-password" /></Field><PasswordHint policy={config.passwordPolicy} /><Field label="确认新密码"><Password name="confirm" autoComplete="new-password" /></Field><div className="form-actions"><Link href="/forgot-password" className="text-link">找回密码</Link><Submit busy={passwordTask.busy}>更新密码</Submit></div></form></Panel><AuthenticationSettings /></>;
}

function Devices() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[] | null>(() => cachedApiData<{ devices: Device[] }>("/me/sessions")?.devices ?? null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<Device | "others" | null>(null);
  const task = useTask();
  useEffect(() => { let active = true; readApi<{ devices: Device[] }>("/me/sessions", revision > 0).then(result => { if (active) { setDevices(result.devices); setLoadError(""); } }).catch(error => { if (active) setLoadError(error.message); }); return () => { active = false; }; }, [revision]);
  return <Panel title="登录设备" description="管理账号在不同浏览器中的身份会话。" action={devices?.some(device => !device.current) && <button className="small-button" onClick={() => { task.clear(); setTarget("others"); }}>退出其他设备</button>}><Notice>退出设备会结束对应的身份会话。各网站自己维护的登录状态与已签发 token 按各自有效期处理。</Notice>{loadError ? <><Notice kind="error">{loadError}</Notice><button className="small-button" onClick={() => setRevision(revision + 1)}>重试</button></> : devices === null ? <Loading /> : devices.length === 0 ? <p className="body-copy">当前没有可展示的身份会话。</p> : <div className="device-list">{devices.map(device => <div className="device-row" key={device.id}><span className="device-icon"><Desktop size={24} /></span><div><h3>{device.name} {device.current && <span className="status-tag ok">当前设备</span>}</h3><p>创建于 {formatDate(device.createdAt)}</p><p>最近更新 {formatDate(device.lastUsedAt)}</p></div><button className="small-button" onClick={() => { task.clear(); setTarget(device); }}><SignOut size={15} />退出</button></div>)}</div>}<Modal open={!!target} onClose={() => setTarget(null)} title={target === "others" ? "退出其他设备？" : "退出此设备？"} description={target !== "others" && target?.current ? "当前设备的身份会话将结束，随后返回登录页面。" : "结束所选设备的身份会话，后续登录需要重新验证。"} busy={task.busy}><TaskNotice task={task} /><div className="form-actions"><button className="small-button" disabled={task.busy} onClick={() => setTarget(null)}>取消</button><button className="primary-button" disabled={task.busy} onClick={() => task.run(async () => { const selected = target === "others" ? devices?.filter(device => !device.current) || [] : target ? [target] : []; for (const device of selected) { const result = await api<{ signedOut: boolean }>(`/me/sessions/${encodeURIComponent(device.id)}`, { method: "DELETE", body: "{}" }); setDevices(value => value?.filter(item => item.id !== device.id) || []); if (result.signedOut) { router.replace("/login"); return; } } setTarget(null); setRevision(revision + 1); })}>{task.busy ? "正在退出…" : "确认退出"}</button></div></Modal></Panel>;
}

export function SettingsView({ route, account, onAccount, config }: { route: string; account: Account; onAccount: (value: Account) => void; config: PublicConfig }) {
  const tab = route.endsWith("/security") ? "security" : route.endsWith("/devices") ? "devices" : "profile";
  return <><Title title="账号设置" description="维护你的资料、验证方式和登录设备。" /><nav className="tabs" aria-label="账号设置">{[["profile", "个人资料与邮箱"], ["security", "密码与验证方式"], ["devices", "登录设备"]].map(([id, label]) => <Link key={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} href={`/settings/${id}`}>{label}</Link>)}</nav>{tab === "profile" ? <Profile account={account} onAccount={onAccount} /> : tab === "security" ? <Security config={config} /> : <Devices />}</>;
}
