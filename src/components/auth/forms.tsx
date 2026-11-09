"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Fingerprint, ShieldCheck } from "@phosphor-icons/react";
import {
  authLink, forgotPasswordSchema, loginSchema, passwordHint, passwordMeetsPolicy, registerSchema,
  resetPasswordSchema, verifyEmailSchema, verifyTotpSchema, type AuthContext, type Factor, type LoginPolicy,
  type ForgotPasswordInput, type LoginInput, type RegisterInput, type ResetPasswordInput, type VerifyEmailInput, type VerifyTotpInput,
} from "@/lib/auth";
import { authenticate } from "@/lib/webauthn";
import { withBasePath } from "@/lib/paths";
import { beginFactor, chooseIdentityProvider, startPasskey, finishPasskey, finishTotpEnrollment, login, register, requestPasswordReset, resendEmail, resetPassword, startTotpEnrollment, verifyEmail, verifyFactor } from "@/server/actions";
import { Feedback, Field, Notice, Submit, useAuthAction } from "@/components/ui/form";

type Props = { context: AuthContext; policy: LoginPolicy };

function useWebAuthnLogin(context: AuthContext) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>();
  async function begin(loginName: string) {
    setError(null); setMessage(undefined); setPending(true);
    try {
      const started = await startPasskey({ loginName }, context);
      if (!started.ok || !started.options) { setError(started.message || "无法开始通行密钥登录。"); return; }
      setOptions(started.options);
      setMessage("验证请求已准备好，请继续使用通行密钥。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始通行密钥登录。"); }
    finally { setPending(false); }
  }
  async function authenticateNow() {
    if (!options) return;
    setError(null); setMessage(undefined); setPending(true);
    try {
      const assertion = await authenticate(options);
      const result = await finishPasskey(assertion, context);
      if (!result.ok) { setError(result.message); return; }
      if (result.redirect) window.location.assign(withBasePath(result.redirect));
      else setMessage(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法完成通行密钥登录。"); setOptions(undefined); }
    finally { setPending(false); }
  }
  return { pending, error, message, options, begin, authenticateNow };
}

export function LoginForm({ context, policy }: Props) {
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { loginName: context.loginHint || "", password: "" } });
  const action = useAuthAction();
  const webauthn = useWebAuthnLogin(context);
  const hasAlternatives = policy.passkey || policy.identityProviders.length > 0;
  return <>
    {context.authRequestId && <div className="flow-note"><ShieldCheck size={17} aria-hidden="true" /><span>登录后继续访问你的应用</span></div>}
    <form className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => login(input, context)))}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending || webauthn.pending} className="form-fieldset">
        {(policy.password || policy.passkey) && <Field label="邮箱或用户名" registration={form.register("loginName")} error={form.formState.errors.loginName?.message}
          autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="输入你的邮箱或用户名" maxLength={320} />}
        {policy.password && <>
          <Field label="密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message}
            autoComplete="current-password" placeholder="输入你的密码" maxLength={1024} />
          <div className="form-links"><Link href={authLink("/forgot-password", context)}>忘记密码？</Link></div>
          <Submit pending={action.pending}>{context.authRequestId ? <>登录并继续<ArrowRight size={16} aria-hidden="true" /></> : "登录"}</Submit>
        </>}
      </fieldset>
    </form>
    {hasAlternatives && policy.password && <div className="method-divider"><span>其他登录方式</span></div>}
    {(hasAlternatives || (action.result?.ok && action.result.form)) && <div className="auth-methods">
      {webauthn.error && <div className="form-feedback"><Notice kind="error">{webauthn.error}</Notice></div>}
      {webauthn.message && <div className="form-feedback"><Notice kind="success">{webauthn.message}</Notice></div>}
      {policy.passkey && !webauthn.options && <button type="button" className="button secondary-button wide" disabled={webauthn.pending || action.pending}
        onClick={() => webauthn.begin(form.getValues("loginName"))}><Fingerprint size={20} aria-hidden="true" />准备通行密钥登录</button>}
      {policy.passkey && webauthn.options && <button type="button" className="button secondary-button wide" disabled={webauthn.pending || action.pending}
        onClick={() => webauthn.authenticateNow()}><Fingerprint size={20} aria-hidden="true" />继续使用通行密钥</button>}
      {policy.identityProviders.map(provider => <button type="button" key={provider.id} className="button secondary-button wide" disabled={action.pending || webauthn.pending}
        onClick={() => action.run(() => chooseIdentityProvider({ id: provider.id }, context))}>使用 {provider.name} 登录<ArrowRight size={16} aria-hidden="true" /></button>)}
      {action.result?.ok && action.result.form && <form method="post" action={action.result.form.action} className="form">
        {Object.entries(action.result.form.fields).map(([name, value]) => <input type="hidden" key={name} name={name} value={value} />)}
        <Submit pending={false}>继续身份提供方登录</Submit>
      </form>}
    </div>}
    {policy.registration && <p className="auth-switch">还没有账号？<Link href={authLink("/register", context)}>创建账号</Link></p>}
  </>;
}

export function RegisterForm({ context, policy }: Props) {
  const form = useForm<RegisterInput>({ resolver: zodResolver(registerSchema), defaultValues: { givenName: "", familyName: "", nickName: "", email: "", password: "", confirmPassword: "" } });
  const action = useAuthAction();
  function submit(input: RegisterInput) {
    if (!passwordMeetsPolicy(input.password, policy.passwordPolicy)) { form.setError("password", { message: `密码不符合要求：${passwordHint(policy.passwordPolicy)}。` }); return; }
    action.run(() => register(input, context));
  }
  if (action.result?.ok && action.result.message) return <div className="result-stack"><Notice kind="success">{action.result.message}</Notice><Link className="button primary-button wide" href={action.result.redirect || authLink("/login", context)}>继续<ArrowRight size={16} /></Link></div>;
  return <>
    <form className="form" noValidate onSubmit={form.handleSubmit(submit)}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="姓氏" registration={form.register("familyName")} error={form.formState.errors.familyName?.message} autoComplete="family-name" placeholder="姓氏" maxLength={100} />
        <Field label="名字" registration={form.register("givenName")} error={form.formState.errors.givenName?.message} autoComplete="given-name" placeholder="名字" maxLength={100} />
        <Field label="昵称（可选）" registration={form.register("nickName")} error={form.formState.errors.nickName?.message} autoComplete="nickname" placeholder="希望我们怎么称呼你？" maxLength={100} />
        <Field label="邮箱" type="email" registration={form.register("email")} error={form.formState.errors.email?.message} autoComplete="email" placeholder="you@example.com" maxLength={320} />
        <Field label="密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message} autoComplete="new-password" hint={`密码要求：${passwordHint(policy.passwordPolicy)}。`} maxLength={1024} />
        <Field label="确认密码" type="password" registration={form.register("confirmPassword")} error={form.formState.errors.confirmPassword?.message} autoComplete="new-password" placeholder="再次输入密码" maxLength={1024} />
        <Submit pending={action.pending}>创建账号<ArrowRight size={16} aria-hidden="true" /></Submit>
      </fieldset>
    </form>
    <p className="auth-switch">已有账号？<Link href={authLink("/login", context)}>前往登录</Link></p>
  </>;
}

export function ForgotPasswordForm({ context }: { context: AuthContext }) {
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { loginName: context.loginHint || "" } });
  const action = useAuthAction();
  if (action.result?.ok) return <div className="result-stack"><Notice kind="success">{action.result.message}</Notice><Link className="button secondary-button wide" href={authLink("/login", context)}>返回登录</Link></div>;
  return <form className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => requestPasswordReset(input, context)))}>
    <Feedback result={action.result} />
    <fieldset disabled={action.pending} className="form-fieldset">
      <Field label="邮箱或用户名" registration={form.register("loginName")} error={form.formState.errors.loginName?.message} autoComplete="username" placeholder="输入注册邮箱或用户名" maxLength={320} />
      <Submit pending={action.pending}>发送重置邮件<ArrowRight size={16} aria-hidden="true" /></Submit>
    </fieldset>
  </form>;
}

export function ResetPasswordForm({ context, policy }: Props) {
  const form = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { code: context.code || "", password: "", confirmPassword: "" } });
  const action = useAuthAction();
  function submit(input: ResetPasswordInput) {
    if (!passwordMeetsPolicy(input.password, policy.passwordPolicy)) { form.setError("password", { message: `密码不符合要求：${passwordHint(policy.passwordPolicy)}。` }); return; }
    action.run(() => resetPassword(input, context));
  }
  return <>
    <form className="form" noValidate onSubmit={form.handleSubmit(submit)}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="邮件验证码" registration={form.register("code")} error={form.formState.errors.code?.message} autoComplete="one-time-code" placeholder="输入邮件中的验证码" maxLength={256} />
        <Field label="新密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message} autoComplete="new-password" hint={`密码要求：${passwordHint(policy.passwordPolicy)}。`} maxLength={1024} />
        <Field label="确认新密码" type="password" registration={form.register("confirmPassword")} error={form.formState.errors.confirmPassword?.message} autoComplete="new-password" placeholder="再次输入密码" maxLength={1024} />
        <Submit pending={action.pending} disabled={!context.userId}>保存新密码</Submit>
      </fieldset>
    </form>
    {action.result?.ok && <p className="capability-note">{action.result.message} <Link href={authLink("/login", context)}>前往登录</Link></p>}
  </>;
}

export function VerifyEmailForm({ context }: { context: AuthContext }) {
  const form = useForm<VerifyEmailInput>({ resolver: zodResolver(verifyEmailSchema), defaultValues: { code: context.code || "" } });
  const action = useAuthAction();
  const resend = useAuthAction();
  if (action.result?.ok) return <div className="result-stack"><Notice kind="success">{action.result.message}</Notice><Link className="button primary-button wide" href={authLink("/login", context)}>继续登录<ArrowRight size={16} /></Link></div>;
  return <>
    {!context.userId && <Notice kind="error">验证邮件链接缺少账号标识，请重新打开邮件中的链接。</Notice>}
    <form className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => verifyEmail(input, context)))}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="邮箱验证码" registration={form.register("code")} error={form.formState.errors.code?.message} autoComplete="one-time-code" placeholder="输入邮件中的验证码" maxLength={256} />
        <Submit pending={action.pending} disabled={!context.userId}>验证邮箱<ArrowRight size={16} aria-hidden="true" /></Submit>
      </fieldset>
    </form>
    <button type="button" className="text-link centered" disabled={!context.userId || resend.pending} onClick={() => resend.run(() => resendEmail(context))}>重新发送验证邮件</button>
    <Feedback result={resend.result} />
  </>;
}

const factorLabels: Record<Factor, string> = { totp: "验证器动态码", otpEmail: "邮件验证码", otpSms: "短信验证码", u2f: "安全密钥" };
export function VerifyFactorForm({ context, methods }: { context: AuthContext; methods: Factor[] }) {
  const [method, setMethod] = useState<Factor>(methods.includes("totp") ? "totp" : methods[0] || "totp");
  const [webauthnPending, setWebauthnPending] = useState(false);
  const [webauthnError, setWebauthnError] = useState<string>();
  const [webauthnOptions, setWebauthnOptions] = useState<Record<string, unknown>>();
  const [challengeStarted, setChallengeStarted] = useState(method === "totp");
  const form = useForm<{ code: string }>({ resolver: zodResolver(method === "totp" ? verifyTotpSchema : z.object({ code: z.string().trim().min(1).max(256) })) });
  const action = useAuthAction();
  async function selectFactor(next: Factor) {
    setMethod(next); setChallengeStarted(next === "totp"); setWebauthnOptions(undefined); setWebauthnError(undefined); form.reset();
    if (next === "totp") return;
    const result = await beginFactor({ method: next }, context);
    if (!result.ok) { setWebauthnError(result.message); return; }
    if (next === "u2f" && !result.options) { setWebauthnError("ZITADEL 未返回安全密钥验证请求，请重新开始。"); return; }
    setChallengeStarted(true);
    setWebauthnOptions(result.options);
  }
  async function verifyHardwareKey() {
    if (!webauthnOptions) return;
    setWebauthnError(undefined); setWebauthnPending(true);
    try {
      const assertion = await authenticate(webauthnOptions);
      const done = await finishPasskey(assertion, context);
      if (done.ok && done.redirect) window.location.assign(withBasePath(done.redirect));
      else if (!done.ok) { setWebauthnError(done.message); setWebauthnOptions(undefined); }
    } catch (error) { setWebauthnError(error instanceof Error ? error.message : "安全密钥验证失败。"); setWebauthnOptions(undefined); }
    finally { setWebauthnPending(false); }
  }
  return <>
    <div className="verification-icon"><ShieldCheck size={30} weight="duotone" aria-hidden="true" /></div>
    <div className="form form-fieldset">
      {methods.length > 1 && <div className="field"><label htmlFor="factor-choice">选择验证方式</label><select id="factor-choice" className="factor-choice" value={method} onChange={event => void selectFactor(event.target.value as Factor)}>
        {methods.map(item => <option key={item} value={item}>{factorLabels[item]}</option>)}
      </select></div>}
      {method !== "u2f" && challengeStarted && <form className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => verifyFactor({ method, code: input.code }, context)))}>
        <Feedback result={action.result} />
        <fieldset disabled={action.pending || webauthnPending} className="form-fieldset">
          <Field label={method === "totp" ? "动态验证码" : factorLabels[method]} registration={form.register("code")} error={form.formState.errors.code?.message}
            inputMode={method === "totp" || method === "otpSms" ? "numeric" : undefined} autoComplete="one-time-code" placeholder={method === "totp" ? "000000" : "输入验证码"} maxLength={256} className={method === "totp" ? "otp-input" : undefined}
            hint={method === "totp" ? "打开已绑定的验证器，输入当前验证码。" : "验证码已发送到账号绑定的验证方式。"} />
          <Submit pending={action.pending}>验证并继续<ArrowRight size={16} aria-hidden="true" /></Submit>
        </fieldset>
      </form>}
      {method !== "totp" && !challengeStarted && <button className="button secondary-button wide" type="button" onClick={() => void selectFactor(method)}>{method === "u2f" ? "开始安全密钥验证" : method === "otpSms" ? "发送短信验证码" : "发送邮件验证码"}</button>}
      {method === "u2f" && challengeStarted && webauthnOptions && <button className="button secondary-button wide" type="button" disabled={webauthnPending} onClick={() => void verifyHardwareKey()}>使用安全密钥验证</button>}
      {webauthnError && <Notice kind="error">{webauthnError}</Notice>}
    </div>
    <Link className="text-link centered" href={authLink("/login", context)}>返回登录</Link>
  </>;
}

export function TotpEnrollmentForm({ context }: { context: AuthContext }) {
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null);
  const [error, setError] = useState<string>();
  const form = useForm<VerifyTotpInput>({ resolver: zodResolver(verifyTotpSchema) });
  const action = useAuthAction();
  async function begin() {
    setError(undefined);
    const result = await startTotpEnrollment(context);
    if (!result.ok || !result.uri || !result.secret) { setError(result.message || "无法开始验证器设置。"); return; }
    setSetup({ uri: result.uri, secret: result.secret });
  }
  return <>
    <div className="result-stack">
      <Notice>此账号需要先登记验证器。请在验证器应用中添加以下密钥，然后输入应用生成的 6 位验证码。</Notice>
      {setup ? <>
        <label className="field"><span>验证器密钥</span><input value={setup.secret} readOnly autoComplete="off" /></label>
        <p className="field-hint">{setup.uri}</p>
        <form className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => finishTotpEnrollment(input, context)))}>
          <Feedback result={action.result} />
          <fieldset disabled={action.pending} className="form-fieldset">
            <Field label="动态验证码" registration={form.register("code")} error={form.formState.errors.code?.message} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} className="otp-input" />
            <Submit pending={action.pending}>验证并继续<ArrowRight size={16} /></Submit>
          </fieldset>
        </form>
      </> : <button type="button" className="button primary-button wide" onClick={() => void begin()}>设置验证器</button>}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  </>;
}
