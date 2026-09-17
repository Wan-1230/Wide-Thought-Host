# WTH 发版检查单（M1 起）

发布前逐项勾选；P0 项未通过不得发安装包。

## 1. 构建与静态检查

- [ ] `cargo check -p wth-desktop` 无 error
- [ ] `cargo check -p wth-pager -p wth-pager-bin` 无 error
- [ ] UI：`npm run build`（tsc + vite）通过
- [ ] UI：`npm run test`（vitest）通过

## 2. 功能冒烟（装包后 / portable）

- [ ] 首次启动进入 Setup 向导，可完成「选工作区 → 配模型 → 开始」
- [ ] 内置模型或本地模型可发起一次对话并收到流式回复
- [ ] 工具调用：`file_edit` 或 `bash` 触发审批，允许后执行成功
- [ ] 危险命令（如 `rm -rf` / `git push --force`）在 auto/YOLO 下仍弹确认
- [ ] 设置页可见：工具成功率、按模型归因、权限策略说明
- [ ] `wth doctor` 可运行且退出码合理（有 fail 时为 1）

## 3. 可靠性抽查

- [ ] 强杀应用后重启：日志出现 interrupted agent 警告，会话列表仍可打开
- [ ] 压缩开启时长对话：失败不中断（日志有 compression failed 继续）
- [ ] `sessions.lock` 存在且无损坏 sessions.json

## 4. 安全与审计

- [ ] 凭据仅存 Credential Manager，日志无 API Key 明文
- [ ] `audit.jsonl` 记录了审批决策（含 dangerous 标记）
- [ ] 敏感路径（`.env` 等）写入需确认

## 5. 分发

- [ ] 版本号：`tauri.conf.json` / `Cargo.toml` / `ui/package.json` 一致
- [ ] `RELEASE_NOTES.md` 顶部含当前版本段
- [ ] MSI + NSIS + portable zip + sha256sums 生成
- [ ]（有证书时）Authenticode 签名通过

## 6. 指标基线（发布后一周回看）

- 工具成功率 ≥ 95%
- 非用户中止失败率 < 8%
- 压缩失败次数 / 触发次数 < 5%
