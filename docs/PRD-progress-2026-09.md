# PRD 执行进度（对照 docs/PRD-mature-agent-roadmap.md）

更新时间：2026-09-17（最终汇总）  
基线：v2.0.1 → 工作区待发 **v2.1.0**

## 结论

**M1–M4 中可本地交付的项已全部落地**；剩余 4 项依赖外部资源或单独里程碑，不阻塞发版。

## P0 / M1

| ID | 项 | 状态 | 说明 |
|----|----|------|------|
| S-01 | 会话级文件锁 | ✅ | `sessions.lock` + tmp 原子写 |
| S-02 | 崩溃续跑 | ✅ | `agent-running.json` + 启动检测 |
| S-03 | 工具超时/取消 | ✅ | `shell_timeout_secs` 设置；kill-on-drop |
| S-04 | 压缩失败降级 | ✅ | 失败继续会话并计数 |
| O-01 | 统一事件 | ✅ 最小 | `events.jsonl` session_start/end |
| O-02 | 本地 Metrics | ✅ | 用量页：成功率/按模型/压缩/权限 |
| O-03 | doctor deep | ✅ 部分 | env 磁盘/可写；mcp/version 等 |
| P-01 | 权限策略中心 | ✅ 最小 | 策略快照 + UI 说明 |
| P-02 | 审计日志 | ✅ | `audit.jsonl` |
| P-03 | 危险命令确认 | ✅ | 规则库 + 敏感/系统路径 |
| C-01 | 成本归因 | ✅ | by_model + recent_sessions |
| C-02 | 预算策略 | ✅ 部分 | 累计 + 单会话预算 |
| C-04 | 工具结果剪枝 | ✅ | head/tail prune |
| F-01 | 统一内核 | ⏸ 默认关 | 产品决策：kernel_agent 默认 false |
| F-02 | Task 抽象 | ✅ 最小 | `tasks/task-*.json` |
| S-07 | E2E | ⚠ 文档 | 检查单 + 手工冒烟，无自动 GUI E2E |
| U-01 | 首次路径 | ✅ | Setup 向导（前序） |
| U-02 | 审批体验 | ✅ | 同类命令会话内免再确认 |
| U-04 | 错误可行动 | ✅ | actionable_error |

## P1 / M2–M3

| ID | 项 | 状态 |
|----|----|------|
| P-06 | Windows 沙箱 | ✅ Phase1 路径 + **Phase2 Restricted Token**（`ChildSandbox`，失败降级 job） |
| P-07 | 网络白名单 | ✅ |
| P-09 | 签名 | ⏭ 跳过（无证书） |
| C-07 | 二进制体积 | ✅ 验证 | strip 后 **257MB → 158MB** |
| D-01 | 一键 dev | ✅ `scripts/dev.ps1` |
| D-03 | 用户文档 | ✅ getting-started |
| 发版 | 检查单 | ✅ `release-checklist-v2.md` |

### P-06 实现说明（2026-09-17）

- `sandbox_windows.rs`：`RestrictedToken`（`CreateRestrictedToken` + `DISABLE_MAX_PRIVILEGE|LUA_TOKEN|SANDBOX_INERT`）、`ChildSandbox`（Job + 可选 Token）
- `run_command_sync`：`CreateProcessAsUserW` + 挂 Job + 管道读输出 + 超时 Terminate
- 设置 `sandbox_profile`: `job`（默认）| `restricted`
- 单测：`restricted_token_creates` / `restricted_runs_cmd` / Job 两项 — **4 passed**

## P2 / M4

| ID | 项 | 状态 |
|----|----|------|
| F-06 | VS Code 扩展 | ✅ Webview 聊天 + ACP initialize/prompt + 审批 Allow/Deny（`editors/vscode`） |
| F-07 | Extension Protocol | ✅ 最小契约 `extension_v1` + 文档 + 4 单测 |
| F-03/F-09 | 子代理产品化 / 双模型 | ❌ 未做（需产品排期） |

### F-06/F-07 说明（2026-09-17）

- `editors/vscode`：Webview 面板、session/update 流式块、permission 审批、fs/read 最小桥
- `wth-tool-protocol/src/extension_v1.rs`：handshake / intercept / slot 冲突 / replace 校验
- 文档：`docs/EXTENSION_PROTOCOL.md`

## P1 / M2–M3（续）

| ID | 项 | 状态 |
|----|----|------|
| U-03 | 长任务进度 | ✅ Phase working/checking + 输入区状态文案 |
| O-07 | 健康看板 | ✅ 诊断页：成功率/费用/压缩/最近任务 |
| F-03 | 子代理 | ✅ 部分 | `subagent_parallel`（1–4）运行中并发上限；6 个内置预设已有 |

## P2 / M4（续）

见上文 F-06 / F-07。

---

## 仍明确未做

| 项 | 原因 |
|----|------|
| 完整 GUI E2E | 需真实模型 + 窗口自动化 |
| F-09 双模型默认工作流 | 与 F-01 同属内核策略，待灰度 |
| Authenticode 签名 | 无证书 |
| AppContainer Phase3 | 工作量大；已有 Restricted Token |

**建议发版**：将当前工作区作为 **v2.1.0** 提交并重新打包。

## 文件落点（本批）

- 核心：`crates/desktop/wth-desktop/src/{audit.rs,ipc/{agent,session,tools}.rs,settings.rs,main.rs}`
- CLI：`crates/codegen/wth-pager/src/doctor_cmd.rs`
- UI：`Settings.tsx` / `ipc.ts`
- 扩展：`editors/vscode/`
- 文档：`docs/{PRD-mature-agent-roadmap.md,adr/*,release-checklist-v2.md,smoke-desktop.md,user-guide/getting-started.md}`
- 脚本：`scripts/dev.ps1`
