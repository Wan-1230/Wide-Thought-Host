---
name: plugin-author
description: >
  编写一个 WTH 插件（plugin.json + 技能/命令/子智能体/Hooks/MCP 打包），
  并通过插件市场或本地目录分发。当用户说"做一个 WTH 插件""打包成插件"时使用。
metadata:
  short-description: "编写 WTH 插件"
---

# 编写 WTH 插件

## 插件结构

```
my-plugin/
├── plugin.json        # 清单：名称/版本/来源声明
├── skills/            # 技能（每个子目录一个 SKILL.md）
├── agents/            # 子智能体定义（.md）
├── commands/          # 斜杠命令
└── hooks/             # 生命周期 Hook（command / http 两种 handler）
```

## 步骤

1. **设计组件组合**：对照需求选择组件——可复用知识→技能；固定流程→子智能体；
   事件自动化→Hooks（SessionStart/PreToolUse/PostToolUse/SubagentStart 等）。
2. **编写 plugin.json**：声明 id、name、version、components；Project 作用域插件
   需要用户显式信任（folder trust），文档里要说明。
3. **实现**：技能用 SKILL.md（frontmatter：name/description/when-to-use）；
   Hook 脚本读 stdin JSON、stdout 输出结果，失败 fail-open，勿在 Hook 里做重活。
4. **本地安装验证**：放入 `~/.wth/plugins/<name>/`，`/plugins` 查看加载状态；
   逐组件验证（技能出现在 `/` 列表、Hook 在对应事件触发）。
5. **分发（可选）**：推送到 git 仓库，作为自定义市场源加入
   （设置 → 插件 → 添加源），走市场安装链路再验证一遍。

## 红线

- 插件携带的 LSP/MCP 配置只补缺不覆盖用户配置。
- 组件清单内不放置凭据；需要密钥的走环境变量或凭据管理器。
