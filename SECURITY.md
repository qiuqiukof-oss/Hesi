# Security Policy

## Supported Versions
The latest `main` branch and the current stable release receive security updates.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a Vulnerability
Please report security issues **privately** — do not open a public issue.
- Use GitHub Security Advisories ("Security" → "Report a vulnerability") on this repository, or
- Contact the maintainers via the repository owner's GitHub profile.

We aim to acknowledge reports within 72 hours.

## Vulnerability Disclosure / 漏洞奖励

- 披露策略文件：`security.txt`（同时发布于 `/.well-known/security.txt` 与 `/security.txt`），
  指向本仓库的私有安全公告通道。
- 处理 SLA：确认收到后 72 小时内响应；高危漏洞在确认后尽快修复并随补丁版本发布通告。
- 安全公告：GitHub Security Advisories（仓库 → Security → Advisories）。
- 目前**未设现金奖励计划**（暂无 bounty 预算）；对负责任披露者将在公告中致谢。若未来
  启动 bounty，会在此处与 `security.txt` 同步更新。
- 合规材料见 `docs/governance/COMPLIANCE.md`；安全部署与最小暴露配置见 `docs/governance/SECURE_DEPLOY.md`。

## Operational Notes
- Hesi can launch local CLI tools — including AI agents such as opencode / Claude / Codex — inside a
  browser-served terminal. **Treat it like a local shell**: run it only on trusted networks or
  `localhost`, and do not expose the port publicly.
- The tray / offline bundle ships a bundled Node runtime (`node/`) for portability; keep it updated.
- Never commit `.env` or `.mcp.json` (both are git-ignored). Only `.env.example` is tracked.
