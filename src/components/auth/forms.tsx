"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Fingerprint } from "@phosphor-icons/react";
import {
  authLink, canRegisterWithPassword, forgotPasswordSchema, loginSchema, passwordHint, passwordMeetsPolicy, registerSchema,
  resetPasswordSchema, verifyEmailSchema, type AuthContext, type LoginPolicy,
  type ForgotPasswordInput, type LoginInput, type RegisterInput, type ResetPasswordInput, type VerifyEmailInput,
} from "@/lib/auth";
import { loginWithPasskey } from "@/lib/passkey-login";
import { AppLink } from "@/components/ui/app-link";
import { chooseIdentityProvider, login, register, requestPasswordReset, resendEmail, resetPassword, verifyEmail } from "@/server/actions";
import { Feedback, Field, Notice, Submit, useAuthAction } from "@/components/ui/form";

type Props = { context: AuthContext; policy: LoginPolicy };

function useWebAuthnLogin(context: AuthContext) {
  const action = useAuthAction();
  function begin() { action.run(() => loginWithPasskey(context)); }
  return { pending: action.pending, error: action.result && !action.result.ok ? action.result.message : null,
    message: action.result?.ok ? action.result.message : undefined, begin };
}

export function LoginForm({ context, policy }: Props) {
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { loginName: context.loginHint || "", password: "" } });
  const action = useAuthAction();
  const webauthn = useWebAuthnLogin(context);
  const hasAlternatives = policy.passkey || policy.identityProviders.length > 0;
  return <>
    <form method="post" className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => login(input, context)))}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending || webauthn.pending} className="form-fieldset">
        {(policy.password || policy.passkey) && <Field label="邮箱或用户名" registration={form.register("loginName")} error={form.formState.errors.loginName?.message}
          autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={320} />}
        {policy.password && <>
          <Field label="密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message}
            autoComplete="current-password" maxLength={1024} />
          <div className="form-links"><AppLink href={authLink("/forgot-password", context)}>忘记密码？</AppLink></div>
          <Submit pending={action.pending}>登录</Submit>
        </>}
      </fieldset>
    </form>
    {hasAlternatives && policy.password && <div className="method-divider"><span>其他登录方式</span></div>}
    {(hasAlternatives || (action.result?.ok && action.result.form)) && <div className="auth-methods">
      {webauthn.error && <div className="form-feedback"><Notice kind="error">{webauthn.error}</Notice></div>}
      {webauthn.message && <div className="form-feedback"><Notice kind="success">{webauthn.message}</Notice></div>}
      {policy.passkey && <button type="button" className="button secondary-button wide" disabled={webauthn.pending || action.pending}
        onClick={() => webauthn.begin()}><Fingerprint size={20} aria-hidden="true" />使用通行密钥登录</button>}
      {policy.identityProviders.map(provider => <button type="button" key={provider.id} className="button secondary-button wide" disabled={action.pending || webauthn.pending}
        onClick={() => action.run(() => chooseIdentityProvider({ id: provider.id }, context))}>使用 {provider.name} 登录<ArrowRight size={16} aria-hidden="true" /></button>)}
      {action.result?.ok && action.result.form && <form method="post" action={action.result.form.action} className="form">
        {Object.entries(action.result.form.fields).map(([name, value]) => <input type="hidden" key={name} name={name} value={value} />)}
        <Submit pending={false}>继续身份提供方登录</Submit>
      </form>}
    </div>}
    {canRegisterWithPassword(policy) && <p className="auth-switch">还没有账号？<AppLink href={authLink("/register", context)}>创建账号</AppLink></p>}
  </>;
}

export function RegisterForm({ context, policy }: Props) {
  const form = useForm<RegisterInput>({ resolver: zodResolver(registerSchema), defaultValues: { username: "", email: "", password: "", confirmPassword: "" } });
  const action = useAuthAction();
  function submit(input: RegisterInput) {
    if (!passwordMeetsPolicy(input.password, policy.passwordPolicy)) { form.setError("password", { message: `密码不符合要求：${passwordHint(policy.passwordPolicy)}。` }); return; }
    action.run(() => register(input, context));
  }
  if (action.result?.ok && action.result.message) return <div className="result-stack"><Notice kind="success">{action.result.message}</Notice><AppLink className="button primary-button wide" href={action.result.redirect || authLink("/login", context)}>继续<ArrowRight size={16} /></AppLink></div>;
  return <>
    <form method="post" className="form" noValidate onSubmit={form.handleSubmit(submit)}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="用户名" registration={form.register("username")} error={form.formState.errors.username?.message} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="输入用户名" maxLength={100} />
        <Field label="邮箱" type="email" registration={form.register("email")} error={form.formState.errors.email?.message} autoComplete="email" placeholder="you@example.com" maxLength={320} />
        <Field label="密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message} autoComplete="new-password" hint={`密码${passwordHint(policy.passwordPolicy)}。`} maxLength={1024} />
        <Field label="确认密码" type="password" registration={form.register("confirmPassword")} error={form.formState.errors.confirmPassword?.message} autoComplete="new-password" placeholder="再次输入密码" maxLength={1024} />
        <Submit pending={action.pending}>创建账号<ArrowRight size={16} aria-hidden="true" /></Submit>
      </fieldset>
    </form>
    <p className="auth-switch">已有账号？<AppLink href={authLink("/login", context)}>前往登录</AppLink></p>
  </>;
}

export function ForgotPasswordForm({ context }: { context: AuthContext }) {
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { loginName: context.loginHint || "" } });
  const action = useAuthAction();
  if (action.result?.ok) return <div className="result-stack"><Notice kind="success">{action.result.message}</Notice><AppLink className="button secondary-button wide" href={authLink("/login", context)}>返回登录</AppLink></div>;
  return <form method="post" className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => requestPasswordReset(input, context)))}>
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
    <form method="post" className="form" noValidate onSubmit={form.handleSubmit(submit)}>
      <Feedback result={action.result} />
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="邮件验证码" registration={form.register("code")} error={form.formState.errors.code?.message} autoComplete="one-time-code" placeholder="输入邮件中的验证码" maxLength={256} />
        <Field label="新密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message} autoComplete="new-password" hint={`密码${passwordHint(policy.passwordPolicy)}。`} maxLength={1024} />
        <Field label="确认新密码" type="password" registration={form.register("confirmPassword")} error={form.formState.errors.confirmPassword?.message} autoComplete="new-password" placeholder="再次输入密码" maxLength={1024} />
        <Submit pending={action.pending} disabled={!context.userId}>保存新密码</Submit>
      </fieldset>
    </form>
    {action.result?.ok && <p className="capability-note">{action.result.message} <AppLink href={authLink("/login", context)}>前往登录</AppLink></p>}
  </>;
}

export function VerifyEmailForm({ context }: { context: AuthContext }) {
  const form = useForm<VerifyEmailInput>({ resolver: zodResolver(verifyEmailSchema), defaultValues: { code: context.code || "" } });
  const action = useAuthAction();
  const resend = useAuthAction();
  if (action.result?.ok) return <div className="result-stack"><Notice kind="success">{action.result.message}</Notice><AppLink className="button primary-button wide" href={authLink("/login", context)}>继续登录<ArrowRight size={16} /></AppLink></div>;
  return <>
    {!context.userId && <Notice kind="error">验证邮件链接缺少账号标识，请重新打开邮件中的链接。</Notice>}
    <form method="post" className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => verifyEmail(input, context)))}>
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
