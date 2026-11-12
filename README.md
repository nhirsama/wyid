# 生产部署

## 1. 配置 ZITADEL

1. 在账号所属组织创建服务账号，授予实例角色 `IAM_LOGIN_CLIENT` 和组织角色 `ORG_OWNER`，生成 PAT。
2. 按需配置该组织的注册、邮件、短信、登录与 MFA 策略。
3. 将 ZITADEL Login V2 Base URI 设为 `https://<登录域名>/<基本路径>`。
4. 准备服务账号 PAT 文件，并按下表创建部署环境变量文件 `.env.production`：

| 变量 | 必填 | 配置值或说明 |
| --- | --- | --- |
| `APP_URL` | 是 | 登录站点公开 Origin，例如 `https://login.example.com`。 |
| `BASE_PATH` | 否 | 站点基本路径，默认为 `/`；子路径示例 `/auth`。启动时读取，修改后重启容器生效，无需重新构建镜像。 |
| `SITE_NICKNAME` | 否 | 站点名称，例如 `WY CI`。 |
| `SITE_ICON` | 否 | 图标路径或 HTTPS 图片地址，例如 `/icon.svg`。 |
| `ZITADEL_API_URL` | 是 | ZITADEL API Origin；同一 Docker 网络可使用内部地址，例如 `http://zitadel:8080`。 |
| `ZITADEL_EXTERNALDOMAIN` | 内部 API 时必填 | ZITADEL 对外主机名，不带协议或路径，例如 `id.example.com`。 |
| `ZITADEL_SERVICE_USER_TOKEN_FILE` | 二选一 | 容器内 PAT 文件路径，例如 `/run/secrets/zitadel-service-user-token`；推荐挂载密钥文件。 |
| `ZITADEL_SERVICE_TOKEN` | 二选一 | 直接配置服务账号 PAT；与文件路径二选一，文件路径优先。 |
| `SESSION_SECRET` | 是 | 独立随机密钥，使用 `openssl rand -base64 32` 生成。 |
| `ZITADEL_ORGANIZATION_ID` | 否 | 默认组织 ID；Authorization Request 含组织 scope 时以 scope 为准。 |
| `ZITADEL_SKIP_CONSENT_PROJECT_IDS` | 否 | 免授权确认的 ZITADEL Project ID，多个 ID 用逗号分隔。 |
| `CUSTOM_REQUEST_HEADERS` | 否 | 额外请求头，格式为 `Header:Value,Header:Value`；其中 `Host` 仅用于生成 ZITADEL 实例定位头，不直接发送，避免 HTTP/2 协议错误。 |

子路径部署时，将 `BASE_PATH` 设为相应路径，并在反向代理与 ZITADEL 中配置完整登录地址，例如 `https://login.example.com/auth/login`。修改运行时环境变量后重启容器生效，无需重新构建镜像。

OIDC 回调默认要求 HTTPS。只有当前 ZITADEL 应用开启 Development Mode，且服务账号能读取该应用配置时，才允许 HTTP 回调；此规则不受登录站点的 `NODE_ENV` 影响。成功授权和拒绝授权均使用相同规则。

## 2. 发布并运行镜像

推送 Git tag 后，CI 会构建并发布 `linux/amd64` 与 `linux/arm64` 镜像到 GHCR。使用对应 tag 部署：

```sh
docker run -d \
  --name wyid \
  --restart unless-stopped \
  --network <应用网络> \
  -p 127.0.0.1:3000:3000 \
  --env-file .env.production \
  --mount type=bind,src=/secure/zitadel-service-user-token,dst=/run/secrets/zitadel-service-user-token,readonly \
  ghcr.io/<owner>/<repository>:<tag>
```

将反向代理的 HTTPS 登录域名转发至容器 `3000` 端口。容器与 ZITADEL 连接时，确保二者位于可互相访问的 Docker 网络中。

## 3. 免确认项目配置

将需要免授权确认的 ZITADEL Project ID 填入 `ZITADEL_SKIP_CONSENT_PROJECT_IDS`，多个 ID 用逗号分隔。保存环境变量后重启容器生效。

## 4. 登录状态复用

直接登录或应用授权完成身份验证后，站点会通过加密、HttpOnly Cookie 保存 ZITADEL Session 凭据。后续授权复用该会话，无需重复输入账号密码；每次仍向 ZITADEL 查询实际会话、账号所属组织的最新登录策略和验证方式，不把 Cookie 本身当作验证通过的依据。

登录状态有效期取自 ZITADEL Session 的 `expiration_date`，以及原生验证时间加 `password_check_lifetime` / `external_login_check_lifetime` 得出的截止时间，不再固定为本地 12 小时，也不在重复授权时自动续期。没有可用截止时间时使用浏览器会话 Cookie。MFA 有效期仍读取 `second_factor_check_lifetime` / `multi_factor_check_lifetime`；过期时按当前策略补充验证，零有效期不复用上次授权的验证结果。会话失效或被撤销后需要重新登录，退出登录会撤销对应 ZITADEL Session。

应用请求 `prompt=login`、`prompt=select_account` 或 `max_age=0` 时不自动复用账号；其他 `max_age` 值限制可复用的原生身份验证时间。登录状态复用不改变上面的免确认项目规则，也不会跳过显式的 `prompt=consent`。`prompt=none` 仅在已有有效登录且无需交互或授权确认时静默完成，否则返回相应 OIDC 错误。
