"use client";

import { AccountLink as Link } from "./navigation";
import { useAccountRouter as useRouter } from "./navigation";
import { useEffect, useState } from "react";
import { Desktop, SignOut } from "@phosphor-icons/react";
import { api, cachedApiData, clearApiCache, post, readApi } from "@/lib/account/api";
import type { Account, Device, PublicConfig } from "@/lib/account/types";
import { passwordHint, passwordMeetsPolicy, passwordUnmetHint, usernameSchema } from "@/lib/auth";
import { AuthenticationSettings } from "./authentication-settings";
import { AvatarSettings } from "./avatar-settings";
import { Field, Loading, Modal, Notice, Panel, Password, Submit, TaskNotice, Title, formValue, formatDate, useTask } from "./ui";

function Profile({ account, onAccount }: { account: Account; onAccount: (value: Account) => void }) {
  const router = useRouter();
  const profileTask = useTask();
  const usernameTask = useTask();
  const emailTask = useTask();
  const [verificationUserId, setVerificationUserId] = useState("");
  const [usernameModal, setUsernameModal] = useState<"warn" | "edit" | null>(null);
  const [emailModal, setEmailModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [usernameSuccess, setUsernameSuccess] = useState("");
  function openUsernameModal() {
    usernameTask.clear();
    setUsernameSuccess("");
    setNewUsername("");
    setConfirmUsername("");
    setUsernameModal("warn");
  }
  function closeUsernameModal() {
    if (usernameTask.busy) return;
    setUsernameModal(null);
  }
  function openEmailModal() {
    emailTask.clear();
    setEmailModal(true);
  }
  function closeEmailModal() {
    if (emailTask.busy) return;
    setEmailModal(false);
  }
  return <>
    <Panel title="个人资料">
      <div className="profile-layout">
        <div className="profile-fields">
          <TaskNotice task={profileTask} />
          <form method="post" className="form settings-form" onSubmit={e => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = { displayName: formValue(form, "displayName"), preferredLanguage: formValue(form, "preferredLanguage") };
            profileTask.run(async () => {
              const result = await api<{ account: Account }>("/me", { method: "PATCH", body: JSON.stringify(data) });
              onAccount(result.account);
            }, "个人资料已保存。");
          }}>
            <fieldset disabled={profileTask.busy} className="form-fieldset">
              <Field label="昵称"><input name="displayName" autoComplete="nickname" defaultValue={account.displayName} maxLength={200} required /></Field>
              <Field label="通知语言"><select name="preferredLanguage" defaultValue={account.preferredLanguage}><option value="zh-CN">简体中文</option><option value="en">English</option>{!["zh-CN", "en"].includes(account.preferredLanguage) && <option value={account.preferredLanguage}>{account.preferredLanguage}</option>}</select></Field>
            </fieldset>
            <Submit busy={profileTask.busy}>保存资料</Submit>
          </form>
        </div>
        <AvatarSettings account={account} onAccount={onAccount} />
      </div>
    </Panel>
    <Panel title="账号信息">
      {usernameSuccess && <Notice kind="success">{usernameSuccess}</Notice>}
      {verificationUserId && <Notice kind="success">验证邮件已发送。<Link href={`/verify-email?userID=${encodeURIComponent(verificationUserId)}`}>输入验证码</Link></Notice>}
      {account.username && <div className="setting-row">
        <div>
          <h3>用户名</h3>
          <p className="account-value account-username">{account.username}</p>
        </div>
        <button type="button" className="small-button" onClick={openUsernameModal}>更改</button>
      </div>}
      <div className="setting-row">
        <div>
          <h3>邮箱</h3>
          <p className="account-value"><span>{account.email}</span><span className={`status-tag ${account.emailVerified ? "ok" : "pending"}`}>{account.emailVerified ? "已验证" : "待验证"}</span></p>
        </div>
        <button type="button" className="small-button" onClick={openEmailModal}>更改</button>
      </div>
    </Panel>
    <Modal
      open={usernameModal !== null}
      onClose={closeUsernameModal}
      title={usernameModal === "warn" ? "更改用户名？" : "设置新用户名"}
      description={usernameModal === "warn" ? "更改后将使用新用户名登录，请确认后再继续。" : "仅支持大小写字母、数字和连字符（-）。"}
      busy={usernameTask.busy}
    >
      {usernameModal === "warn" ? <>
        <Notice kind="error">
          <div>
            <strong>更改前请注意：</strong>
            <ul className="confirm-list">
              <li>以后仅可使用新用户名登录此账号。</li>
              <li>原用户名 <code>{account.username}</code> 将被释放，可能被其他用户使用。</li>
              <li>部分已登录会话或接入应用可能需要重新登录。</li>
            </ul>
          </div>
        </Notice>
        <div className="form-actions">
          <button type="button" className="small-button" onClick={closeUsernameModal}>取消</button>
          <button type="button" className="danger-button" onClick={() => { usernameTask.clear(); setUsernameModal("edit"); }}>继续更改</button>
        </div>
      </> : <>
        <TaskNotice task={usernameTask} />
        <form method="post" className="form" noValidate onSubmit={event => {
          event.preventDefault();
          const parsed = usernameSchema.safeParse(newUsername);
          if (!parsed.success) {
            usernameTask.run(async () => { throw new Error(parsed.error.issues[0]?.message || "用户名格式无效。"); });
            return;
          }
          if (parsed.data === account.username) {
            usernameTask.run(async () => { throw new Error("新用户名不能与当前用户名相同。"); });
            return;
          }
          if (parsed.data !== confirmUsername.trim()) {
            usernameTask.run(async () => { throw new Error("两次输入的用户名不一致。"); });
            return;
          }
          usernameTask.run(async () => {
            const result = await post<{ account: Account; requiresRelogin?: boolean }>("/me/username", { username: parsed.data });
            if (result.requiresRelogin) {
              clearApiCache();
              setUsernameModal(null);
              router.replace("/login");
              return;
            }
            onAccount(result.account);
            setUsernameSuccess(`用户名已更新为 ${result.account.username || parsed.data}。`);
            setUsernameModal(null);
          });
        }}>
          <fieldset disabled={usernameTask.busy} className="form-fieldset">
            <Field label="新用户名"><input name="username" value={newUsername} onChange={e => setNewUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={100} placeholder="输入新用户名" required /></Field>
            <Field label="确认新用户名"><input name="confirmUsername" value={confirmUsername} onChange={e => setConfirmUsername(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={100} placeholder="再次输入新用户名" required /></Field>
          </fieldset>
          <div className="form-actions">
            <button type="button" className="small-button" disabled={usernameTask.busy} onClick={() => { usernameTask.clear(); setUsernameModal("warn"); }}>上一步</button>
            <Submit busy={usernameTask.busy} disabled={!newUsername.trim() || newUsername.trim() !== confirmUsername.trim()}>确认更改</Submit>
          </div>
        </form>
      </>}
    </Modal>
    <Modal open={emailModal} onClose={closeEmailModal} title="更改邮箱" description="保存后会向新邮箱发送验证邮件。" busy={emailTask.busy}>
      <TaskNotice task={emailTask} />
      <form method="post" className="form" onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = { email: formValue(form, "email"), password: formValue(form, "password") };
        emailTask.run(async () => {
          const result = await post<{ userId: string; account: Account }>("/me/email", data);
          setVerificationUserId(result.userId);
          onAccount(result.account);
          form.reset();
          setEmailModal(false);
        });
      }}>
        <fieldset disabled={emailTask.busy} className="form-fieldset">
          <Field label={account.emailVerified ? "新邮箱" : "邮箱"}><input name="email" type="email" autoComplete="email" defaultValue={account.emailVerified ? "" : account.email} required /></Field>
          <Field label="当前登录密码"><Password /></Field>
        </fieldset>
        <div className="form-actions">
          <button type="button" className="small-button" disabled={emailTask.busy} onClick={closeEmailModal}>取消</button>
          <Submit busy={emailTask.busy}>保存并发送验证邮件</Submit>
        </div>
      </form>
    </Modal>
  </>;
}

function Security({ config }: { config: PublicConfig }) {
  const passwordTask = useTask();
  const [passwordModal, setPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const policy = config.passwordPolicy
    ? { minLength: config.passwordPolicy.minLength, uppercase: config.passwordPolicy.hasUppercase, lowercase: config.passwordPolicy.hasLowercase, number: config.passwordPolicy.hasNumber, symbol: config.passwordPolicy.hasSymbol }
    : null;
  function openPasswordModal() {
    passwordTask.clear();
    setPasswordSuccess("");
    setNewPassword("");
    setPasswordModal(true);
  }
  function closePasswordModal() {
    if (passwordTask.busy) return;
    setPasswordModal(false);
  }
  return <>
    {config.loginMethods.password && <Panel title="登录密码">
      {passwordSuccess && <Notice kind="success">{passwordSuccess}</Notice>}
      <div className="setting-row">
        <div>
          <h3>密码</h3>
          <p>••••••••</p>
        </div>
        <button type="button" className="small-button" onClick={openPasswordModal}>修改</button>
      </div>
    </Panel>}
    <Modal open={passwordModal} onClose={closePasswordModal} title="修改密码" description="验证当前密码后设置新密码。" busy={passwordTask.busy}>
      <TaskNotice task={passwordTask} />
      <form method="post" className="form" onSubmit={e => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = { currentPassword: formValue(form, "currentPassword"), password: newPassword };
        if (policy && !passwordMeetsPolicy(data.password, policy)) {
          passwordTask.run(async () => { throw new Error(`密码不符合要求：${passwordHint(policy)}。`); });
          return;
        }
        if (data.password !== formValue(form, "confirm")) {
          passwordTask.run(async () => { throw new Error("两次输入的密码不一致。"); });
          return;
        }
        passwordTask.run(async () => {
          await post("/me/password", data);
          form.reset();
          setNewPassword("");
          setPasswordSuccess("密码已更新。");
          setPasswordModal(false);
        });
      }}>
        <fieldset disabled={passwordTask.busy} className="form-fieldset">
          <Field label="当前密码"><Password name="currentPassword" /></Field>
          <Field label="新密码" hint={policy ? passwordUnmetHint(newPassword, policy) : undefined}><Password value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="确认新密码"><Password name="confirm" autoComplete="new-password" /></Field>
        </fieldset>
        <div className="form-links"><Link href="/forgot-password" className="text-link">找回密码</Link></div>
        <div className="form-actions">
          <button type="button" className="small-button" disabled={passwordTask.busy} onClick={closePasswordModal}>取消</button>
          <Submit busy={passwordTask.busy}>更新密码</Submit>
        </div>
      </form>
    </Modal>
    <AuthenticationSettings />
  </>;
}

function Devices() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[] | null>(() => cachedApiData<{ devices: Device[] }>("/me/sessions")?.devices ?? null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<Device | "others" | null>(null);
  const task = useTask();
  useEffect(() => { let active = true; readApi<{ devices: Device[] }>("/me/sessions", revision > 0).then(result => { if (active) { setDevices(result.devices); setLoadError(""); } }).catch(error => { if (active) setLoadError(error.message); }); return () => { active = false; }; }, [revision]);
  return <Panel title="登录设备" action={devices?.some(device => !device.current) && <button className="small-button" onClick={() => { task.clear(); setTarget("others"); }}>退出其他设备</button>}>{loadError ? <><Notice kind="error">{loadError}</Notice><button className="small-button" onClick={() => setRevision(revision + 1)}>重试</button></> : devices === null ? <Loading /> : devices.length === 0 ? <p className="body-copy">当前没有可展示的身份会话。</p> : <div className="device-list">{devices.map(device => <div className="device-row" key={device.id}><span className="device-icon"><Desktop size={24} /></span><div><h3>{device.name} {device.current && <span className="status-tag ok">当前设备</span>}</h3><p>创建于 {formatDate(device.createdAt)}</p><p>最近更新 {formatDate(device.lastUsedAt)}</p></div><button className="small-button" onClick={() => { task.clear(); setTarget(device); }}><SignOut size={15} />退出</button></div>)}</div>}<Modal open={!!target} onClose={() => setTarget(null)} title={target === "others" ? "退出其他设备？" : "退出此设备？"} description={target !== "others" && target?.current ? "当前设备的身份会话将结束并返回登录页。各网站已签发的会话按各自有效期处理。" : "所选设备的身份会话将结束，后续需重新验证。各网站已签发的会话按各自有效期处理。"} busy={task.busy}><TaskNotice task={task} /><div className="form-actions"><button className="small-button" disabled={task.busy} onClick={() => setTarget(null)}>取消</button><button className="primary-button" disabled={task.busy} onClick={() => task.run(async () => { const selected = target === "others" ? devices?.filter(device => !device.current) || [] : target ? [target] : []; for (const device of selected) { const result = await api<{ signedOut: boolean }>(`/me/sessions/${encodeURIComponent(device.id)}`, { method: "DELETE", body: "{}" }); setDevices(value => value?.filter(item => item.id !== device.id) || []); if (result.signedOut) { router.replace("/login"); return; } } setTarget(null); setRevision(revision + 1); })}>{task.busy ? "正在退出…" : "确认退出"}</button></div></Modal></Panel>;
}

export function SettingsView({ route, account, onAccount, config }: { route: string; account: Account; onAccount: (value: Account) => void; config: PublicConfig }) {
  const tab = route.endsWith("/security") ? "security" : route.endsWith("/devices") ? "devices" : "profile";
  return <><Title title="账号设置" /><nav className="tabs" aria-label="账号设置">{[["profile", "个人资料"], ["security", "密码与验证方式"], ["devices", "登录设备"]].map(([id, label]) => <Link key={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} href={`/settings/${id}`}>{label}</Link>)}</nav>{tab === "profile" ? <Profile account={account} onAccount={onAccount} /> : tab === "security" ? <Security config={config} /> : <Devices />}</>;
}
