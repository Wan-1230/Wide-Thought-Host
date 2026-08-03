# 发版清单（Release Checklist）

本文档说明 WTH 桌面端如何发布新版本。发布流程由 CI 自动完成（H1）。

## 前置检查

1. `cargo test -p wth-desktop` 全部通过（CI 会自动跑）。
2. 前端 `npm run build` 通过（CI 会自动跑）。
3. 手动验收关键路径（可参考各 PRD 的验收清单）：
   - 新建会话 → 提问 → 收到回复
   - 工具调用（文件修改 + Diff 审查）
   - 设置保存、备份恢复
4. 更新 `RELEASE_NOTES.md`：在文件顶部新增 `# vX.Y.Z` 版本段，列出本次变更（CI 会取该段作为 Release 说明）。

## 发布步骤

### 1. 更新版本号

桌面端版本号位于 `crates/desktop/wth-desktop/tauri.conf.json` 的 `version` 字段（同时影响 `Cargo.toml` 的 `CARGO_PKG_VERSION`）。两者需保持一致。

### 2. 提交并推送

```sh
git add -A
git commit -m "release: vX.Y.Z"
git push origin main
```

### 3. 打 tag 触发自动发布

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

CI 的 `package` job 会打包 NSIS/MSI，`release` job 会自动：
- 计算安装包 SHA-256 校验和
- 从 `RELEASE_NOTES.md` 提取当前版本段作为发布说明（缺失时自动取提交历史）
- 创建 GitHub Release 并上传安装包与 `sha256sums.txt`

### 4. 验证发布

- 打开 Releases 页确认版本、说明、两个安装包与校验文件齐全。
- 下载安装包在干净 Windows 环境安装验证。
- 应用内"检查更新"应提示新版本；"下载并安装"应能完成下载与 SHA-256 校验。

## 代码签名（可选）

当前未签名（SmartScreen 会提示未知发布者）。若要签名：

1. 获取代码签名证书（商业证书约 ¥1000+/年，或自签名证书用于内部测试）。
2. 打包时配置证书并在构建环境设置 `WTH_SIGNED=1`，使关于页显示"已签名"。
3. 自签名证书不会被 SmartScreen 信任，仅供内部分发。

## 注意事项

- 普通 push（非 tag）只跑测试与构建，不会触发发布。
- Release 资产命名不要改变 `.exe`/`.msi` 后缀规则，否则应用内更新下载逻辑需同步调整。
- Release 说明中若包含 SHA-256 声明（`sha256:` 行），应用内更新会强制校验。
