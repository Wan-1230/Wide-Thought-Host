# WTH Desktop 冒烟脚本说明

自动化全链路需要 GUI + 真实模型，CI 暂以「构建 + 单测 + 静态检查」代替。
装包后请按 `docs/release-checklist-v2.md` 第 2 节手工冒烟。

## 本地一键检查

```powershell
# 依赖：Rust GNU toolchain、protoc、Node 20+
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
$env:PATH = "$PWD\bin;$env:PATH"

cargo check -p wth-desktop
cargo test -p wth-desktop --bins
cd crates/desktop/wth-desktop/ui
npm run test
npm run build
```

## 关键路径（手工）

1. 删除/备份 `%APPDATA%\com.wth.desktop` 后启动 → 应出现 Setup 向导
2. 检测本地模型或添加自定义端点 → 测试连接
3. 新建会话提问 → 流式回复
4. 让 Agent 改文件 → Diff 审批
5. 故意执行 `rm -rf test-dir` → 必须弹确认
6. 设置 → 用量：工具成功率与按模型归因非空

## 崩溃续跑

1. 对话进行中任务管理器结束 `wth-desktop.exe`
2. 重新启动 → 日志应有 interrupted agent 警告
3. `agent-running.json` 会在下一次正常运行后被清除
