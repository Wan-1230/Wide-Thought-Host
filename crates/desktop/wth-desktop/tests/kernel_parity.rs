//! 跨内核对齐测试：桌面自研循环 ⇄ ACP 内核桥。
//!
//! 目标不是端到端行为比对（那需要真实模型、已安装的 `wth` CLI 和网络，CI 里
//! 不可用），而是把两条路径的**能力面差异**变成可执行事实：清单、协议映射、
//! 降级路径都由代码本身断言，改一边就会红。
//!
//! ── 「记录而非失败」的设计 ──────────────────────────────────────────────
//! 两侧命名与概念粒度本就不同（`file_read` vs `read_file`、桌面四档 vs 内核
//! 两标志），强行对齐会让断言退化成「什么都不断言」。所以每个断言族做的是：
//! 计算出**当前观测到的差异集合**，再断言它 == `KNOWN_GAPS` 中该族的条目。
//! - 新出现的未知差异 → 集合变大 → 测试红，逼作者要么修、要么把它写进
//!   `docs/adr/kernel-parity.md` 的已知差异表并登记到 `KNOWN_GAPS`；
//! - 已登记的差异被修好 → 观测集合变小 → 测试同样红（`gap_records_are_not_stale`），
//!   免得登记表变成永久免罪金牌。
//! 两边都会红，这是一条只许收窄、不许放宽的棘轮。语义覆盖本身
//! （`desktop_tool_surface_is_covered_by_kernel_registry`）是硬断言，不参与登记。

use std::collections::BTreeSet;

// 直接编入运行时真正使用的那份映射，避免测试里另抄一份事实源。
#[path = "../src/ipc/approval_mode.rs"]
mod approval_mode;

use approval_mode::{
    APPROVAL_MODE_MAP, DESKTOP_APPROVAL_MODES, FALLBACK_LOG_PREFIX, KERNEL_SESSION_MODE_IDS,
    KernelRoute, kernel_approval_flags, kernel_route, kernel_session_mode_id, resolve_kernel_agent,
};

use xai_grok_shell::leader::ClientCapabilities;
use xai_grok_tools::types::SessionMode;

const TOOLS_SRC: &str = include_str!("../src/ipc/tools.rs");
const AGENT_SRC: &str = include_str!("../src/ipc/agent.rs");
const ACP_BRIDGE_SRC: &str = include_str!("../src/ipc/acp_bridge.rs");
const SETTINGS_SRC: &str = include_str!("../src/settings.rs");

// ─── 已知差异登记表 ───────────────────────────────────────────────────────
// 条目格式 `<family>:<detail>`。解释与影响见 docs/adr/kernel-parity.md 的
// 「已知差异」表，两边必须同步修改。
const KNOWN_GAPS: &[&str] = &[
    "tool-name:file_read",
    "tool-name:file_write",
    "tool-name:file_edit",
    "tool-name:file_list",
    "tool-name:file_search",
    "tool-name:git",
    "tool-undeclared:file_delete",
    "tool-granularity:file_write",
    "tool-granularity:file_edit",
    "tool-granularity:git",
    "mode:plan-review-collapse",
    "mode:session-mode-never-sent",
    "bridge:client-capabilities-partial",
    "bridge:no-desktop-side-dangerous-command-gate",
];

/// 差异族的前缀。工具族有三个子类，必须一起筛，否则漏族会空转通过。
const TOOL_PREFIXES: &[&str] = &["tool-name:", "tool-granularity:", "tool-undeclared:"];
const MODE_PREFIXES: &[&str] = &["mode:"];
const BRIDGE_PREFIXES: &[&str] = &["bridge:"];

fn filter_gaps(gaps: &BTreeSet<String>, prefixes: &[&str]) -> BTreeSet<String> {
    gaps.iter()
        .filter(|g| prefixes.iter().any(|p| g.starts_with(p)))
        .cloned()
        .collect()
}

/// 棘轮断言：观测差异 == 登记表（该族部分），并逐条打印。
fn assert_gaps(label: &str, observed: &BTreeSet<String>, prefixes: &[&str]) {
    let recorded: BTreeSet<String> = KNOWN_GAPS
        .iter()
        .filter(|g| prefixes.iter().any(|p| g.starts_with(p)))
        .map(|g| (*g).to_string())
        .collect();
    let observed = filter_gaps(observed, prefixes);
    assert!(
        !recorded.is_empty() && !observed.is_empty(),
        "[{label}] 族前缀 {prefixes:?} 筛出了空集合，断言已退化"
    );
    for gap in &observed {
        let status = if recorded.contains(gap) {
            "已登记"
        } else {
            "未登记"
        };
        println!("[{label}] {gap} — {status}");
    }
    assert_eq!(
        observed, recorded,
        "[{label}] 差异集合与登记表不一致：新增项需先写进 docs/adr/kernel-parity.md 与 \
         KNOWN_GAPS；消失项说明差异已修复，请同步删除登记表条目"
    );
}

// ─── 源码解析：把桌面侧清单从代码里读出来 ─────────────────────────────────

/// 顶层 item 之间的边界标记。
const ITEM_MARKERS: &[&str] = &[
    "\npub fn ",
    "\nfn ",
    "\npub async fn ",
    "\nasync fn ",
    "\npub struct ",
    "\nstruct ",
    "\npub const ",
    "\nconst ",
    "\npub trait ",
    "\nimpl ",
    "\n/// ",
    "\n#[",
];

/// 取顶层 item 从签名之后到下一个 item 之前的文本。
/// 刻意不按大括号配对：`build_tools()` 体里有大量含 `{}` 的 JSON 字符串，
/// 按括号切会直接切错。
fn top_level_body<'a>(src: &'a str, signature: &str) -> &'a str {
    let start = src
        .find(signature)
        .unwrap_or_else(|| panic!("源码里找不到 `{signature}` —— 结构变了，对齐测试需同步更新"));
    let from = start + signature.len();
    let end = ITEM_MARKERS
        .iter()
        .filter_map(|m| src[from..].find(*m).map(|i| from + i))
        .min()
        .unwrap_or(src.len());
    &src[from..end]
}

/// 取一行里所有简单的 `"..."` 字面量（本测试覆盖的源码无转义引号）。
fn string_literals(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(open) = rest.find('"') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('"') else {
            break;
        };
        out.push(after[..close].to_string());
        rest = &after[close + 1..];
    }
    out
}

fn is_snake_token(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// `build_tools()` 声明给模型的工具名。
fn declared_tools() -> BTreeSet<String> {
    top_level_body(TOOLS_SRC, "pub fn build_tools()")
        .lines()
        .map(str::trim)
        .filter(|l| l.starts_with("\"name\":"))
        .flat_map(string_literals)
        .filter(|s| s != "name")
        .collect()
}

/// `execute_tool()` 里 `match tool_name` 的顶层分支。
///
/// 按 8 空格缩进筛，因为函数体内层还嵌着一个
/// `match settings.web_search_engine` —— 它的 `"tavily" =>` 等分支不是工具名。
/// rustfmt 版本由 CI 钉住，缩进是确定的。
fn handled_tools() -> BTreeSet<String> {
    top_level_body(TOOLS_SRC, "pub async fn execute_tool(")
        .lines()
        .filter_map(|l| l.strip_prefix("        \""))
        .filter_map(|rest| {
            let (name, _) = rest.split_once("\" =>")?;
            (!name.is_empty()).then(|| name.to_string())
        })
        .collect()
}

/// `needs_approval()` 特殊对待的工具名。
///
/// 用「全字面量 − 非工具词表」而不是逐行找 `tool_name`：`matches!` 的参数列表
/// 会被 rustfmt 换行，按行找会静默漏项；多报（新增参数键名）只会让测试变红并
/// 要求补词表，不会掩盖差异。
fn approval_gated_tools() -> BTreeSet<String> {
    const NOT_TOOL_NAMES: &[&str] = &["plan", "review", "auto", "yolo", "command", "path", "args"];
    top_level_body(TOOLS_SRC, "pub fn needs_approval(")
        .lines()
        .flat_map(string_literals)
        .filter(|s| !NOT_TOOL_NAMES.contains(&s.as_str()))
        .filter(|s| is_snake_token(s))
        .collect()
}

/// `settings::validate` 对 `edit_mode` 的白名单是否已收敛到共享常量。
fn edit_mode_whitelist_is_shared() -> bool {
    SETTINGS_SRC.contains("DESKTOP_APPROVAL_MODES.contains(&settings.edit_mode.as_str())")
}

/// 内核工具注册表：`ToolRegistryBuilder::new()` 的 `Namespace:id` 全集。
fn kernel_registry() -> BTreeSet<String> {
    xai_grok_tools::registry::types::ToolRegistryBuilder::new()
        .known_tool_ids()
        .into_iter()
        .collect()
}

fn short_ids(qualified: &BTreeSet<String>) -> BTreeSet<String> {
    qualified
        .iter()
        .map(|id| id.rsplit(':').next().unwrap_or(id).to_string())
        .collect()
}

/// 桌面工具名 → 内核语义等价物。桌面是一套自研命名，内核按 namespace 提供多套
/// （GrokBuild / OpenCode / Codex / hashline），所以映射到语义而非字面。
const TOOL_ALIASES: &[(&str, &[&str])] = &[
    ("file_read", &["read_file"]),
    ("file_write", &["write", "apply_patch"]),
    ("file_edit", &["search_replace", "edit", "hashline_edit"]),
    ("file_list", &["list_dir"]),
    ("file_search", &["glob"]),
    ("bash", &["bash"]),
    ("git", &["git_status", "git_diff", "git_log", "git_commit"]),
    ("web_search", &["web_search"]),
];

fn alias_for(desktop_name: &str) -> &'static [&'static str] {
    TOOL_ALIASES
        .iter()
        .find(|(n, _)| *n == desktop_name)
        .map(|(_, aliases)| *aliases)
        .unwrap_or(&[])
}

/// 当前观测到的全部差异。`gap_records_are_not_stale` 用它做反向棘轮。
fn observe_gaps() -> BTreeSet<String> {
    let kernel = short_ids(&kernel_registry());
    let declared = declared_tools();
    let mut gaps = BTreeSet::new();
    for tool in &declared {
        if !kernel.contains(tool) {
            gaps.insert(format!("tool-name:{tool}"));
        }
        let aliases = alias_for(tool);
        if aliases.len() > 1 {
            gaps.insert(format!("tool-granularity:{tool}"));
        }
    }
    for gated in approval_gated_tools() {
        if !declared.contains(&gated) {
            gaps.insert(format!("tool-undeclared:{gated}"));
        }
    }
    let distinct: BTreeSet<(bool, bool)> = APPROVAL_MODE_MAP
        .iter()
        .map(|m| (m.kernel_flags.yolo_mode, m.kernel_flags.auto_mode))
        .collect();
    if distinct.len() < APPROVAL_MODE_MAP.len() {
        gaps.insert("mode:plan-review-collapse".to_string());
    }
    if APPROVAL_MODE_MAP
        .iter()
        .all(|m| m.kernel_session_mode.is_none())
    {
        gaps.insert("mode:session-mode-never-sent".to_string());
    }
    let advertised = advertised_capability_fields();
    if CLIENT_CAPABILITY_FIELDS
        .iter()
        .any(|f| !advertised.contains(*f))
    {
        gaps.insert("bridge:client-capabilities-partial".to_string());
    }
    if !bridges_dangerous_command_rule() {
        gaps.insert("bridge:no-desktop-side-dangerous-command-gate".to_string());
    }
    gaps
}

/// 桌面构造 `ClientCapabilities` 时显式填了哪些可选能力位。
fn advertised_capability_fields() -> BTreeSet<String> {
    const FIELDS: &[&str] = &[
        "terminal",
        "fs_read",
        "fs_write",
        "code_nav_enabled",
        "yolo_mode",
        "auto_mode",
        "default_model",
        "client_version",
    ];
    let at = ACP_BRIDGE_SRC
        .find("ClientCapabilities {")
        .expect("acp_bridge.rs 里找不到 ClientCapabilities 构造块");
    let body = &ACP_BRIDGE_SRC[at..];
    let body = &body[..body.find("};").expect("构造块未闭合") + 1];
    FIELDS
        .iter()
        .filter(|f| body.contains(*f))
        .map(|f| (*f).to_string())
        .collect()
}

const CLIENT_CAPABILITY_FIELDS: &[&str] = &["terminal", "fs_read", "fs_write", "code_nav_enabled"];

/// 桌面的危险命令规则（`tools::is_dangerous_shell`）是否作为信号传给内核。
fn bridges_dangerous_command_rule() -> bool {
    ACP_BRIDGE_SRC.contains("is_dangerous_shell")
        || ACP_BRIDGE_SRC.contains("dangerous_command")
        || AGENT_SRC.contains("approval_mode::KernelApprovalFlags")
}

// ─── 断言：工具清单 ───────────────────────────────────────────────────────

#[test]
fn kernel_registry_is_populated() {
    let qualified = kernel_registry();
    // 防退化：注册表为空时后面的子集断言会假阳性地「通过」。
    assert!(
        qualified.len() > 20,
        "内核注册表异常稀疏（{} 项）—— dev-dependency 或注册表 API 变了",
        qualified.len()
    );
    assert!(
        qualified.iter().all(|id| id.contains(':')),
        "内核工具 id 应为 `Namespace:id`"
    );
    // 具体 namespace 拼写不是本测试的事实源，只钉住「每个登记的内核等价物都真的
    // 存在于注册表」—— 别名表失配时 `desktop_tool_surface_is_covered_by_kernel_registry`
    // 会空转，这里把它兜住，并打印真实限定名供 ADR 校对。
    for capability in TOOL_ALIASES.iter().flat_map(|(_, aliases)| *aliases) {
        let hits: Vec<&String> = qualified
            .iter()
            .filter(|id| id.rsplit(':').next() == Some(capability))
            .collect();
        assert!(!hits.is_empty(), "注册表里没有 `{capability}` 能力");
        println!("{capability} <- {hits:?}");
    }
}

#[test]
fn desktop_source_parsers_are_not_vacuous() {
    // 解析器一旦失配（签名改名、缩进变化）会返回空集，让所有子集断言空转通过。
    assert_eq!(declared_tools().len(), 8, "build_tools() 解析结果异常");
    assert_eq!(handled_tools().len(), 8, "execute_tool() 解析结果异常");
    assert!(approval_gated_tools().len() >= 8);
    assert!(edit_mode_whitelist_is_shared());
}

#[test]
fn desktop_declared_tools_match_executor() {
    assert_eq!(
        declared_tools(),
        handled_tools(),
        "build_tools() 声明与 execute_tool() 实现不一致：模型会调到未实现的工具"
    );
}

#[test]
fn desktop_tool_surface_is_covered_by_kernel_registry() {
    let kernel = short_ids(&kernel_registry());
    let mut uncovered = BTreeSet::new();
    for tool in declared_tools() {
        let aliases = alias_for(&tool);
        assert!(
            !aliases.is_empty(),
            "{tool} 没登记内核等价物；新工具要在 TOOL_ALIASES 里声明映射"
        );
        if !aliases.iter().any(|a| kernel.contains(*a)) {
            uncovered.insert(tool.clone());
        }
    }
    // 语义覆盖是硬断言，不参与「记录而非失败」。
    assert!(
        uncovered.is_empty(),
        "桌面工具在内核注册表里找不到任何等价实现：{uncovered:?}"
    );
}

#[test]
fn tool_gaps_are_exactly_the_recorded_ones() {
    assert_gaps("tool", &observe_gaps(), TOOL_PREFIXES);
}

// ─── 断言：审批档位映射 ───────────────────────────────────────────────────

#[test]
fn approval_map_covers_every_desktop_mode() {
    let mapped: BTreeSet<&str> = APPROVAL_MODE_MAP.iter().map(|m| m.desktop_mode).collect();
    let declared: BTreeSet<&str> = DESKTOP_APPROVAL_MODES.iter().copied().collect();
    assert_eq!(mapped, declared);
    // 桌面档位集合的唯一真源是 APPROVAL_MODE_MAP —— settings::validate 必须
    // 直接用它，否则两处白名单会各写一套并各自漂移。
    assert!(
        edit_mode_whitelist_is_shared(),
        "settings::validate 的 edit_mode 白名单不再引用 DESKTOP_APPROVAL_MODES"
    );
}

#[test]
fn approval_map_targets_exist_on_the_kernel_wire_types() {
    for row in APPROVAL_MODE_MAP {
        // 构造本身就是编译期证明 `ClientCapabilities` 仍有这两个字段。
        let caps = ClientCapabilities {
            yolo_mode: row.kernel_flags.yolo_mode,
            auto_mode: row.kernel_flags.auto_mode,
            ..Default::default()
        };
        assert_eq!(caps.yolo_mode, row.kernel_flags.yolo_mode);
        assert_eq!(caps.auto_mode, row.kernel_flags.auto_mode);
        assert_eq!(kernel_approval_flags(row.desktop_mode), row.kernel_flags);

        if let Some(id) = row.kernel_session_mode {
            assert!(
                KERNEL_SESSION_MODE_IDS.contains(&id),
                "{} 映射到未知 session mode {id}",
                row.desktop_mode
            );
        }
    }
    // 内核枚举也得仍是这三档；改名或加档会在这里红。
    for id in KERNEL_SESSION_MODE_IDS {
        assert_eq!(
            SessionMode::from_id(id).as_id(),
            id,
            "SessionMode {id} 变了"
        );
    }
    assert_eq!(SessionMode::from_id("plan").as_id(), "plan");
}

#[test]
fn kernel_session_mode_is_never_sent_by_the_desktop() {
    for mode in DESKTOP_APPROVAL_MODES {
        assert_eq!(
            kernel_session_mode_id(mode),
            None,
            "{mode} 档现在会下发 session mode 了 —— 请同步 KNOWN_GAPS 与 ADR"
        );
    }
    // 内核确实支持 plan：差异是桌面没用，不是内核缺能力。
    assert!(SessionMode::from_id("plan").is_plan());
}

#[test]
fn mode_and_bridge_gaps_are_exactly_the_recorded_ones() {
    let gaps = observe_gaps();
    assert_gaps("mode", &gaps, MODE_PREFIXES);
    assert_gaps("bridge", &gaps, BRIDGE_PREFIXES);
}

// ─── 断言：降级路径 ───────────────────────────────────────────────────────

#[test]
fn fallback_decision_is_pure_and_keeps_reason() {
    assert_eq!(
        kernel_route(false, None),
        KernelRoute::LegacyBySetting,
        "关闭内核时不该尝试连接，也不算降级"
    );
    assert_eq!(kernel_route(true, None), KernelRoute::UseKernel);
    let route = kernel_route(true, Some("ACP 连接 leader 失败: no binary"));
    assert_eq!(
        route,
        KernelRoute::FallbackToLegacy {
            reason: "ACP 连接 leader 失败: no binary".to_string()
        }
    );
    let line = route.diagnostic_line().expect("降级必须产出诊断行");
    assert!(line.starts_with(FALLBACK_LOG_PREFIX), "文案漂移：{line}");
    assert!(
        line.contains("no binary"),
        "诊断行丢了原始原因，用户无法自查：{line}"
    );
    assert_eq!(kernel_route(false, Some("x")).diagnostic_line(), None);
}

#[test]
fn agent_and_bridge_actually_route_through_the_shared_source() {
    // 提取只有在「运行时真的走它」时才有意义 —— 钉住调用点。
    assert!(
        AGENT_SRC.contains("approval_mode::kernel_route(true, Some(&e))"),
        "agent_send 不再经 kernel_route 做降级判定"
    );
    assert!(
        AGENT_SRC.contains("route.diagnostic_line()"),
        "降级原因没被取出，无法上报"
    );
    assert!(
        AGENT_SRC.contains("tracing::warn!(\"{line}\")"),
        "降级必须打 warn 日志"
    );
    assert!(
        AGENT_SRC.contains("push_log(&state.log_buffer, \"WARN\", &line)"),
        "降级原因必须进诊断面板用的 log_buffer"
    );
    assert!(
        ACP_BRIDGE_SRC.contains("approval_mode::kernel_approval_flags(edit_mode)"),
        "acp_bridge 不再用共享映射表上报审批标志"
    );
    assert!(
        SETTINGS_SRC.contains("approval_mode::resolve_kernel_agent("),
        "settings 不再用共享判定算 kernel_agent 的条件默认值"
    );
}

// ─── 断言：灰度默认值 ─────────────────────────────────────────────────────

#[test]
fn conditional_default_rules() {
    // 老用户（有存值）永远保持存值，与能否找到二进制无关。
    assert!(!resolve_kernel_agent(Some(false), true));
    assert!(resolve_kernel_agent(Some(true), false));
    // 新装：定位得到 `wth` 才开。
    assert!(resolve_kernel_agent(None, true));
    assert!(!resolve_kernel_agent(None, false));
}

#[test]
fn conditional_default_is_wired_without_breaking_persistence() {
    // 持久化红线：字段必须仍是 `#[serde(default)]`，否则旧 settings.json 解析失败。
    let field = SETTINGS_SRC
        .find("pub kernel_agent: bool,")
        .expect("kernel_agent 字段被删了");
    assert!(
        SETTINGS_SRC[field - 200..field].contains("#[serde(default)]"),
        "kernel_agent 丢了 #[serde(default)]"
    );
    // 无条件基线仍为 false；灰度只发生在 load_settings 的「无可解析记录」分支。
    assert!(
        SETTINGS_SRC.contains("kernel_agent: false,"),
        "Default::default() 基线值被改动"
    );
    assert!(
        SETTINGS_SRC.contains("fn load_settings_with("),
        "load_settings 的探针注入点没了，单测会依赖真实 PATH"
    );
    assert!(
        SETTINGS_SRC.contains("fn kernel_binary_path("),
        "缺少内核二进制定位函数（显式路径 / WTH_LEADER_BIN / 同目录 / PATH）"
    );
    assert!(
        SETTINGS_SRC.contains("Some(settings) => settings,"),
        "有可解析记录时不再原样返回 —— 老用户可能被静默切内核"
    );
}

// ─── 棘轮的另一半：登记表不许留僵尸条目 ───────────────────────────────────

#[test]
fn gap_records_are_not_stale() {
    let observed = observe_gaps();
    for recorded in KNOWN_GAPS {
        assert!(
            observed.contains(*recorded),
            "KNOWN_GAPS 里的 `{recorded}` 已不再成立：请删除条目并更新 \
             docs/adr/kernel-parity.md 的已知差异表"
        );
    }
}
