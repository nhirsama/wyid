"use client";

import { useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Key } from "@phosphor-icons/react";
import {
  authLink, factorSchema, passwordHint, passwordMeetsPolicy, verifyEmailSchema, verifyTotpSchema,
  type ActionResult, type AuthContext, type Factor, type LoginPolicy,
} from "@/lib/auth";
import { authenticate, register as registerCredential } from "@/lib/webauthn";
import { AppLink } from "@/components/ui/app-link";
import { Feedback, Field, Notice, Submit, useAuthAction } from "@/components/ui/form";
import {
  beginFactor, changeLoginPassword, enrollOtpFactor, finishKeyEnrollment, finishTotpEnrollment,
  finishWebAuthnFactor, resendLoginEmail, resumeAuthentication, setEnrollmentPhone,
  startKeyEnrollment, startTotpEnrollment, verifyEnrollmentPhone, verifyFactor, verifyLoginEmail,
} from "@/server/actions";

type ContextProps = { context: AuthContext };
type MfaProps = ContextProps & { methods: Factor[] };
type CodeFactor = "totp" | "otpEmail" | "otpSms";

const factorLabels: Record<Factor, string> = {
  totp: "验证器动态码", u2f: "安全密钥（U2F）",
  otpEmail: "邮件验证码", otpSms: "短信验证码",
};
const keyNameSchema = z.object({ name: z.string().trim().min(1, "请输入设备名称。").max(100, "设备名称不能超过 100 个字符。") });
const phoneSchema = z.object({ phone: z.string().trim().min(1, "请输入手机号码。").max(100, "手机号码过长。") });
const passwordChangeSchema = z.object({
  password: z.string().min(1, "请输入新密码。").max(1024, "密码过长，请重新输入。"),
  confirmPassword: z.string().min(1, "请再次输入新密码。").max(1024, "密码过长，请重新输入。"),
}).refine(value => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "两次输入的密码不一致。" });

function isCodeFactor(method: Factor): method is CodeFactor {
  return method === "totp" || method === "otpEmail" || method === "otpSms";
}

// A synchronous lock also closes the gap before React renders the pending state.
// All redirects remain owned by useAuthAction, including the runtime BASE_PATH.
function useMfaAction() {
  const action = useAuthAction();
  const locked = useRef(false);
  const [showFeedback, setShowFeedback] = useState(false);
  function run(task: () => Promise<ActionResult>) {
    if (locked.current || action.pending) return;
    locked.current = true;
    setShowFeedback(true);
    action.run(async () => {
      try { return await task(); }
      finally { locked.current = false; }
    });
  }
  function clear() {
    if (locked.current || action.pending) return false;
    setShowFeedback(false);
    return true;
  }
  return { pending: action.pending, result: showFeedback ? action.result : null, run, clear };
}

function FactorChoice({ methods, method, pending, onChange }: {
  methods: Factor[]; method: Factor; pending: boolean; onChange: (method: Factor) => void;
}) {
  const id = useId();
  const choices = [...new Set(methods)];
  if (choices.length < 2) return null;
  return <div className="field">
    <label htmlFor={id}>选择验证方式</label>
    <select id={id} className="factor-choice" value={method} disabled={pending}
      onChange={event => onChange(event.target.value as Factor)}>
      {choices.map(item => <option key={item} value={item}>{factorLabels[item]}</option>)}
    </select>
  </div>;
}

function BackToLogin({ context }: ContextProps) {
  return <AppLink className="text-link centered" href={authLink("/login", context)}>返回登录</AppLink>;
}

function AuthenticationRecovery({ context, action }: ContextProps & { action: ReturnType<typeof useMfaAction> }) {
  if (!action.result || action.result.ok) return null;
  return <button type="button" className="button secondary-button wide" disabled={action.pending}
    onClick={() => action.run(() => resumeAuthentication(context))}>重新读取验证状态并继续验证</button>;
}

export function MfaVerificationForm({ context, methods: availableMethods }: MfaProps) {
  const methods = availableMethods.filter(method => factorSchema.safeParse(method).success);
  const [selected, setSelected] = useState<Factor>(methods[0] || "totp");
  const method = methods.includes(selected) ? selected : methods[0] || "totp";
  const action = useMfaAction();
  const form = useForm<{ code: string }>({
    resolver: zodResolver(method === "totp" ? verifyTotpSchema : verifyEmailSchema), defaultValues: { code: context.code || "" },
  });

  function selectMethod(next: Factor) {
    if (!methods.includes(next) || !action.clear()) return;
    setSelected(next);
    form.reset({ code: "" });
  }
  function verifyCode(input: { code: string }) {
    if (!isCodeFactor(method)) return;
    action.run(() => verifyFactor({ method, code: input.code }, context));
  }
  function verifyKey() {
    if (method !== "u2f") return;
    action.run(async () => {
      const challenge = await beginFactor({ method }, context);
      if (!challenge.ok) return challenge;
      if (!challenge.options) return { ok: false, message: "身份服务未返回设备验证请求，请重新开始。" };
      let credential;
      try { credential = await authenticate(challenge.options, method); }
      catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : "设备验证未能完成，请重试。" }; }
      return finishWebAuthnFactor(credential, context);
    });
  }
  function switchLabel(type: Factor) {
    return type === "totp" ? "使用两步验证码"
      : `使用${({ u2f: "安全密钥", otpEmail: "邮箱验证码", otpSms: "短信验证码" })[type]}`;
  }

  if (!methods.length) return <Notice kind="error">此登录会话没有可用的验证方式，请重新登录。</Notice>;
  return <>
    <Feedback result={action.result} />
    <AuthenticationRecovery context={context} action={action} />
    {isCodeFactor(method) ? <form method="post" className="form" noValidate onSubmit={form.handleSubmit(verifyCode)}>
      <p className="body-copy">{method === "totp" ? "打开你的验证器，输入当前动态验证码。" : method === "otpEmail" ? "点击邮件中的链接即可完成验证，也可以在此输入验证码。" : "请获取并填写短信验证码。"}</p>
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="验证码" registration={form.register("code")} error={form.formState.errors.code?.message}
          inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={method === "totp" ? 6 : 256} />
        <Submit pending={action.pending}>验证并继续</Submit>
        {method !== "totp" && <button className="text-link" type="button" disabled={action.pending}
          onClick={() => action.run(() => beginFactor({ method }, context))}>发送验证码</button>}
      </fieldset>
    </form> : <>
      <p className="body-copy">使用已绑定的安全密钥进行验证。</p>
      <button className="button primary-button" type="button" disabled={action.pending} onClick={verifyKey}>
        <Key size={20} />验证安全密钥
      </button>
    </>}
    {methods.length > 1 && <div className="auth-method-switch" aria-label="其他验证方式">
      {methods.filter(type => type !== method).map(type => <button type="button" key={type} className="text-link" disabled={action.pending}
        onClick={() => selectMethod(type)}>{switchLabel(type)}</button>)}
    </div>}
  </>;
}

export function MfaEnrollmentForm({ context, methods: availableMethods }: MfaProps) {
  const methods = availableMethods.filter(method => factorSchema.safeParse(method).success);
  const [selected, setSelected] = useState<Factor>(methods.includes("totp") ? "totp" : methods[0] || "totp");
  const method = methods.includes(selected) ? selected : methods[0] || "totp";
  const [setup, setSetup] = useState<{ uri: string; secret: string } | null>(null);
  const [keyOptions, setKeyOptions] = useState<Record<string, unknown>>();
  const [phoneStage, setPhoneStage] = useState<"existing" | "sending" | "sent" | "verified">("existing");
  const [sentPhone, setSentPhone] = useState("");
  const action = useMfaAction();
  const totp = useForm<{ code: string }>({ resolver: zodResolver(verifyTotpSchema), defaultValues: { code: "" } });
  const key = useForm<z.infer<typeof keyNameSchema>>({ resolver: zodResolver(keyNameSchema), defaultValues: { name: "" } });
  const phone = useForm<z.infer<typeof phoneSchema>>({ resolver: zodResolver(phoneSchema), defaultValues: { phone: "" } });
  const phoneCode = useForm<{ code: string }>({ resolver: zodResolver(verifyEmailSchema), defaultValues: { code: "" } });

  function selectMethod(next: Factor) {
    if (!methods.includes(next) || !action.clear()) return;
    setSelected(next); setKeyOptions(undefined); key.reset({ name: "" }); totp.reset({ code: "" });
  }
  function beginTotp() {
    action.run(async () => {
      const result = await startTotpEnrollment(context);
      if (!result.ok) return result;
      if (!result.uri || !result.secret) return { ok: false, message: "身份服务未返回完整的验证器设置，请重试。" };
      setSetup({ uri: result.uri, secret: result.secret });
      return { ...result, message: result.message || "请将密钥添加到验证器，再输入动态验证码。" };
    });
  }
  function enrollKey(input: { name: string }) {
    if (method !== "u2f") return;
    action.run(async () => {
      if (!keyOptions) {
        const result = await startKeyEnrollment({ method }, context);
        if (!result.ok) return result;
        if (!result.options) return { ok: false, message: "身份服务未返回设备注册请求，请重试。" };
        setKeyOptions(result.options);
        return { ...result, message: result.message || "注册请求已准备好，请继续绑定设备。" };
      }
      const challenge = keyOptions;
      setKeyOptions(undefined);
      let credential;
      try { credential = await registerCredential(challenge, method); }
      catch (cause) { return { ok: false, message: cause instanceof Error ? cause.message : "设备绑定未能完成，请重试。" }; }
      // Binding is not a session proof. The action redirects back to /verify.
      return finishKeyEnrollment({ method, name: input.name, credential }, context);
    });
  }
  function sendPhone(input: { phone: string }) {
    action.run(async () => {
      const previousStage = phoneStage;
      setPhoneStage("sending"); phoneCode.reset({ code: "" });
      try {
        const result = await setEnrollmentPhone(input, context);
        if (result.ok) { setSentPhone(input.phone); setPhoneStage("sent"); }
        else setPhoneStage(previousStage);
        return result;
      } catch (cause) {
        setPhoneStage(previousStage);
        throw cause;
      }
    });
  }
  function verifyPhone(input: { code: string }) {
    if (phoneStage !== "sent") return;
    action.run(async () => {
      const result = await verifyEnrollmentPhone(input, context);
      if (result.ok) setPhoneStage("verified");
      return result;
    });
  }
  function enrollOtp() {
    if (method !== "otpEmail" && method !== "otpSms") return;
    if (method === "otpSms" && phoneStage !== "existing" && phoneStage !== "verified") return;
    action.run(() => enrollOtpFactor({ method }, context));
  }

  if (!methods.length) return <div className="result-stack"><Notice kind="error">当前账号策略没有可设置的验证方式，请重新登录。</Notice><BackToLogin context={context} /></div>;
  return <div className="result-stack">
    <Notice>账号策略要求设置额外验证。绑定后仍需按照登录流程完成身份验证。</Notice>
    <FactorChoice methods={methods} method={method} pending={action.pending} onChange={selectMethod} />
    <Feedback result={action.result} />
    <AuthenticationRecovery context={context} action={action} />
    {method === "totp" && <>
      {!setup ? <button type="button" className="button primary-button wide" disabled={action.pending} aria-busy={action.pending}
        onClick={beginTotp}>获取验证器密钥</button> : <>
        <p className="field-hint">在支持 TOTP 的验证器中手动添加账号，复制密钥或导入完整 URI。</p>
        <label className="field"><span>验证器密钥</span><input value={setup.secret} readOnly autoComplete="off"
          autoCapitalize="none" spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
        <label className="field"><span>验证器 URI</span><input value={setup.uri} readOnly autoComplete="off"
          autoCapitalize="none" spellCheck={false} onFocus={event => event.currentTarget.select()} /></label>
        <form method="post" className="form" noValidate onSubmit={totp.handleSubmit(input => action.run(() => finishTotpEnrollment(input, context)))}>
          <fieldset disabled={action.pending} className="form-fieldset">
            <Field label="动态验证码" registration={totp.register("code")} error={totp.formState.errors.code?.message}
              autoComplete="one-time-code" inputMode="numeric" placeholder="000000" maxLength={6} className="otp-input" />
            <Submit pending={action.pending}>确认绑定并继续<ArrowRight size={16} aria-hidden="true" /></Submit>
          </fieldset>
        </form>
      </>}
    </>}
    {method === "u2f" && <>
      <p className="field-hint">绑定{factorLabels[method]}后，还需使用它完成本次登录验证。</p>
      <form method="post" className="form" noValidate onSubmit={key.handleSubmit(enrollKey)}>
        <fieldset disabled={action.pending} className="form-fieldset">
          <Field label="设备名称" registration={key.register("name")} error={key.formState.errors.name?.message}
            autoComplete="off" placeholder="例如：随身安全密钥" maxLength={100} />
          <Submit pending={action.pending}><Key size={20} aria-hidden="true" />{keyOptions ? "绑定设备并继续验证" : "准备绑定设备"}</Submit>
        </fieldset>
      </form>
    </>}
    {(method === "otpEmail" || method === "otpSms") && <>
      <p className="field-hint">启用{factorLabels[method]}后，继续获取登录验证码。</p>
      {method === "otpSms" && <>
        <p className="field-hint">已有已验证的手机号码可以直接启用。首次设置或更换号码，请先发送短信并验证手机号码。</p>
        <form method="post" className="form" noValidate onSubmit={phone.handleSubmit(sendPhone)}>
          <fieldset disabled={action.pending} className="form-fieldset">
            <Field label="手机号码" type="tel" registration={phone.register("phone")} error={phone.formState.errors.phone?.message}
              autoComplete="tel" placeholder="+8613800138000" maxLength={100} hint="请填写包含国家区号的完整号码，例如 +8613800138000。" />
            <Submit pending={action.pending}>{phoneStage === "sent" ? "重新发送手机验证短信" : "发送手机验证短信"}</Submit>
          </fieldset>
        </form>
        {phoneStage === "sent" && <form method="post" className="form" noValidate onSubmit={phoneCode.handleSubmit(verifyPhone)}>
          <fieldset disabled={action.pending} className="form-fieldset">
            <Field label="手机验证短信中的验证码" registration={phoneCode.register("code")} error={phoneCode.formState.errors.code?.message}
              inputMode="numeric" autoComplete="one-time-code" placeholder="输入手机验证码" maxLength={256}
              hint={`请输入发送至 ${sentPhone} 的验证码。此验证码仅用于验证手机号码。`} />
            <Submit pending={action.pending}>验证手机号码</Submit>
          </fieldset>
        </form>}
        {phoneStage === "verified" && <Notice kind="success">手机号码已验证，可以启用短信登录验证。</Notice>}
      </>}
      <button type="button" className="button primary-button wide" disabled={action.pending || (method === "otpSms" && phoneStage !== "existing" && phoneStage !== "verified")}
        aria-busy={action.pending} onClick={enrollOtp}>启用{factorLabels[method]}并继续<ArrowRight size={16} aria-hidden="true" /></button>
    </>}
    <BackToLogin context={context} />
  </div>;
}

export function LoginEmailVerificationForm({ context }: ContextProps) {
  const action = useMfaAction();
  const [sent, setSent] = useState(false);
  const form = useForm<{ code: string }>({ resolver: zodResolver(verifyEmailSchema), defaultValues: { code: context.code || "" } });
  function send() {
    action.run(async () => {
      const result = await resendLoginEmail(context);
      if (result.ok) setSent(true);
      return result;
    });
  }
  return <div className="result-stack">
    <Notice>请验证账号邮箱，然后继续本次登录。可以打开验证邮件中的链接，也可以输入邮件中的验证码。</Notice>
    <Feedback result={action.result} />
    <AuthenticationRecovery context={context} action={action} />
    <form method="post" className="form" noValidate onSubmit={form.handleSubmit(input => action.run(() => verifyLoginEmail(input, context)))}>
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="邮箱验证码" registration={form.register("code")} error={form.formState.errors.code?.message}
          defaultValue={context.code || ""} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} placeholder="输入邮件中的验证码" maxLength={256} />
        <Submit pending={action.pending}>验证邮箱并继续<ArrowRight size={16} aria-hidden="true" /></Submit>
      </fieldset>
    </form>
    <button type="button" className="text-link centered" disabled={action.pending} onClick={send}>{sent ? "重新发送验证邮件" : "发送验证邮件"}</button>
    <BackToLogin context={context} />
  </div>;
}

export function LoginPasswordChangeForm({ context, policy }: ContextProps & { policy: LoginPolicy }) {
  const action = useMfaAction();
  const form = useForm<z.infer<typeof passwordChangeSchema>>({
    resolver: zodResolver(passwordChangeSchema), defaultValues: { password: "", confirmPassword: "" },
  });
  function submit(input: z.infer<typeof passwordChangeSchema>) {
    if (!passwordMeetsPolicy(input.password, policy.passwordPolicy)) {
      form.setError("password", { message: `密码不符合要求：${passwordHint(policy.passwordPolicy)}。` });
      return;
    }
    action.run(() => changeLoginPassword(input, context));
  }
  return <div className="result-stack">
    <Notice>请更新账号密码，然后继续本次登录。</Notice>
    <form method="post" className="form" noValidate onSubmit={form.handleSubmit(submit)}>
      <Feedback result={action.result} />
      <AuthenticationRecovery context={context} action={action} />
      <fieldset disabled={action.pending} className="form-fieldset">
        <Field label="新密码" type="password" registration={form.register("password")} error={form.formState.errors.password?.message}
          autoComplete="new-password" hint={`密码要求：${passwordHint(policy.passwordPolicy)}。`} maxLength={1024} />
        <Field label="确认新密码" type="password" registration={form.register("confirmPassword")} error={form.formState.errors.confirmPassword?.message}
          autoComplete="new-password" placeholder="再次输入新密码" maxLength={1024} />
        <Submit pending={action.pending}>更新密码并继续<ArrowRight size={16} aria-hidden="true" /></Submit>
      </fieldset>
    </form>
    <BackToLogin context={context} />
  </div>;
}

export function ContinueAuthenticationForm({ context }: ContextProps) {
  const action = useMfaAction();
  return <div className="result-stack">
    <Notice>继续读取当前登录步骤，下一步由账号服务确认。</Notice>
    <form method="post" className="form" onSubmit={event => { event.preventDefault(); action.run(() => resumeAuthentication(context)); }}>
      <Feedback result={action.result} />
      <Submit pending={action.pending}>继续登录<ArrowRight size={16} aria-hidden="true" /></Submit>
    </form>
    <BackToLogin context={context} />
  </div>;
}
