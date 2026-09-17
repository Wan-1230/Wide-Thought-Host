# Extension Protocol v1

> 对应 PRD F-07。实现在 `crates/common/wth-tool-protocol/src/extension_v1.rs`。

## 原则

- **安装即信任**：第三方 runtime 为全信任；宿主不静默降级模型/策略
- **宿主重校验**：`replace` 后的 payload 必须通过 `validate_replace`
- **槽位单 owner**：同一 replacement slot 不得被两个插件同时声明
- **可选热路径**：默认不启用同步 interceptor；观察型事件不改变 prompt 前缀

## Manifest

```json
{
  "name": "demo",
  "version": "0.1.0",
  "apiVersion": "wth.io/extension/v1",
  "intercepts": ["input", "tool_call", "permission"],
  "slots": ["system_prompt"],
  "providers": []
}
```

## 方法

### `ext/handshake`

请求：

```json
{
  "protocolVersion": 1,
  "host": "wth-desktop",
  "hostVersion": "2.1.0"
}
```

响应：

```json
{ "accepted": true, "plugin": "demo", "protocolVersion": 1 }
```

`accepted=false` 时带 `reason`（协议版本或 apiVersion 不匹配）。

### `ext/intercept`

请求：

```json
{
  "point": "tool_call",
  "sessionId": "…",
  "toolName": "bash",
  "payload": { "command": "cargo test" }
}
```

响应：

```json
{ "decision": { "action": "continue" } }
{ "decision": { "action": "block", "reason": "…" } }
{ "decision": { "action": "replace", "payload": { "command": "cargo test --lib" } } }
```

拦截点：`input` | `tool_call` | `permission`。

## 校验规则

| 点 | replace 允许类型 |
|----|------------------|
| `input` | object / array / string / number / bool |
| `tool_call` / `permission` | object / array / string（禁止标量与 null） |

## 冲突

`detect_slot_collisions` 返回同时声明同一 slot 的插件对；构建 runtime 失败时须同时点名双方。

## 尚未实现（后续）

- sidecar 进程生命周期与 `/reload`
- streaming provider（`plugin/<plugin>/<provider>/<model>`）
- 结构化 UI 卡片跨 TUI/Desktop/ACP 渲染

## 安全

- 凭据不得写入 interceptor 日志；宿主对 diagnostics redact
- 插件崩溃只使自身操作失败，不影响宿主会话完整性
