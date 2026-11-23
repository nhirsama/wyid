import { describe, expect, it } from "vitest";
import {
  hasHttpUrl,
  validateApplicationInput,
  validateApplicationName,
  validateApplicationUrl,
  validateUriList,
} from "@/lib/account/application-validation";

describe("application shared validation", () => {
  it("validates application names", () => {
    expect(validateApplicationName("   ")).toBe("请输入应用名称。");
    expect(validateApplicationName("a".repeat(201))).toContain("200");
    expect(validateApplicationName("我的应用")).toBeNull();
  });

  it("enforces HTTPS unless devMode is enabled", () => {
    expect(validateApplicationUrl("http://localhost:3000", { devMode: false, originOnly: true })).toContain("未开启开发模式");
    expect(validateApplicationUrl("http://localhost:3000", { devMode: true, originOnly: true })).toBeNull();
    expect(validateApplicationUrl("http://192.168.1.5:8080/callback", { devMode: true })).toBeNull();
    expect(validateApplicationUrl("https://app.example.com/callback", { devMode: false })).toBeNull();
    expect(validateApplicationUrl("ftp://app.example.com", { devMode: true })).toContain("HTTPS 或 HTTP");
  });

  it("restricts website to origin-only while allowing a trailing slash", () => {
    expect(validateApplicationUrl("https://app.example.com", { devMode: false, originOnly: true })).toBeNull();
    expect(validateApplicationUrl("https://app.example.com/", { devMode: false, originOnly: true })).toBeNull();
    expect(validateApplicationUrl("https://app.example.com/login", { devMode: false, originOnly: true })).toContain("只需填写协议和域名");
    expect(validateApplicationUrl("https://app.example.com/?x=1", { devMode: false, originOnly: true })).toContain("只需填写协议和域名");
  });

  it("detects empty, invalid, and duplicate URI entries", () => {
    const emptyRequired = validateUriList([], { devMode: false, required: true, label: "登录回调地址" });
    expect(emptyRequired.hasErrors).toBe(true);
    expect(emptyRequired.listError).toContain("至少添加一条");

    const duplicates = validateUriList(
      ["https://app.example.com/cb", "https://app.example.com/cb", ""],
      { devMode: false, required: true, label: "登录回调地址" },
    );
    expect(duplicates.items).toEqual([null, "该地址与上方重复。", "请输入完整地址，或删除空白项。"]);
    expect(duplicates.hasErrors).toBe(true);
  });

  it("detects HTTP URLs for devMode disable conflict checks", () => {
    expect(hasHttpUrl(["https://app.example.com/cb"])).toBe(false);
    expect(hasHttpUrl(["https://app.example.com/cb", "http://localhost:3000/cb"])).toBe(true);
    expect(hasHttpUrl(["not-a-url"])).toBe(false);
  });

  it("validates complete application input consistently", () => {
    const prodOk = validateApplicationInput({
      name: "生产应用",
      website: "https://app.example.com",
      devMode: false,
      redirectUris: ["https://app.example.com/auth/callback"],
      postLogoutRedirectUris: ["https://app.example.com"],
    });
    expect(prodOk.hasErrors).toBe(false);

    const devConflict = validateApplicationInput({
      name: "本地应用",
      website: "http://localhost:3000",
      devMode: false,
      redirectUris: ["http://localhost:3000/auth/callback"],
      postLogoutRedirectUris: [],
    });
    expect(devConflict.hasErrors).toBe(true);
    expect(devConflict.website).toContain("未开启开发模式");
    expect(devConflict.redirectUris.items[0]).toContain("未开启开发模式");
  });
});
