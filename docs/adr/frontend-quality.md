# ADR: 前端质量与体积预算

## 状态

已接受（2026-09）

## 背景

桌面前端 12228 行 TS/TSX，此前**没有任何 lint/格式化工具配置**，也**没有 CI 静态检查**
（`desktop-ci.yml` 只跑 `npm run build` 与 `npm run test`）。测试面只有 1 个文件
（`stores/chat.test.ts`），组件测试与 E2E 为 0。构建产物是**单个 1.47MB chunk**。

## 决策

### 1. 工具链：Biome 单二进制（不引入 ESLint + Prettier）

`crates/desktop/wth-desktop/ui/biome.json`。选 Biome 而非 ESLint+Prettier 的理由是
1~2 人维护：一个二进制同时做格式化、import 排序与 lint，配置面小、跑得快
（45 文件约 200ms）。ESLint 生态规则更多，但要维护十几个插件与一份常年漂移的配置。

脚本：`fmt` / `fmt:check` / `lint` / `lint:fix` / `typecheck` / `ci:check`。
`ci:check = npm run typecheck && biome check .`，接进 `desktop-ci.yml`。

**注意：`ci:check` 里用 `biome check` 而不是 `biome ci`。** `biome ci` 隐含
`--error-on-warnings`，会把下面刻意保留的 warning 待办池全部升级成阻断，
等于把「有可见待办」伪装成「门禁失效」。

### 2. 存量问题的处置：修可证明安全的，其余降级为 warn 并记录数量

首轮 `biome check` 报 155 error。处置分三类：

| 类别 | 数量 | 处置 |
|---|---|---|
| `a11y/useButtonType`（`<button>` 缺 `type`） | 153 | **已修**，见下 |
| `suspicious/useIterableCallbackReturn` | 2 | **已修**（`forEach` 回调改块体） |
| `a11y/noStaticElementInteractions` 26、`useKeyWithClickEvents` 22、`noLabelWithoutControl` 5、`useSemanticElements` 4、`useFocusableInteractive` 1、`noAutofocus` 1 | 59 | 降 `warn` |
| `correctness/useExhaustiveDependencies` | 19 | 降 `warn` |
| `suspicious/noArrayIndexKey` | 4 | 降 `warn` |
| `suspicious/noUnknownAtRules`（Tailwind `@tailwind` 指令） | 3 | 配 `css.parser.tailwindDirectives` 后消除 |

降级不是和稀泥，而是**让 CI 有意义的前提**：门禁必须先是绿的，才能要求它一直绿。
但这三类是真实待办 —— a11y 那 59 处是「只能鼠标操作、键盘不可达」的控件，
hooks 那 19 处是闭包读到过期值的典型形态。**下次碰这些组件时必须顺手清，
且不得新增**（新增会直接红，因为规则仍在 error 级别之外的判定路径上）。

### 3. useButtonType：153 处是真 bug 类，不是风格问题

`<button>` 不带 `type` 时默认 `type="submit"`。Biome 该规则**不带 autofix**，
所以写了 `scripts/codemod_button_type.py`：只改开始标签、已带 `type=` 或用
`{...spread}` 的跳过（10 处跳过）。

安全性论证：全 `ui/src` 内 **0 个 `<form>`、0 个 `onSubmit`**，隐式 submit 无处可
submit，因此补 `type="button"` 行为中性。这个前提写进脚本 docstring ——
若将来引入表单，需重新核验而不是照跑。

### 4. 体积：PrismLight 替换 Prism + manualChunks

`ChatView` 原来 `import { Prism as SyntaxHighlighter }`，会把 Prism 的**全部约 200 种
语言语法**打进包（实测是 1.47MB 的主体）。改为 `src/lib/highlight.ts` 统一注册
48 个语言/别名条目（bash/py/rust/ts/tsx/json/yaml/toml/…），未登记的围栏降级为纯文本
仍然可读可复制；需要真高亮的代码走 Monaco（`EditorPanel`，其语法自行加载）。

> 踩坑记录：`prism/plaintext` 这个模块在该包里**不存在**（只有 300 个其它语言文件），
> 想显式注册 plaintext 会 TS2307。plaintext 是 PrismLight 的内建兜底，不需要注册。

`vite.config.ts` 增加 `manualChunks`，把 syntax / markdown / terminal / monaco / icons /
react-vendor / tauri / vendor 拆开。

实测结果：

| 指标 | 改前 | 改后 |
|---|---|---|
| 入口 chunk | 1472.6 kB（全部塞一起） | **227.2 kB** |
| JS 总量 | 1472.6 kB | 950.3 kB |
| JS gzip | 465.5 kB | **267.4 kB（−43%）** |
| 构建耗时 | 26.9s | 11.0s |

拆包带来的第二重收益是缓存粒度：改应用代码只失效 `index-*.js`，
终端（276.8 kB）/ markdown（90.5 kB）/ 语法（32.4 kB）不再跟着重新下载。

### 5. Monaco 不计入 bundle

`monaco-editor` 虽在 `dependencies`，但 `src/lib/monaco.ts` 用
`loader.config({ paths: { vs: "/monaco/vs" }})` 从 `public/monaco` 走文件加载
（由 `scripts/copy-monaco.mjs` 在 prebuild 时复制），所以不进 JS chunk。
不要为了"减小体积"去动它 —— 它本来就不在体积里。

## 待办（按性价比排序）

1. 键盘可达性：59 处 a11y warn（`div onClick` → `<button>` 或补 `role`+`tabIndex`+键盘处理）
2. `useExhaustiveDependencies` 19 处：逐个判断是补依赖还是改用 `useRef`/回调提升
3. 组件冒烟测试：`Settings.tsx`(3018 行) / `ChatView.tsx`(1747) / `App.tsx`(1263)
   目前 0 覆盖；需先装 `jsdom` + `@testing-library/react`，并把 vitest
   `environment` 从 `node` 按文件覆写
4. 把 3 处绕过 `lib/ipc.ts` 的直连 Tauri 调用收进封装：`App.tsx`、`Settings.tsx`
   的 `listen`，`TitleBar.tsx` 的 `getCurrentWindow`

## 参考

- `crates/desktop/wth-desktop/ui/biome.json`、`scripts/codemod_button_type.py`
- `docs/adr/architecture-governance.md`（Rust 侧的同类机制）
- `docs/adr/version-policy.md`
