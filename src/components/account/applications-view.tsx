"use client";

import { AccountLink as Link } from "./navigation";
import { useAccountRouter as useRouter } from "./navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Browser, Code, MagnifyingGlass, Plus, Trash, X } from "@phosphor-icons/react";
import { api, cachedApiData, post, readApi } from "@/lib/account/api";
import {
  hasHttpUrl,
  validateApplicationInput,
  validateApplicationName,
  validateApplicationUrl,
  validateUriList,
  type UriListValidation,
} from "@/lib/account/application-validation";
import type { Application, ApplicationInput, ApplicationType } from "@/lib/account/types";
import { reactExample, serverExample } from "@/lib/account/integration";
import { CodeBlock, CopyValue, Field, Loading, Modal, Notice, Panel, Submit, TaskNotice, Title, formatDate, useTask } from "./ui";

type CreatedApplication = { application: Application; clientSecret?: string };
type UriRow = { id: string; value: string };
type CallbacksDraft = { redirectRows: UriRow[]; postLogoutRows: UriRow[]; dirty: boolean };
type SettingsDraft = { name: string; website: string; devMode: boolean; dirty: boolean };

let nextUriRowId = 1;
const createUriRow = (value = ""): UriRow => ({ id: `uri-${nextUriRowId++}`, value });
const toUriRows = (uris: readonly string[]): UriRow[] => uris.map(uri => createUriRow(uri));
const typeName = (type: ApplicationType) => type === "spa" ? "前端单页应用" : "有后端的网站";

function visibleFieldError(value: string, error: string | null, submitted: boolean) {
  return submitted || value.length > 0 ? error : null;
}

function visibleUriErrors(rows: readonly UriRow[], validation: UriListValidation, submitted: boolean) {
  return {
    items: rows.map((row, index) => (submitted || row.value.length > 0 ? validation.items[index] : null)),
    listError: submitted || rows.length > 50 ? validation.listError : null,
  };
}

function DevModeToggle({ checked, onChange, error }: { checked: boolean; onChange: (value: boolean) => void; error?: string | null }) {
  const id = useId();
  return (
    <div className="toggle-field">
      <label className="toggle-control" htmlFor={id}>
        <span className="toggle-label">
          <span>开发模式</span>
          {checked && <small>已允许 HTTP 地址</small>}
        </span>
        <span className="toggle-switch">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={e => onChange(e.target.checked)}
          />
          <span className="toggle-track" aria-hidden="true" />
        </span>
      </label>
      {error && <small id={`${id}-error`} className="field-error" role="alert">{error}</small>}
    </div>
  );
}

function Uris({
  label,
  rows,
  onChange,
  errors,
  listError,
  placeholder,
  required = false,
}: {
  label: string;
  rows: UriRow[];
  onChange: (rows: UriRow[]) => void;
  errors: (string | null)[];
  listError?: string | null;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <fieldset className="uri-fields">
      <legend>{label}</legend>
      {rows.map((row, index) => {
        const error = errors[index];
        return (
          <div className="uri-item" key={row.id}>
            <div className="uri-row">
              <input
                aria-label={`${label} ${index + 1}`}
                type="url"
                value={row.value}
                placeholder={placeholder}
                required={required}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${row.id}-error` : undefined}
                onChange={e => onChange(rows.map(item => item.id === row.id ? { ...item, value: e.target.value } : item))}
              />
              <button
                className="icon-button"
                type="button"
                aria-label={`删除${label} ${index + 1}`}
                disabled={required && rows.length <= 1}
                onClick={() => onChange(rows.filter(item => item.id !== row.id))}
              >
                <X size={17} />
              </button>
            </div>
            {error && <small id={`${row.id}-error`} className="field-error" role="alert">{error}</small>}
          </div>
        );
      })}
      <button className="small-button" type="button" onClick={() => onChange([...rows, createUriRow()])}>
        <Plus size={15} />添加地址
      </button>
      {listError && <small className="field-error" role="alert">{listError}</small>}
    </fieldset>
  );
}

export function Integration({ application, issuer }: { application: Application; issuer: string }) {
  return (
    <>
      <div className="config-grid">
        <CopyValue label="Issuer" value={issuer} />
        <CopyValue label="Client ID" value={application.clientId} />
        <CopyValue label="Discovery URL" value={`${issuer}/.well-known/openid-configuration`} />
        <CopyValue label="Scopes" value="openid profile email" />
      </div>
      <h3 className="section-label">{application.type === "spa" ? "React 接入示例" : "服务端接入"}</h3>
      <CodeBlock value={application.type === "spa" ? reactExample(application, issuer) : serverExample(application, issuer)} />
      <Link className="text-link" href="/help">查看完整接入流程 <ArrowRight size={15} /></Link>
    </>
  );
}

function CreateApplication({ issuer }: { issuer: string }) {
  const [step, setStep] = useState<"type" | "form" | "result">("type");
  const [type, setType] = useState<ApplicationType>("spa");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [devMode, setDevMode] = useState(false);
  const [redirectRows, setRedirectRows] = useState<UriRow[]>(() => [createUriRow()]);
  const [postLogoutRows, setPostLogoutRows] = useState<UriRow[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<CreatedApplication | null>(null);
  const task = useTask();

  const input: ApplicationInput = {
    name,
    website,
    type,
    devMode,
    redirectUris: redirectRows.map(row => row.value),
    postLogoutRedirectUris: postLogoutRows.map(row => row.value),
  };
  const validation = validateApplicationInput(input);
  const nameError = visibleFieldError(name, validation.name, submitted);
  const websiteError = visibleFieldError(website, validation.website, submitted);
  const redirectErrors = visibleUriErrors(redirectRows, validation.redirectUris, submitted);
  const postLogoutErrors = visibleUriErrors(postLogoutRows, validation.postLogoutRedirectUris, submitted);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (validation.hasErrors) return;
    task.run(async () => {
      const created = await post<CreatedApplication>("/apps", input);
      setResult(created);
      setStep("result");
    });
  }

  return (
    <>
      <Title title={step === "result" ? "应用已创建" : "创建应用"} description={step === "result" ? "将以下配置添加到你的网站。" : undefined}>
        <Link className="small-button" href="/apps"><ArrowLeft size={16} />我的应用</Link>
      </Title>
      <ol className="steps">
        {["选择接入方式", "填写信息", "获取配置"].map((label, i) => (
          <li key={label} className={i === ["type", "form", "result"].indexOf(step) ? "active" : ""}>
            <span>{i + 1}</span>{label}
          </li>
        ))}
      </ol>
      <TaskNotice task={task} />
      {step === "type" ? (
        <Panel title="选择接入方式">
          <div className="type-options">
            {(["spa", "web"] as const).map(option => (
              <button
                key={option}
                className={`type-option ${type === option ? "selected" : ""}`}
                aria-pressed={type === option}
                onClick={() => setType(option)}
              >
                {option === "spa" ? <Browser size={27} /> : <Code size={27} />}
                <strong>{typeName(option)}</strong>
                <span>{option === "spa" ? "React、Vue 等浏览器应用，使用 Client ID 和 PKCE。" : "由网站服务端交换授权码，服务端保管 Client Secret。"}</span>
              </button>
            ))}
          </div>
          <div className="form-actions">
            <button className="primary-button" onClick={() => setStep("form")}>下一步 <ArrowRight size={16} /></button>
          </div>
        </Panel>
      ) : step === "form" ? (
        <Panel title={typeName(type)}>
          <form method="post" noValidate className="form app-form" onSubmit={submit}>
            <fieldset disabled={task.busy} className="form-fieldset">
              <Field label="应用名称" error={nameError}>
                <input required value={name} onChange={e => setName(e.target.value)} placeholder="你的网站名称" />
              </Field>
              <Field label="网站来源地址" error={websiteError}>
                <input
                  type="url"
                  required
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                  placeholder={devMode ? "http://localhost:3000" : "https://your-site.example"}
                />
              </Field>
              <Uris
                label="登录回调地址"
                rows={redirectRows}
                onChange={setRedirectRows}
                errors={redirectErrors.items}
                listError={redirectErrors.listError}
                placeholder={devMode ? "http://localhost:3000/auth/callback" : "https://your-site.example/auth/callback"}
                required
              />
              <Uris
                label="退出后返回地址"
                rows={postLogoutRows}
                onChange={setPostLogoutRows}
                errors={postLogoutErrors.items}
                listError={postLogoutErrors.listError}
                placeholder={devMode ? "http://localhost:3000" : "https://your-site.example"}
              />
              <DevModeToggle checked={devMode} onChange={setDevMode} />
            </fieldset>
            <div className="form-actions">
              <button className="small-button" type="button" disabled={task.busy} onClick={() => { setStep("type"); task.clear(); }}>上一步</button>
              <Submit busy={task.busy}>创建应用</Submit>
            </div>
          </form>
        </Panel>
      ) : result && (
        <Panel title={result.application.name} description={typeName(result.application.type)}>
          {result.clientSecret && (
            <div className="secret-result">
              <Notice>将 Client Secret 保存到网站服务端的环境变量或密钥管理中。关闭此页后可通过重置生成新密钥。</Notice>
              <CopyValue label="Client Secret" value={result.clientSecret} secret />
            </div>
          )}
          <Integration application={result.application} issuer={issuer} />
          <div className="form-actions">
            <Link className="primary-button" href={`/apps/${result.application.id}`}>进入应用详情 <ArrowRight size={16} /></Link>
          </div>
        </Panel>
      )}
    </>
  );
}

function ApplicationList() {
  const [apps, setApps] = useState<Application[] | null>(() => cachedApiData<{ applications: Application[] }>("/apps")?.applications ?? null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    readApi<{ applications: Application[] }>("/apps", retry > 0)
      .then(result => { if (active) { setApps(result.applications); setError(""); } })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [retry]);
  const filtered = apps?.filter(app => `${app.name} ${app.website} ${app.clientId}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <Title title="我的应用"><Link className="primary-button" href="/apps/new"><Plus size={17} />创建应用</Link></Title>
      <section className="panel">
        {error ? (
          <div className="panel-body"><Notice kind="error">{error}</Notice><button className="small-button" onClick={() => setRetry(retry + 1)}>重新读取</button></div>
        ) : apps === null ? (
          <Loading />
        ) : apps.length === 0 ? (
          <div className="empty-state">
            <span><Browser size={31} /></span>
            <h2>创建你的第一个应用</h2>
            <p>取得接入配置，让你的网站使用统一账号登录。</p>
            <Link className="primary-button" href="/apps/new"><Plus size={17} />创建应用</Link>
          </div>
        ) : (
          <>
            <div className="records-toolbar">
              <label className="search"><MagnifyingGlass size={18} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label="搜索应用" placeholder="搜索名称、网址或 Client ID" /></label>
              <span>{filtered?.length} 个应用</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>应用</th><th>接入方式</th><th>状态</th><th>创建时间</th><th className="action-column">操作</th></tr></thead>
                <tbody>
                  {filtered?.map(app => (
                    <tr key={app.id}>
                      <td><Link className="app-name" href={`/apps/${app.id}`}>{app.name}</Link><small>{app.website}</small></td>
                      <td>{typeName(app.type)}</td>
                      <td>
                        <span className="status-tags">
                          <span className={`status-tag ${app.enabled ? "ok" : "pending"}`}>{app.enabled ? "已启用" : "已停用"}</span>
                          {app.devMode && <span className="status-tag warn">开发模式</span>}
                        </span>
                      </td>
                      <td className="date-cell">{formatDate(app.createdAt)}</td>
                      <td className="action-column"><Link className="small-button" href={`/apps/${app.id}`}>管理 <ArrowRight size={14} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered?.length === 0 && <div className="empty-state compact"><p>没有匹配的应用，请调整搜索内容。</p></div>}
          </>
        )}
      </section>
    </>
  );
}

function callbacksDraftFrom(app: Application): CallbacksDraft {
  return {
    redirectRows: app.redirectUris.length > 0 ? toUriRows(app.redirectUris) : [createUriRow()],
    postLogoutRows: toUriRows(app.postLogoutRedirectUris),
    dirty: false,
  };
}

function settingsDraftFrom(app: Application): SettingsDraft {
  return { name: app.name, website: app.website, devMode: Boolean(app.devMode), dirty: false };
}

function ApplicationDetail({ id, issuer }: { id: string; issuer: string }) {
  const router = useRouter();
  const [application, setApplication] = useState<Application | null>(
    () => cachedApiData<{ application: Application }>(`/apps/${encodeURIComponent(id)}`)?.application
      ?? cachedApiData<{ applications: Application[] }>("/apps")?.applications.find(app => app.id === id)
      ?? null,
  );
  const [callbacksDraft, setCallbacksDraft] = useState<CallbacksDraft | null>(() => application ? callbacksDraftFrom(application) : null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(() => application ? settingsDraftFrom(application) : null);
  const [callbacksSubmitted, setCallbacksSubmitted] = useState(false);
  const [settingsSubmitted, setSettingsSubmitted] = useState(false);
  const [tab, setTab] = useState("integration");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [modal, setModal] = useState<"delete" | "state" | "secret" | null>(null);
  const [secret, setSecret] = useState("");
  const task = useTask();
  const action = useTask();

  useEffect(() => {
    let active = true;
    readApi<{ application: Application }>(`/apps/${encodeURIComponent(id)}`, retry > 0)
      .then(result => {
        if (!active) return;
        setApplication(result.application);
        setCallbacksDraft(current => (!current || !current.dirty ? callbacksDraftFrom(result.application) : current));
        setSettingsDraft(current => (!current || !current.dirty ? settingsDraftFrom(result.application) : current));
        setError("");
      })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [id, retry]);

  if (error) {
    return (
      <>
        <Title title="应用详情" />
        <Notice kind="error">{error}</Notice>
        <button className="small-button" onClick={() => setRetry(retry + 1)}>重试</button>
        <Link className="text-link" href="/apps">返回我的应用</Link>
      </>
    );
  }
  if (!application || !callbacksDraft || !settingsDraft) return <Loading />;

  const app = application;
  const callbackHttpError = "未开启开发模式时仅支持 HTTPS 地址，请先在「应用设置」中开启开发模式。";
  const redirectValidation = validateUriList(
    callbacksDraft.redirectRows.map(row => row.value),
    { devMode: app.devMode, required: true, label: "登录回调地址", httpError: callbackHttpError },
  );
  const postLogoutValidation = validateUriList(
    callbacksDraft.postLogoutRows.map(row => row.value),
    { devMode: app.devMode, label: "退出后返回地址", httpError: callbackHttpError },
  );
  const redirectErrors = visibleUriErrors(callbacksDraft.redirectRows, redirectValidation, callbacksSubmitted);
  const postLogoutErrors = visibleUriErrors(callbacksDraft.postLogoutRows, postLogoutValidation, callbacksSubmitted);

  const settingsNameError = visibleFieldError(settingsDraft.name, validateApplicationName(settingsDraft.name), settingsSubmitted);
  const settingsWebsiteRawError = validateApplicationUrl(settingsDraft.website, { devMode: settingsDraft.devMode, originOnly: true });
  const settingsWebsiteError = visibleFieldError(settingsDraft.website, settingsWebsiteRawError, settingsSubmitted);
  const devModeConflict = !settingsDraft.devMode && hasHttpUrl([...app.redirectUris, ...app.postLogoutRedirectUris])
    ? "当前回调地址包含 HTTP 地址，请先在「回调地址」中改为 HTTPS 后再关闭开发模式。"
    : null;

  function saveCallbacks(e: FormEvent) {
    e.preventDefault();
    setCallbacksSubmitted(true);
    if (redirectValidation.hasErrors || postLogoutValidation.hasErrors || !callbacksDraft) return;
    task.run(async () => {
      const result = await api<{ application: Application }>(`/apps/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: app.name,
          website: app.website,
          type: app.type,
          devMode: app.devMode,
          redirectUris: callbacksDraft.redirectRows.map(row => row.value),
          postLogoutRedirectUris: callbacksDraft.postLogoutRows.map(row => row.value),
        }),
      });
      setApplication(result.application);
      setCallbacksDraft(callbacksDraftFrom(result.application));
      setCallbacksSubmitted(false);
    }, "回调地址已保存，请同步更新你的网站配置。");
  }

  function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsSubmitted(true);
    if (validateApplicationName(settingsDraft?.name ?? "") || settingsWebsiteRawError || devModeConflict || !settingsDraft) return;
    task.run(async () => {
      const result = await api<{ application: Application }>(`/apps/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: settingsDraft.name,
          website: settingsDraft.website,
          type: app.type,
          devMode: settingsDraft.devMode,
          redirectUris: app.redirectUris,
          postLogoutRedirectUris: app.postLogoutRedirectUris,
        }),
      });
      setApplication(result.application);
      setSettingsDraft(settingsDraftFrom(result.application));
      setSettingsSubmitted(false);
    }, "应用信息已保存。");
  }

  return (
    <>
      <Link className="back-link" href="/apps"><ArrowLeft size={15} />我的应用</Link>
      <Title title={app.name} description={`${typeName(app.type)} · ${app.website}`}>
        <div className="status-tags">
          <span className={`status-tag ${app.enabled ? "ok" : "pending"}`}>{app.enabled ? "已启用" : "已停用"}</span>
          {app.devMode && <span className="status-tag warn">开发模式</span>}
        </div>
      </Title>
      <div className="tabs" role="tablist" aria-label="应用详情">
        {[["integration", "接入配置"], ["callbacks", "回调地址"], ["settings", "应用设置"]].map(([value, label]) => (
          <button
            role="tab"
            id={`tab-${value}`}
            aria-controls="app-tab-panel"
            aria-selected={tab === value}
            className={tab === value ? "selected" : ""}
            key={value}
            onClick={() => { setTab(value); task.clear(); }}
          >
            {label}
          </button>
        ))}
      </div>
      <TaskNotice task={task} />
      <div id="app-tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "integration" ? (
          <Panel title="接入配置">
            <Integration application={app} issuer={issuer} />
            <h3 className="section-label">登录回调地址</h3>
            {app.redirectUris.map(uri => <CopyValue key={uri} label="Redirect URI" value={uri} />)}
            {app.postLogoutRedirectUris.length > 0 && (
              <>
                <h3 className="section-label">退出后返回地址</h3>
                {app.postLogoutRedirectUris.map(uri => <CopyValue key={uri} label="Post Logout Redirect URI" value={uri} />)}
              </>
            )}
          </Panel>
        ) : tab === "callbacks" ? (
          <Panel title="回调地址">
            <form method="post" noValidate className="form app-form" onSubmit={saveCallbacks}>
              <fieldset disabled={task.busy} className="form-fieldset">
                <Uris
                  label="登录回调地址"
                  rows={callbacksDraft.redirectRows}
                  onChange={rows => setCallbacksDraft({ ...callbacksDraft, redirectRows: rows, dirty: true })}
                  errors={redirectErrors.items}
                  listError={redirectErrors.listError}
                  placeholder={app.devMode ? "http://localhost:3000/auth/callback" : "https://your-site.example/auth/callback"}
                  required
                />
                <Uris
                  label="退出后返回地址"
                  rows={callbacksDraft.postLogoutRows}
                  onChange={rows => setCallbacksDraft({ ...callbacksDraft, postLogoutRows: rows, dirty: true })}
                  errors={postLogoutErrors.items}
                  listError={postLogoutErrors.listError}
                  placeholder={app.devMode ? "http://localhost:3000" : "https://your-site.example"}
                />
              </fieldset>
              <div className="form-actions"><Submit busy={task.busy}>保存回调地址</Submit></div>
            </form>
          </Panel>
        ) : (
          <>
            <Panel title="应用信息">
              <form method="post" noValidate className="form app-form" onSubmit={saveSettings}>
                <fieldset disabled={task.busy} className="form-fieldset">
                  <Field label="应用名称" error={settingsNameError}>
                    <input
                      required
                      value={settingsDraft.name}
                      onChange={e => setSettingsDraft({ ...settingsDraft, name: e.target.value, dirty: true })}
                    />
                  </Field>
                  <Field label="网站来源地址" error={settingsWebsiteError}>
                    <input
                      type="url"
                      required
                      value={settingsDraft.website}
                      onChange={e => setSettingsDraft({ ...settingsDraft, website: e.target.value, dirty: true })}
                      placeholder={settingsDraft.devMode ? "http://localhost:3000" : "https://your-site.example"}
                    />
                  </Field>
                  <DevModeToggle
                    checked={settingsDraft.devMode}
                    onChange={value => setSettingsDraft({ ...settingsDraft, devMode: value, dirty: true })}
                    error={devModeConflict}
                  />
                </fieldset>
                <div className="form-actions"><Submit busy={task.busy}>保存信息</Submit></div>
              </form>
            </Panel>
            <Panel title="应用操作">
              <div className="setting-row">
                <div><h3>{app.enabled ? "停用应用" : "启用应用"}</h3></div>
                <button className="small-button" onClick={() => { action.clear(); setModal("state"); }}>{app.enabled ? "停用" : "启用"}</button>
              </div>
              {app.type === "web" && (
                <div className="setting-row">
                  <div><h3>重置 Client Secret</h3></div>
                  <button className="small-button" onClick={() => { action.clear(); setModal("secret"); }}>重置密钥</button>
                </div>
              )}
              <div className="setting-row">
                <div><h3>删除应用</h3></div>
                <button className="danger-outline" onClick={() => { action.clear(); setModal("delete"); }}><Trash size={15} />删除</button>
              </div>
            </Panel>
          </>
        )}
      </div>
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === "delete" ? "删除应用？" : modal === "secret" ? "重置 Client Secret" : app.enabled ? "停用应用？" : "启用应用？"}
        description={
          modal === "delete"
            ? `将永久删除“${app.name}”及接入配置。`
            : modal === "secret"
              ? "新密钥生成后立即更新网站服务端，旧密钥的有效性以身份服务配置为准。"
              : app.enabled
                ? "停用后，此客户端将停止接受新登录请求。"
                : "启用后，此客户端将恢复接受登录请求。"
        }
        busy={action.busy}
      >
        <TaskNotice task={action} />
        <form
          method="post"
          className="form"
          onSubmit={e => {
            e.preventDefault();
            action.run(async () => {
              if (modal === "delete") {
                await api(`/apps/${id}`, { method: "DELETE", body: "{}" });
                router.push("/apps");
              } else if (modal === "state") {
                const result = await post<{ application: Application }>(`/apps/${id}/state`, { enabled: !app.enabled });
                setApplication(result.application);
              } else {
                const result = await post<{ clientSecret: string }>(`/apps/${id}/secret`, {});
                setSecret(result.clientSecret);
              }
              setModal(null);
            });
          }}
        >
          <div className="form-actions">
            <button className="small-button" type="button" disabled={action.busy} onClick={() => setModal(null)}>取消</button>
            <button className={modal === "delete" ? "danger-button" : "primary-button"} disabled={action.busy} type="submit">
              {action.busy ? "正在处理…" : "确认"}
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret("")} title="新 Client Secret" description="请将新密钥保存到网站服务端，关闭后可通过再次重置生成新的密钥。">
        <CopyValue label="Client Secret" value={secret} secret />
        <div className="form-actions"><button className="primary-button" onClick={() => setSecret("")}>完成</button></div>
      </Modal>
    </>
  );
}

export function ApplicationsView({ route, issuer }: { route: string; issuer: string }) {
  if (route === "/apps/new") return <CreateApplication issuer={issuer} />;
  if (route.startsWith("/apps/")) return <ApplicationDetail key={route} id={decodeURIComponent(route.slice(6))} issuer={issuer} />;
  return <ApplicationList />;
}
