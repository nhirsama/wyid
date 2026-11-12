const scopeDescriptions: Record<string, { name: string; description: string }> = {
  openid: { name: "账号标识", description: "用于在该网站识别你的账号。" },
  profile: { name: "基本资料", description: "昵称、姓名、头像及其他基本资料。" },
  email: { name: "邮箱", description: "邮箱地址及邮箱验证状态。" },
  phone: { name: "手机号", description: "手机号码及手机验证状态。" },
  address: { name: "地址", description: "账号中的地址资料。" },
  offline_access: { name: "离线访问", description: "网站可在你离线时继续使用获准的访问权限。" },
};

const projectRoleScopePrefix = "urn:zitadel:iam:org:project:role:";

export function consentScopes(scopes: string[]) {
  // Project settings can add role scopes upstream. Omit them from the display
  // only; the original request must retain all scopes for consent validation.
  return [...new Set(scopes)].filter(scope => !scope.startsWith(projectRoleScopePrefix)).map(scope => ({
    scope,
    ...(Object.hasOwn(scopeDescriptions, scope)
      ? scopeDescriptions[scope]
      : { name: "其他请求权限", description: "此网站请求的额外权限。" }),
  }));
}
