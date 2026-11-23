"use client";

import { useEffect, useState } from "react";
import { AccountLink as Link } from "./navigation";
import { Fingerprint, ShieldCheck } from "@phosphor-icons/react";
import { api, cachedApiData, post, readApi } from "@/lib/account/api";
import { factorNames, methodReady } from "@/lib/account/authentication";
import type { AuthenticationMethod, FactorType, MethodsResponse } from "@/lib/account/types";
import { TotpSetup } from "./totp-setup";
import { Field, Loading, Modal, Notice, Panel, Submit, TaskNotice, formValue, useTask } from "./ui";

type Action = { type: FactorType; remove?: AuthenticationMethod };
const groups: { title: string; types: FactorType[] }[] = [
  { title: "两步验证", types: ["totp", "webauthn", "otp-email", "otp-sms"] },
  { title: "通行密钥", types: ["passkey"] },
];
const keyType = (type: FactorType) => type === "passkey" || type === "webauthn";

export function AuthenticationSettings() {
  const [data, setData] = useState<MethodsResponse | null>(() => cachedApiData<MethodsResponse>("/me/methods"));
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [phase, setPhase] = useState<"start" | "totp" | "check" | "phone">("start");
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const task = useTask();
  useEffect(() => {
    let active = true;
    readApi<MethodsResponse>("/me/methods", revision > 0).then(value => { if (active) { setData(value); setLoadError(""); } }).catch(error => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [revision]);
  const close = () => { setAction(null); setSetup(null); setPhase("start"); };
  const done = () => { close(); setRevision(value => value + 1); };
  const open = (value: Action, phone = false) => {
    task.clear(); setSetup(null); setAction(value);
    setPhase(phone || !value.remove && value.type === "otp-sms" && !data?.phone?.verified ? "phone" : "start");
  };
  const type = action?.type || "totp";
  async function checkKey() {
    const { authenticate } = await import("@/lib/webauthn");
    const challenge = await post<{ publicKey: Record<string, unknown>; method: "passkey" | "u2f" }>("/me/methods/check/send");
    const credential = await authenticate(challenge.publicKey, challenge.method);
    await post("/me/methods/check", { credential });
    done();
  }

  return <>{groups.map(group => {
    const visible = !data || group.types.some(item => data.available[item] || data.methods.some(method => method.type === item));
    if (!visible) return null;
    return <Panel key={group.title} title={group.title}>
      {loadError ? <><Notice kind="error">{loadError}</Notice><div className="form-actions"><Link href="/login" className="text-link">继续身份验证</Link><button className="small-button" onClick={() => setRevision(value => value + 1)}>重新读取</button></div></> : !data ? <Loading /> : <>
        {group.types.map(type => {
          const methods = data.methods.filter(item => item.type === type);
          if (!data.available[type] && !methods.length) return null;
          return <section key={type} className="setting-group">
            <div className="setting-row"><div className="setting-label">{keyType(type) ? <Fingerprint size={23} /> : <ShieldCheck size={23} />}<div><h3>{factorNames[type]}</h3>{type === "otp-sms" && data.phone?.number && <p>{data.phone.number}</p>}</div></div>
              {data.available[type] && (keyType(type) || !methods.some(item => methodReady(item.state))) && <button className="small-button" onClick={() => open({ type })}>{keyType(type) ? "添加" : "设置"}</button>}
            </div>
            {methods.map((method, index) => <div className="setting-row setting-item" key={method.id || `${type}-${index}`}><div><h3>{method.name}</h3><p>{methodReady(method.state) ? "已启用" : "待完成绑定"}</p></div><button className="small-button" disabled={keyType(type) && !method.id} onClick={() => open({ type, remove: method })}>移除</button></div>)}
            {type === "otp-sms" && data.available[type] && <div className="setting-group-action"><button className="text-link" onClick={() => open({ type }, true)}>{data.phone?.verified ? "修改手机号码" : "验证手机号码"}</button></div>}
          </section>;
        })}
      </>}
    </Panel>;
  })}
    <Modal open={!!action} onClose={close} title={action?.remove ? `移除${factorNames[type]}？` : phase === "phone" ? "验证手机号码" : phase === "check" ? "确认验证方式" : `设置${factorNames[type]}`} description={action?.remove ? "移除所选凭据，后续登录根据账号策略选择可用方式。" : phase === "check" ? "使用刚绑定的验证方式完成本次身份验证。" : phase === "phone" ? "填写带国家区号的手机号码，并通过短信验证码确认。" : "使用当前已验证的账号完成绑定。"} busy={task.busy}>
      <TaskNotice task={task} />
      {action?.remove ? <div className="form-actions"><button className="small-button" disabled={task.busy} onClick={close}>取消</button><button className="danger-button" disabled={task.busy} onClick={() => task.run(async () => { await api("/me/methods", { method: "DELETE", body: JSON.stringify({ type, id: action?.remove?.id }) }); done(); })}>确认移除</button></div>
      : phase === "phone" ? <div className="modal-stack">
        <form method="post" className="form" onSubmit={event => { event.preventDefault(); const phone = formValue(event.currentTarget, "phone"); task.run(async () => { await post("/me/phone", { phone }); }, "短信验证码已发送。"); }}><Field label="手机号码" hint="例如 +8613800138000"><input name="phone" type="tel" autoComplete="tel" defaultValue={data?.phone?.number || ""} required /></Field><Submit busy={task.busy}>发送短信验证码</Submit></form>
        <form method="post" className="form" onSubmit={event => { event.preventDefault(); const code = formValue(event.currentTarget, "code"); task.run(async () => { const result = await post<{ checkRequired: boolean }>("/me/phone/verify", { code }); if (result.checkRequired) { setPhase("check"); await post("/me/methods/check/send"); } else setPhase("start"); }, "手机号码已验证。"); }}><Field label="短信验证码"><input name="code" inputMode="numeric" autoComplete="one-time-code" required /></Field><Submit busy={task.busy}>验证手机号码</Submit></form>
      </div> : phase === "check" ? keyType(type) ? <button className="primary-button wide" disabled={task.busy} onClick={() => task.run(checkKey)}><Fingerprint size={20} />验证并完成设置</button> : <form method="post" className="form" onSubmit={event => { event.preventDefault(); const code = formValue(event.currentTarget, "code"); task.run(async () => { await post("/me/methods/check", { code }); done(); }); }}><Field label="验证码"><input name="code" inputMode="numeric" autoComplete="one-time-code" required /></Field><Submit busy={task.busy}>验证并完成设置</Submit><button type="button" className="text-link" disabled={task.busy} onClick={() => task.run(async () => { await post("/me/methods/check/send"); }, "验证码已发送。")}>发送验证码</button></form>
      : phase === "totp" && setup ? <><TotpSetup secret={setup.secret} uri={setup.uri} /><form method="post" className="form" onSubmit={event => { event.preventDefault(); const code = formValue(event.currentTarget, "code"); task.run(async () => { await post("/me/methods/totp/verify", { code }); done(); }); }}><Field label="验证器动态验证码"><input name="code" inputMode="numeric" autoComplete="one-time-code" required /></Field><Submit busy={task.busy}>完成绑定</Submit></form></>
      : keyType(type) ? <form method="post" className="form" onSubmit={event => { event.preventDefault(); const name = formValue(event.currentTarget, "name"); task.run(async () => { const { register } = await import("@/lib/webauthn"); const challenge = await post<{ publicKey: Record<string, unknown> }>("/me/methods/key", { type }); const credential = await register(challenge.publicKey, type === "webauthn" ? "u2f" : "passkey"); await post("/me/methods/key/verify", { type, name, credential }); setPhase("check"); }); }}><Field label="设备名称"><input name="name" maxLength={200} placeholder="例如：我的手机" required /></Field><Submit busy={task.busy}>开始绑定</Submit></form>
      : type === "totp" ? <button className="primary-button wide" disabled={task.busy} onClick={() => task.run(async () => { setSetup(await post<{ secret: string; uri: string }>("/me/methods/totp")); setPhase("totp"); })}>获取验证器密钥</button>
      : <button className="primary-button wide" disabled={task.busy} onClick={() => task.run(async () => { await post("/me/methods/otp", { type }); setPhase("check"); await post("/me/methods/check/send"); }, "验证码已发送。")}>启用并发送验证码</button>}
    </Modal>
  </>;
}
