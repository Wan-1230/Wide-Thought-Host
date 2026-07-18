//! Compaction policy — threshold, model, and memory flush configuration.

/// Session-level compaction policy.
///
/// Controls when and how the session's conversation is compacted
/// to free up context window space, and whether a memory flush
/// runs before each compaction.
#[derive(Debug, Clone)]
pub struct CompactionPolicy {
    /// Percentage of context window that triggers auto-compaction.
    /// E.g., 85 means compact when 85% of the context window is used.
    pub auto_compact_threshold_percent: u32,

    /// Model to use for generating the compaction summary.
    /// None = use the session's current model.
    pub compact_model: Option<String>,

    /// Whether to run a memory flush turn before each compaction.
    /// When enabled, the session actor asks the model to summarize
    /// important information from the conversation before it's compacted.
    /// Requires the memory system to be enabled.
    pub memory_flush_enabled: bool,

    /// Per-compaction wall-clock budget (seconds); a generation exceeding it is
    /// cut and retried — the backstop for reasoning runaways token limits miss.
    pub wall_clock_budget_secs: u64,

    /// Prefire two-pass compaction: when usage approaches the threshold,
    /// speculatively summarize the history prefix in the background (pass 1);
    /// at compaction, summarize NOTE₁ + the recent tail (pass 2). Resolved from
    /// config (`two_pass_compaction` flag) at session build; `false` keeps the
    /// legacy single-pass path. Default `false` (real sessions set it from config).
    pub two_pass_enabled: bool,
}

impl Default for CompactionPolicy {
    fn default() -> Self {
        Self {
            /// Compact at 70% context usage instead of 85% — reduces risk
            /// of context overflow on large tool outputs and leaves headroom
            /// for multi-turn reasoning without truncation.
            auto_compact_threshold_percent: 70,
            compact_model: None,
            /// Enable memory flush by default: before compaction, ask the
            /// model to summarize key facts, decisions, and context worth
            /// preserving. This increases cache-hit potential across
            /// compaction boundaries.
            memory_flush_enabled: true,
            /// Tighter wall-clock budget (120s vs 300s) — reasoning
            /// runaways waste tokens quickly; cut and retry sooner.
            wall_clock_budget_secs: 120,
            /// Enable two-pass compaction: background summarize the
            /// history prefix (pass 1), then merge with the recent tail
            /// (pass 2). Reduces summary latency for large histories.
            two_pass_enabled: true,
        }
    }
}
