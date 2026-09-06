# WTH 变更说明 — 内置 Agnes 免费模型恢复(开箱即用)

> 日期:2026-09-07 · 维护者决策:恢复应用自带的免费模型 · 类型:功能恢复(带安全与可维护性改进)

## 背景

内置免费模型 **Agnes AI**(`agnes-default`,OpenAI 兼容端点)最初随应用自带
(提交 abd3978)。2026-09 安全整改(S-01)时把硬编码 Key 从源码移除,此后
全新安装的默认 Provider 无 Key 不可用,只能靠本地模型(Ollama/vLLM)兜底。
经维护者确认,**恢复该内置免费模型**(沿用原 Key)。

## 实现

### 1. Key 植入(main.rs)——比原版多两个改进

- `BUILTIN_AGNES_API_KEY` 常量 + `seed_builtin_provider_key()`,启动时把 Key
  写入 Windows 凭据管理器(`com.wth.desktop/provider/agnes-default`),
  不落 settings.json、不在设置界面展示。
- **自愈轮换**:原版"缺失才写入",现改为"与最新常量不一致即覆盖"——
  维护者换 Key 后,所有存量安装下次启动自动跟进,不会停留在失效旧 Key。
- 非 Windows 平台无凭据存储实现,静默跳过(tracing::debug),
  该平台由 F-01 本地模型兜底,行为与 S-01 时期一致。

### 2. 既有链路确认(无需改动)

- `settings.rs` 默认值:agnes-default 已是 `default_provider_id`,
  `builtin: true`(设置界面隐藏,ModelSwitcher 可见可选)。
- `default_provider_usable`:读到 Key → 内置模型可用 → 本地模型探测
  **不再接管**默认项(Ollama 用户仍可手动切换)。
- Agent 链路:provider key 统一经凭据管理器读取(agent.rs),
  内核 BYOK(AcpBridge ensure_connected → WTH_API_KEY)同样生效。
- 前端:Settings 过滤 builtin 显示"正在使用内置默认模型";侧栏模型切换器
  可见 "Agnes AI (内置)"。

### 3. 密钥扫描豁免(.gitleaks.toml)

该 Key 属于**应用自带、故意入库**的共享凭据(泄露面等同应用本身),
在 gitleaks 白名单中显式豁免该常量所在文件并注明理由;其余任何密钥仍被
secret-scan 工作流拒绝。轮换时只需改 main.rs 常量(白名单按文件路径豁免,
无需再改)。

## 验证

- 端点实测:`GET https://api.agnes-ai.cn/v1/models` 携带内置 Key 返回 200,
  模型列表含 `agnes-2.5-flash`(与配置一致)、`agnes-2.5-pro` 等。
- `cargo check -p wth-desktop` 通过(无新增警告);
  `cargo test -p wth-desktop --bin wth-desktop` **52/52 通过**(含内核 e2e)。
- gitleaks 白名单按路径豁免,CI 扫描不受影响。

## 用户可见效果

全新安装 → 启动 → 侧栏模型切换器显示 "Agnes AI (内置)" 且为默认,
直接发消息即可使用,无需任何配置。配置了自己的 Provider 的用户不受影响
(默认项保持用户选择;可在模型切换器手动选回 Agnes)。

## 后续

- 若 Agnes 服务方轮换/吊销 Key:改 `BUILTIN_AGNES_API_KEY` 常量发版即可。
- 如需更换端点/模型名:同在 settings.rs Default 中一并调整。
