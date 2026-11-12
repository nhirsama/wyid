"use client";
/* eslint-disable @next/next/no-img-element -- Display native ZITADEL assets and local file previews directly. */

import { useState } from "react";
import { avatarSource } from "@/lib/account/avatar";
import type { Account } from "@/lib/account/types";

export function Avatar({ account, size = 33, previewUrl }: { account: Pick<Account, "displayName" | "email" | "avatarUrl">; size?: number; previewUrl?: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  const src = previewUrl || avatarSource(account.avatarUrl);
  const name = account.displayName || account.email;
  return <span className="avatar" role="img" aria-label={previewUrl ? "所选头像预览" : `${name}的头像`} style={{ width: size, height: size, overflow: "hidden", flex: "none" }}>
    {src && src !== failedUrl ? <img src={src} alt="" width={size} height={size} style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} /> : Array.from(name)[0]?.toUpperCase() || "?"}
  </span>;
}
