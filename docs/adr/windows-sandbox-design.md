# Windows 沙箱升级设计（P-06）

> 状态：设计说明 — 实现分阶段，当前生产仍为 Job Object kill-on-close。

## 现状（A-03 第一阶段）

- `ChildJob`：`CreateJobObjectW` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
- 可选 `JOB_OBJECT_LIMIT_PROCESS_MEMORY`
- shell/git 子进程挂入 Job，超时/结束时整树回收
- **未限制**：文件系统路径、注册表、网络

对标 Reasonix 的 Windows restricted-token sandbox，本设计给出可落地路径。

## 目标

1. 阻止 Agent 子进程写工作区外敏感目录（用户 Profile、系统目录）
2. 保持失败可降级（fail-open + 日志），不破坏现有 auto/YOLO 工作流
3. 与权限预设联动：`read-only` / `workspace` / `full`

## 方案对比

| 方案 | 隔离强度 | 复杂度 | 兼容性 |
|------|----------|--------|--------|
| **A. 受限 Token + Integrity Level** | 中 | 中 | Win7+，可与 Job 叠加 |
| **B. AppContainer** | 高 | 高 | Win8+；网络/文件能力需 capability 声明 |
| **C. 路径 ACL 预检（当前扩展）** | 低 | 低 | 立即可做，非内核隔离 |

## 推荐路线

### Phase 1（本设计可立即实现）— 路径策略强化

在 `execute_tool` 已有 `resolve_workspace_path` / `is_sensitive_path` 基础上：

1. 默认拒绝写 `%USERPROFILE%`、`C:\Windows`、`Program Files` 等（除非 full access）
2. `read-only` 预设下 shell 命令仅允许只读子集（status/diff/log/cat/dir）
3. 审计写入 `audit.jsonl`（已有）

### Phase 2 — Restricted Token

```text
CreateRestrictedToken(
  flags = DISABLE_MAX_PRIVILEGE | LUA_TOKEN | SANDBOX_INERT,
  delete SIDs: Administrators, etc.
  restricted SIDs: 当前用户
)
→ CreateProcessAsUserW(..., CREATE_SUSPENDED)
→ AssignProcessToJobObject
→ ResumeThread
```

- 降完整性：`SECURITY_MANDATORY_LOW_RID` 或 Medium
- 失败则回退当前 Job-only 路径

### Phase 3 — AppContainer（可选）

- 包 SID：`S-1-15-2-...` 固定或按会话生成
- Capabilities：`internetClient`（若允许网络）、无 `broadFileSystemAccess`
- 需要测试：git、npm、cargo 等子进程是否可用

## 实现边界（wth-desktop）

| 文件 | 职责 |
|------|------|
| `src/ipc/sandbox_windows.rs` | 扩展 `ChildJob` → `ChildSandbox`（token + job） |
| `src/ipc/tools.rs` | 根据 `edit_mode` / 设置选择 profile |
| `src/settings.rs` | `sandbox_profile`: `job` \| `restricted` \| `appcontainer` |

## 验收

- restricted 模式下无法写 `C:\Windows\System32\test.txt`
- 工作区内读写正常
- 创建失败自动回退 Job-only 并记 `events.jsonl`
- 现有危险命令确认逻辑不变

## 风险

- 开发工具（rustc/npm）在低完整性下可能失败 → 默认仍 `job`
- 杀软误报：CreateProcessAsUser 路径需签名更友好（与 P-09 一并）
