---
name: mcp-author
description: >
  编写一个新的 MCP（Model Context Protocol）服务器，暴露自定义工具给
  AI 编码代理使用。当用户说"写个 MCP server""把我们的接口做成 MCP 工具"时使用。
metadata:
  short-description: "编写 MCP 服务器"
---

# 编写 MCP 服务器

## 步骤

1. **需求收敛**：确认要暴露的 3-6 个工具（名称、输入 schema、副作用级别）。
   工具粒度按"模型会怎么调用"设计：一个 `search_tickets(query)` 优于
   `list_all_tickets` + 客户端过滤。
2. **选择栈**：跟随用户环境——TypeScript 用 `@modelcontextprotocol/sdk`，
   Rust 用 `rmcp`。stdio 传输为默认（最通用），HTTP/SSE 仅在确需远程共享时用。
3. **实现要点**：
   - 输入用 JSON Schema 严格描述（枚举值写清楚、必填项最小化）。
   - 工具输出面向模型：结果前置关键信息、出错时返回可操作的 `error` 文本。
   - 危险操作（删除/外发）加 `confirm` 参数或二次确认设计。
   - 超时与输出体积上限必做（防大响应撑爆上下文）。
4. **接入验证**：在 WTH 中配置该服务器（设置 → MCP 与工具 → 添加），用
   `mcp_test_server` 验证连通；逐个工具实际调用一遍核对返回。
5. **交付**：README（安装、配置 JSON 片段、工具清单与示例）。

## 红线

- 工具描述写给模型看：动作 + 对象 + 何时用；不写实现细节。
- 不在 stderr 打印非日志内容（stdio 传输下会破坏协议帧）。
