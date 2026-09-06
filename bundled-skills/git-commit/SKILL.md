---
name: git-commit
description: >
  把当前工作区变更整理成一次或多次规范提交（Conventional Commits）。
  当用户说"提交""commit""帮我提交代码"或要求把改动拆分提交时使用。
metadata:
  short-description: "规范化提交当前变更"
---

# 规范化 Git 提交

把当前变更整理成清晰、可回溯的提交。用 `git_status` / `git_diff` 工具了解变更，不要凭空猜测。

## 步骤

1. **盘点变更**：`git_status` 查看状态，`git_diff`（含 `staged: true`）审查每个文件的完整差异。禁止在未读 diff 的情况下提交。
2. **决定拆分**：变更涉及多个不相关主题时，建议拆成多个提交（用户确认后按主题分批 `git add <files>` + 提交）。
3. **撰写信息**：
   - 格式：`type(scope): 摘要`，type 取 feat/fix/refactor/docs/test/chore/perf/ci。
   - 摘要 ≤ 50 字，说明"为什么"；正文可补充"做了什么、影响面"。
   - 匹配仓库既有提交语言（本仓库默认中文摘要）。
   - 禁止出现 "Claude/GPT/AI 生成" 等署名尾巴。
4. **执行**：用 `git_commit` 工具（`stage_all` 仅在用户明确要求提交全部时为 true）。
5. **回执**：提交后展示 `git_log` 最新一条，并提示剩余未提交变更（如有）。

## 红线

- 检测到疑似密钥/凭据（`sk-`、`AKIA`、私钥块）时**停止并报告**，绝不提交。
- 用户未要求时不要主动 push；不要 amend 他人提交。
