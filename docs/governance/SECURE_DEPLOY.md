# Secure Deployment Guide — Hesi（合思）

> 适用：把 Hesi 部署到团队/企业内网或公网前的必读。默认安装**只绑定回环地址**，
> 但一旦你为了远程访问而改变绑定，请先读完本文。

## 1. 默认就很安全（但别忘了）

- **默认绑定 `127.0.0.1` + `::1`**（双栈回环）。不在 `HOST` 里写 `0.0.0.0` / 公网 IP，
  就不会被局域网/公网直接访问。
- **命令策略默认 `blocklist`**：`mkfs`/`dd`/`shutdown`/`rm -rf /`、fork bomb、写 boot 区等
  危险操作开箱即拦（见 `mcp/security/policy.js`）。可改 `QCLI_POLICY_PATH` 指向的策略文件
  切换为 `allowlist` 或 `permissive`。
- **本地来源守卫（防浏览器 drive-by / CSRF）**：CORS 只能阻止跨站页面**读取**响应，
  但一个「simple」跨站 POST 仍会**执行副作用**。因 Hesi 是本地服务，`lib/access-auth.js`
  的 `localOriginGuard` 会在任何处理器之前拒绝携带**非回环 Origin** 的改状态请求
  （与 `QCLI_CORS_ORIGINS` 白名单共用）。这可挡住「用户在浏览器打开恶意网页 →
  该页悄悄向 `127.0.0.1:4264` 发 POST」这类真实的本地威胁。
- **统一审计总线**（`lib/audit.js`）记录登录、PTY 命令、MCP 工具、上传、配置变更等到
  `data/audit.jsonl`，便于事后追溯。

## 2. 暴露到网络前的检查清单

| 项 | 做法 |
|----|------|
| 认证 | 企业场景设 `AUTH_MODE=enterprise`，通过 `/api/auth/bootstrap` 或 `HESI_BOOTSTRAP_ADMIN_*` 创建管理员，再分发账号；否则任何人都能以本地 admin 访问。 |
| 令牌 | 至少设 `QCLI_ACCESS_TOKEN`，远程客户端必须 `Authorization: Bearer <token>`。设 `QCLI_TOKEN_REQUIRE_LOOPBACK=1` 让本机浏览器也需令牌。 |
| 审计 | 设 `QCLI_AUDIT_LOG=data/audit.jsonl`（或默认路径），定期 `GET /api/admin/audit/export` 归档。 |
| TLS | 公网务必在反向代理（nginx/Caddy）上终止 TLS，不要裸跑 HTTP。 |
| CORS | 默认仅同源/回环；跨域来源用 `QCLI_CORS_ORIGINS` 显式白名单。 |
| 防火墙 | 只对在信任网络暴露 4264（或自定义 `PORT`）；不用 `0.0.0.0` 直绑公网。 |
| 密钥 | `.env`、`.mcp.json` 已 git-ignore；仅 `.env.example` 入库。绝不提交真实密钥。 |

## 3. 最小暴露配置示例（企业内网）

```bash
# .env
HOST=10.20.30.40            # 仅绑定内网网卡，不要 0.0.0.0
PORT=4264
AUTH_MODE=enterprise
QCLI_ACCESS_TOKEN=__随机长令牌__
QCLI_TOKEN_REQUIRE_LOOPBACK=1
QCLI_AUDIT_LOG=data/audit.jsonl
AUDIT_RETENTION_DAYS=180
# 前面用 nginx + TLS 反向代理，启用 HSTS
```

nginx 反代（节选）：

```nginx
server {
  listen 443 ssl http2;
  server_name hesi.corp.example;
  ssl_certificate     /etc/ssl/corp/fullchain.pem;
  ssl_certificate_key /etc/ssl/corp/privkey.pem;
  add_header Strict-Transport-Security "max-age=63072000" always;
  location / {
    proxy_pass http://127.0.0.1:4264;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;   # WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
  }
}
```

## 4. 危险命令拦截（默认开启）

以下类别在 `blocklist` 模式下开箱拦截（正则按子串/前缀匹配）：

- 磁盘/分区销毁：`mkfs.*`、`dd`、`shred`、`parted`、`fdisk`
- 电源/初始化：`shutdown`、`reboot`、`halt`、`poweroff`、`init`
- 递归强删：`rm -rf /`、`rm -rf *`、`rm -rf ~`
- 设备直写：`> /dev/...`
- Fork bomb：`:(){ ... };:`
- 提权类：`chmod -R 0`、`chown -R 0`

AI 执行档（`aiExec` profile，供 agent 自动跑命令）有更严格的一份独立清单，见 `mcp/security/policy.js` 的 `AI_EXEC_BLOCKLIST`。

## 5. 已知边界 / 不建议

- Hesi 本质是「浏览器里的本地 shell」。即便有策略拦截，也**不要**把它当沙箱——
  有能力绕过策略的命令仍可执行。只在对用户可信的环境运行。
- 不要在公网无认证暴露。不要把 `HESI_LICENSE_MODE=commercial` 当授权——
  正式商用请走许可激活流程（`POST /api/license/activate`）。
- 节点原生模块 `node-pty` 需本地构建；若缺失，终端/agent 功能禁用（已优雅降级）。
