# ZITADEL 登录界面

基于 Next.js App Router 与官方 `@zitadel/client`、`@zitadel/proto` 的自托管登录站点。可直接打开 `/login` 使用 ZITADEL 账号登录；如果由 OIDC 应用携带授权请求进入，则验证完成后通过 ZITADEL 回调返回该应用。账号与认证策略由 ZITADEL 管理，本站不另建认证数据库。

## 启动

```sh
pnpm install
cp .env.example .env.local
# 填写 .env.local 中的 ZITADEL_API_URL、服务账号 PAT（直接填写或配置 token 文件）和 SESSION_SECRET
pnpm dev
```

默认站点昵称为“账号中心”，图标为空。可通过 `SITE_NICKNAME`、`SITE_ICON` 配置。

## ZITADEL 配置

服务端环境变量：

| 变量 | 用途 |
| --- | --- |
| `APP_URL` | 此登录站点的公开 Origin；用于邮件链接、Passkey RP ID 和身份提供方回调 |
| `BASE_PATH` | 站点基本路径，默认 `/`；例如 `/auth`，也支持 `/account/login-ui` 多级路径 |
| `ZITADEL_API_URL` | ZITADEL API 来源地址，不含路径；容器网络可配置为 `http://zitadel:8080` |
| `ZITADEL_EXTERNALDOMAIN` | ZITADEL 实例的公开域名，不带协议或路径；API 走内部 HTTP 时用于设置公开 Host 和实例识别请求头 |
| `CUSTOM_REQUEST_HEADERS` | 可选的额外/覆盖 API 请求头，格式为 `Header:Value,Header:Value`；例如 `Host:id.example.com,X-Forwarded-Proto:https` |
| `ZITADEL_SERVICE_TOKEN` | 服务账号 PAT；可直接填写，或使用下方文件变量挂载 |
| `ZITADEL_SERVICE_USER_TOKEN_FILE` | 服务账号 PAT 文件路径；设置后优先于 `ZITADEL_SERVICE_TOKEN`，适用于挂载 Docker/Kubernetes Secret |
| `SESSION_SECRET` | 至少 32 字符的独立随机密钥，用于 AES-GCM 加密会话数据；与 Cookie 的 `HttpOnly` 属性无关 |
| `ZITADEL_ORGANIZATION_ID` | 可选默认组织；授权请求带有 `urn:zitadel:iam:org:id:` scope 时采用请求对应的组织策略 |
| `SITE_NICKNAME` | 站点展示昵称 |
| `SITE_ICON` | 站点图标的本站路径或 HTTP(S) 图片地址 |

直接访问 `/login` 会建立 ZITADEL Session，并进入本站 `/account`；该站点以加密 HttpOnly Cookie 保存短期 Session 凭据，并在访问账号页时向 ZITADEL 校验 Session。也可以将 ZITADEL 的登录 UI 配置为本站：业务应用使用 OIDC Authorization Code + PKCE 流程时，本站从授权请求 ID 读取登录提示和请求上下文，并通过 ZITADEL 的 CreateCallback 继续授权。OIDC 回跳地址由 ZITADEL 决定，浏览器不可自行指定。

令牌只在服务端使用。待完成验证的 Session ID、Session Token 与可用验证因素使用短期 AES-GCM 加密 HttpOnly Cookie 保存；OIDC 登录成功后由 ZITADEL 原生回调返回业务应用，直接登录则将 ZITADEL Session 凭据保存于加密 HttpOnly Cookie，并可从账号页退出以撤销该 Session。

### 部署到子路径

```dotenv
APP_URL=https://example.com
BASE_PATH=/auth
```

配置后入口为 `/auth/login`，账号页为 `/auth/account`。站内跳转、MFA、邮件验证和密码重置链接、身份提供方回调、静态资源均使用该前缀；ZITADEL 与外部业务应用的回跳地址保持原样。本地 `SITE_ICON=/icon.svg` 对应 `/auth/icon.svg`，无需手动重复填写前缀。

`APP_URL` 仍只填写 Origin，不包含路径。未设置 `BASE_PATH` 或设为 `/` 时，行为与根路径部署一致。`BASE_PATH` 在服务启动前从运行环境读取，改动后重启服务/容器即可，不需要重新构建镜像或 Next.js 产物。反向代理应将带完整前缀的请求转发给本站，不要剥离前缀；ZITADEL 中配置的登录 UI 和回调地址也应使用带前缀的公开地址。

## Docker / GHCR

推送 Git tag（例如 `v1.2.3`）会自动构建并发布 `linux/amd64` 与 `linux/arm64` 镜像到 `ghcr.io/<owner>/<repository>`，并生成对应版本标签和 `latest` 标签。运行时通过环境变量或 `--env-file` 提供上述配置（包括 `BASE_PATH`），不要将 `.env` 文件复制进镜像。启动脚本会在启动 Next.js 前读取并校验 `BASE_PATH`，只改运行环境并重启容器即可切换路径，不需要重新构建镜像。`ZITADEL_API_URL` 可使用 Docker 网络中的服务地址，`ZITADEL_EXTERNALDOMAIN` 提供公开域名供 ZITADEL 识别实例；服务账号 PAT 可只读挂载到容器并由 `ZITADEL_SERVICE_USER_TOKEN_FILE` 指向。

```sh
docker run --rm --network <zitadel-network> -p 3000:3000 \
  --env-file .env.local \
  --mount type=bind,src=/secure/zitadel-service-user-token,dst=/run/secrets/zitadel-service-user-token,readonly \
  -e ZITADEL_SERVICE_USER_TOKEN_FILE=/run/secrets/zitadel-service-user-token \
  ghcr.io/<owner>/<repository>:v1.2.3
```

容器网络中，`.env.local` 可配置 `ZITADEL_API_URL=http://zitadel:8080` 和 `ZITADEL_EXTERNALDOMAIN=id.example.com`。如果使用 `CUSTOM_REQUEST_HEADERS`，它会覆盖同名的自动生成请求头；挂载的 token 文件优先于 `ZITADEL_SERVICE_TOKEN`。

## 功能

- 邮箱或用户名 + 密码登录；从 OIDC AuthRequest 读取登录提示与授权上下文。
- 依 ZITADEL Login Settings 提供注册、密码重置、Passkey、身份提供方及可用性状态。
- 依账号已有因素处理 TOTP、邮箱 OTP、短信 OTP 和 U2F/WebAuthn 验证；挑战、会话令牌轮换及验证结果由 ZITADEL 校验。
- MFA 策略要求但账号尚未登记验证器时，可在待完成登录流程内登记 TOTP 后继续验证。
- 身份提供方按组织配置显示；新账号由策略自动创建或在创建前明确确认。
- 依 Password Complexity Settings 校验注册与重置密码；账号操作通过 ZITADEL UserService 完成。
- 发送密码重置与邮箱验证通知；密码重置请求对外使用一致响应，避免泄露账号是否存在。
- 使用官方 SDK 与安装版本的 protobuf schema；登录动作再次验证表单并映射上游错误，不通过模拟响应代替上游认证。
- 品牌配置仅为站点昵称与站点图标。中文本地字体、窄屏布局、键盘访问、表单反馈和错误页使用轻量登录卡片设计。

没有服务配置时，页面会直接显示缺失的服务端配置名称，不会返回模拟登录成功。

## 目录

```text
src/app/(auth)/       登录、注册、密码重置、因素验证路由
src/app/idp/callback/ 身份提供方回调
src/components/auth/ 品牌外壳与认证表单
src/components/ui/   可访问的字段、反馈与提交组件
src/lib/             表单 schema、授权上下文、品牌与 WebAuthn JSON 转换
src/server/          服务端配置、Session Cookie、Server Actions
src/server/zitadel/  官方 SDK Transport、ZITADEL 服务适配
tests/                单元与配置测试
```

## 验证

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

端到端测试会先加载 `.env.local`；没有服务配置时验证配置错误页，配置齐全时需要可访问的 ZITADEL 测试实例与服务账号。若要覆盖 OIDC 回调，还需提供有效的 `ZITADEL_TEST_AUTH_REQUEST_ID`。
