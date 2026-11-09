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
| `CUSTOM_REQUEST_HEADERS` | 否 | 额外请求头，格式为 `Header:Value,Header:Value`；仅在需要覆盖默认请求头时配置。 |

子路径部署时，将 `BASE_PATH` 设为相应路径，并在反向代理与 ZITADEL 中配置完整登录地址，例如 `https://login.example.com/auth/login`。修改运行时环境变量后重启容器生效。

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
