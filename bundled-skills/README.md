# WTH 捆绑技能包（E-01）

本目录收录随发行版分发的**实战技能模板**，覆盖中文开发场景的高频工作流。
桌面端与 CLI 启动时会把这些技能种子到 `~/.wth/bundled/`（已存在的不覆盖，
用户可自行修改或删除）。

| 技能 | 用途 |
|---|---|
| `git-commit` | 把变更整理成规范提交（Conventional Commits） |
| `test-gen` | 生成高质量单元测试（边界 + 回归场景） |
| `refactor` | 小步、可验证、可回滚的安全重构 |
| `docs-gen` | 生成/更新模块文档与 README |
| `i18n-extract` | 抽取硬编码文案进 i18n 键表 |
| `release-notes` | 从提交历史生成发布说明 |
| `mcp-author` | 编写 MCP 服务器 |
| `plugin-author` | 编写 WTH 插件（技能/命令/Hooks 打包） |
| `perf-profile` | 性能剖析与优化（先测量后优化） |
| `dependency-audit` | 依赖安全审计与升级规划 |

与 `crates/codegen/xai-grok-shell/skills/`（引擎内置技能）互为补充；
作用域优先级见 `xai-grok-tools` 技能发现：Local > Repo > User > Server >
Bundled > Plugin。新增技能：本目录加一个 `<name>/SKILL.md`（frontmatter
需含 `name` 与 `description`），重启生效。
