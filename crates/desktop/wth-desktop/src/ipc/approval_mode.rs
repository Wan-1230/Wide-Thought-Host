//! 双内核（自研循环 ⇄ ACP 内核）对齐面的单一事实源：审批档位映射、路由与
//! 降级判定、`kernel_agent` 的条件默认值。
//!
//! 本模块刻意只依赖 std：`tests/kernel_parity.rs` 用 `#[path]` 把它原样编进
//! 测试 crate，从而断言**运行时真正执行的那份映射**，而不是测试里另抄一遍。
//! 引入任何 `crate::` 依赖都会让这条链路失效。

/// 桌面审批档位；与 `settings::validate` 接受的 `edit_mode` 集合一致。
pub const DESKTOP_APPROVAL_MODES: [&str; 4] = ["plan", "review", "auto", "yolo"];

/// 内核 `SessionMode` 的线上传输 id（`xai_grok_tools::types::SessionMode`）。
/// 运行时尚未使用（见 `kernel_session_mode_id`），由 kernel_parity 测试读取以
/// 钉住 D5 差异；接线后这两个条目即为 live 代码。
#[allow(dead_code)]
pub const KERNEL_SESSION_MODE_IDS: [&str; 3] = ["default", "plan", "ask"];

/// 内核 `ClientCapabilities` 能表达的审批意图（两标志，无四档概念）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KernelApprovalFlags {
    pub yolo_mode: bool,
    pub auto_mode: bool,
}

/// 一个桌面档位在内核侧的实际落点。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApprovalModeMapping {
    pub desktop_mode: &'static str,
    /// 连接 leader 时上报的 `ClientCapabilities` 标志。
    pub kernel_flags: KernelApprovalFlags,
    /// 桌面端是否把该档位下发为内核 session mode；`None` = 从不下发。
    pub kernel_session_mode: Option<&'static str>,
}

const FLAGS_NONE: KernelApprovalFlags = KernelApprovalFlags {
    yolo_mode: false,
    auto_mode: false,
};
const FLAGS_AUTO: KernelApprovalFlags = KernelApprovalFlags {
    yolo_mode: false,
    auto_mode: true,
};
const FLAGS_YOLO: KernelApprovalFlags = KernelApprovalFlags {
    yolo_mode: true,
    auto_mode: false,
};

/// 桌面四档 → 内核信号。`plan` 与 `review` 在内核侧塌缩为同一组标志，
/// 且四档都不下发 session mode —— 这两条差异记录在
/// `docs/adr/kernel-parity.md` 的已知差异表，由 `kernel_parity` 测试锁定。
pub const APPROVAL_MODE_MAP: [ApprovalModeMapping; 4] = [
    ApprovalModeMapping {
        desktop_mode: "plan",
        kernel_flags: FLAGS_NONE,
        kernel_session_mode: None,
    },
    ApprovalModeMapping {
        desktop_mode: "review",
        kernel_flags: FLAGS_NONE,
        kernel_session_mode: None,
    },
    ApprovalModeMapping {
        desktop_mode: "auto",
        kernel_flags: FLAGS_AUTO,
        kernel_session_mode: None,
    },
    ApprovalModeMapping {
        desktop_mode: "yolo",
        kernel_flags: FLAGS_YOLO,
        kernel_session_mode: None,
    },
];

/// 桌面档位 → 内核审批标志。未知档位回退为「两标志皆 false」，与
/// `ClientCapabilities::default()` 一致，不引入新行为。
pub fn kernel_approval_flags(edit_mode: &str) -> KernelApprovalFlags {
    APPROVAL_MODE_MAP
        .iter()
        .find(|m| m.desktop_mode.eq_ignore_ascii_case(edit_mode))
        .map(|m| m.kernel_flags)
        .unwrap_or_default()
}

/// 桌面档位 → 内核 session mode id；当前实现恒为 `None`（差异 D5）。
#[allow(dead_code)]
pub fn kernel_session_mode_id(edit_mode: &str) -> Option<&'static str> {
    APPROVAL_MODE_MAP
        .iter()
        .find(|m| m.desktop_mode.eq_ignore_ascii_case(edit_mode))
        .and_then(|m| m.kernel_session_mode)
}

/// 降级日志前缀；`agent.rs` 的 warn 与诊断面板共用，避免两处文案漂移。
pub const FALLBACK_LOG_PREFIX: &str = "内核桥接不可用，回退自研循环";

/// 一轮 `agent_send` 走哪条执行路径。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KernelRoute {
    /// 内核已连接：本轮由 ACP 桥处理。
    UseKernel,
    /// `kernel_agent` 关闭：自研循环是主路径，不算降级。
    LegacyBySetting,
    /// `kernel_agent` 开启但连接失败：降级，原因必须可见。
    FallbackToLegacy { reason: String },
}

/// 纯函数化的路由判定 —— `agent_send` 里唯一的分支来源。
pub fn kernel_route(kernel_enabled: bool, connect_error: Option<&str>) -> KernelRoute {
    if !kernel_enabled {
        return KernelRoute::LegacyBySetting;
    }
    match connect_error {
        None => KernelRoute::UseKernel,
        Some(reason) => KernelRoute::FallbackToLegacy {
            reason: reason.to_string(),
        },
    }
}

impl KernelRoute {
    /// 写入诊断面板（`state::push_log` → 「最近日志」/ `log_list`）的降级记录。
    /// 非降级路径返回 `None`，避免正常会话被噪音污染。
    pub fn diagnostic_line(&self) -> Option<String> {
        match self {
            KernelRoute::FallbackToLegacy { reason } => {
                Some(format!("{FALLBACK_LOG_PREFIX}: {reason}"))
            }
            _ => None,
        }
    }
}

/// `kernel_agent` 的取值规则（灰度默认值）。
///
/// 只有「本机没有任何可解析的持久化设置」才允许按内核可定位性给默认值；
/// 已有记录一律沿用存值，字段缺失时由 `#[serde(default)]` 落到 `false`，
/// 从而保证老用户不被静默切换内核。
pub fn resolve_kernel_agent(persisted: Option<bool>, kernel_binary_found: bool) -> bool {
    persisted.unwrap_or(kernel_binary_found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_are_the_only_two_bit_combinations() {
        assert_eq!(kernel_approval_flags("plan"), FLAGS_NONE);
        assert_eq!(kernel_approval_flags("review"), FLAGS_NONE);
        assert_eq!(kernel_approval_flags("auto"), FLAGS_AUTO);
        assert_eq!(kernel_approval_flags("YOLO"), FLAGS_YOLO);
        assert_eq!(
            kernel_approval_flags("nonsense"),
            KernelApprovalFlags::default()
        );
    }

    #[test]
    fn fallback_carries_reason() {
        let route = kernel_route(true, Some("boom"));
        assert_eq!(
            route.diagnostic_line().as_deref(),
            Some("内核桥接不可用，回退自研循环: boom")
        );
        assert_eq!(
            kernel_route(false, Some("boom")),
            KernelRoute::LegacyBySetting
        );
        assert_eq!(kernel_route(true, None), KernelRoute::UseKernel);
        assert_eq!(kernel_route(false, None).diagnostic_line(), None);
    }

    #[test]
    fn persisted_value_wins_over_probe() {
        assert!(!resolve_kernel_agent(Some(false), true));
        assert!(resolve_kernel_agent(Some(true), false));
        assert!(resolve_kernel_agent(None, true));
        assert!(!resolve_kernel_agent(None, false));
    }
}
