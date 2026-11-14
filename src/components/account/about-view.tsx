"use client";

import { dependencies, version } from "../../../package.json";
import { AppLink } from "@/components/ui/app-link";
import { Panel, Title } from "./ui";

// License identifiers come from the pinned packages' published metadata.
// The original license notices are preserved in public/third-party-notices.txt.
const openSource: { name: keyof typeof dependencies; license: string }[] = [
  { name: "@zitadel/client", license: "MIT" },
  { name: "@zitadel/proto", license: "MIT" },
  { name: "@bufbuild/protobuf", license: "Apache-2.0 AND BSD-3-Clause" },
  { name: "@connectrpc/connect", license: "Apache-2.0" },
  { name: "next", license: "MIT" },
  { name: "react", license: "MIT" },
  { name: "react-dom", license: "MIT" },
  { name: "@hookform/resolvers", license: "MIT" },
  { name: "react-hook-form", license: "MIT" },
  { name: "@phosphor-icons/react", license: "MIT" },
  { name: "@radix-ui/react-dialog", license: "MIT" },
  { name: "jose", license: "MIT" },
  { name: "qrcode.react", license: "ISC（内含 MIT 组件）" },
  { name: "zod", license: "MIT" },
];

export function AboutView() {
  const appVersion = (process.env.NEXT_PUBLIC_APP_VERSION || version).replace(/^v/, "");
  return <>
    <Title title="关于" description="项目信息与第三方开源协议。" />
    <Panel title="WY ID">
      <div className="prose">
        <p>项目链接：<a href="https://github.com/nhirsama/wyid" target="_blank" rel="noopener noreferrer">github.com/nhirsama/wyid</a></p>
        <p>版本号：<code>v{appVersion}</code></p>
      </div>
    </Panel>
    <Panel title="开源协议" description="本项目使用的 SDK 与直接运行时依赖。感谢以下开源项目。">
      <div className="prose"><p><AppLink href="/third-party-notices.txt" target="_blank" rel="noopener noreferrer">查看完整第三方开源协议与版权声明</AppLink></p></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">组件</th><th scope="col">版本</th><th scope="col">开源协议</th></tr></thead>
          <tbody>{openSource.map(({ name, license }) => <tr key={name}>
            <td><a className="app-name" href={`https://www.npmjs.com/package/${name}/v/${dependencies[name]}`} target="_blank" rel="noopener noreferrer">{name}</a></td>
            <td><code>{dependencies[name]}</code></td>
            <td>{license}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </Panel>
  </>;
}
