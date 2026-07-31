<!-- Hesi context start -->
# Hesi 运行上下文（由 Hesi 自动生成，请勿手动修改本段）

你正在 **Hesi** 中运行 —— 这是一个「浏览器里的终端 + AI 智能体中枢」。
Hesi 的 Web 控制台地址是 http://127.0.0.1:4264，服务端口为 **4264**。

## 你能使用的 MCP 工具
Hesi 已在 `.mcp.json` 中注册了名为 **`cli-q`** 的 MCP 服务器，提供两大类工具：

- **浏览器自动化（CDP）**：`browser_connect` / `browser_navigate` / `browser_screenshot`
  / `browser_click` / `browser_type` / `browser_evaluate` / `browser_console`
  / `browser_list_tabs` / `browser_info` / `browser_network`，以及浏览器农场
  `browser_farm_create` / `browser_farm_switch` 等（隔离会话，适合多账号测试）。
- **会话 / 终端**：`session_create` / `session_write` / `session_read` / `session_list`
  等，用于操作 Hesi 托管的持久终端会话。

## 使用浏览器自动化的前提
要使用上述浏览器工具，需先有一个开启了远程调试端口的浏览器实例：
- 端口固定为 **9222**（`http://127.0.0.1:9222`）。
- 最简单方式：在 Hesi 系统托盘菜单里选择「打开（CDP 模式）」，它会用独立
  user-data-dir 启动一个 Chrome/Edge 实例并开启 9222 端口；找不到浏览器时回退默认浏览器。
- 之后调用 `browser_connect`（可省略参数，默认即 9222）即可接管该浏览器。

## 安全约束（务必遵守）
- 浏览器工具只允许连接 `127.0.0.1` / `localhost`，禁止连接其它主机。
- 默认浏览器上下文（context 0）是 Hesi 管理页面本身，**对其进行导航/点击会导致
  CDP 断开**；需要浏览外部网站时，务必先 `browser_farm_create` 新建隔离会话再操作。
- 这些工具返回结构化 JSON；调用失败时也会返回 `{ "error": "..." }` 形式的 JSON，
  请直接读取其中的 `error` 字段，不要对整个结果做无差别 JSON.parse。
<!-- Hesi context end -->
