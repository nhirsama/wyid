import type { ApplicationInput } from "./types";

const MAX_NAME_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_URI_COUNT = 50;
const UNSAFE_URL_CHARS = /[\\\u0000-\u0020\u007f]/;

export type ApplicationUrlOptions = {
  devMode: boolean;
  originOnly?: boolean;
  httpError?: string;
};

export function validateApplicationName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "请输入应用名称。";
  if (trimmed.length > MAX_NAME_LENGTH) return `应用名称最多 ${MAX_NAME_LENGTH} 个字符。`;
  return null;
}

export function validateApplicationUrl(value: string, options: ApplicationUrlOptions): string | null {
  if (!value) return "请输入完整的网址。";
  if (value.length > MAX_URL_LENGTH) return `网址长度不能超过 ${MAX_URL_LENGTH} 个字符。`;
  // Validate raw text BEFORE URL parsing: WHATWG URL parsing strips control chars / newlines.
  if (UNSAFE_URL_CHARS.test(value)) return "网址不能包含空白或控制字符。";

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return options.devMode ? "请输入完整的网址（包含 https:// 或 http://）。" : "请输入完整的 HTTPS 网址。";
  }

  if (parsed.protocol === "http:") {
    if (!options.devMode) {
      return options.httpError || "未开启开发模式时仅支持 HTTPS 地址。";
    }
  } else if (parsed.protocol !== "https:") {
    return options.devMode ? "仅支持 HTTPS 或 HTTP 地址。" : "仅支持 HTTPS 地址。";
  }

  if (!parsed.hostname) return "请输入有效的域名或主机地址。";
  if (parsed.username || parsed.password) return "网址不能包含账号或密码。";
  if (parsed.hash || value.includes("#")) return "网址不能包含 # 片段。";

  if (options.originOnly) {
    if (parsed.search || value.includes("?") || (parsed.pathname && parsed.pathname !== "/")) {
      return options.devMode
        ? "网站来源地址只需填写协议和域名，例如 http://localhost:3000。"
        : "网站来源地址只需填写协议和域名，例如 https://your-site.example。";
    }
  }

  return null;
}

export function hasHttpUrl(urls: readonly string[]): boolean {
  return urls.some(value => {
    try {
      return new URL(value).protocol === "http:";
    } catch {
      return false;
    }
  });
}

export type UriListValidation = {
  items: (string | null)[];
  listError: string | null;
  hasErrors: boolean;
};

export function validateUriList(
  values: readonly string[],
  options: { devMode: boolean; required?: boolean; label: string; httpError?: string },
): UriListValidation {
  let listError: string | null = null;
  if (options.required && values.length === 0) {
    listError = `请至少添加一条${options.label}。`;
  } else if (values.length > MAX_URI_COUNT) {
    listError = `${options.label}最多 ${MAX_URI_COUNT} 条。`;
  }

  const seen = new Set<string>();
  const items = values.map(value => {
    if (!value) return "请输入完整地址，或删除空白项。";
    const error = validateApplicationUrl(value, { devMode: options.devMode, httpError: options.httpError });
    if (error) return error;
    if (seen.has(value)) return "该地址与上方重复。";
    seen.add(value);
    return null;
  });

  return {
    items,
    listError,
    hasErrors: Boolean(listError) || items.some(Boolean),
  };
}

export type ApplicationValidationResult = {
  name: string | null;
  website: string | null;
  redirectUris: UriListValidation;
  postLogoutRedirectUris: UriListValidation;
  hasErrors: boolean;
};

export function validateApplicationInput(input: Pick<ApplicationInput, "name" | "website" | "devMode" | "redirectUris" | "postLogoutRedirectUris">): ApplicationValidationResult {
  const name = validateApplicationName(input.name);
  const website = validateApplicationUrl(input.website, { devMode: input.devMode, originOnly: true });
  const redirectUris = validateUriList(input.redirectUris, { devMode: input.devMode, required: true, label: "登录回调地址" });
  const postLogoutRedirectUris = validateUriList(input.postLogoutRedirectUris, { devMode: input.devMode, label: "退出后返回地址" });
  return {
    name,
    website,
    redirectUris,
    postLogoutRedirectUris,
    hasErrors: Boolean(name || website || redirectUris.hasErrors || postLogoutRedirectUris.hasErrors),
  };
}
