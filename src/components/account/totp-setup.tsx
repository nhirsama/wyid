"use client";

import { QRCodeSVG } from "qrcode.react";
import { CopyValue } from "./ui";

export function TotpSetup({ secret, uri }: { secret: string; uri: string }) {
  return <>
    <figure className="totp-qr">
      <QRCodeSVG value={uri} size={180} marginSize={4} bgColor="#ffffff" fgColor="#000000" role="img" title="TOTP 验证器绑定二维码" />
      <figcaption>使用验证器扫码添加，或手动复制下方密钥。</figcaption>
    </figure>
    <CopyValue label="TOTP 密钥" value={secret} secret />
    <CopyValue label="验证器 URI" value={uri} secret />
  </>;
}
