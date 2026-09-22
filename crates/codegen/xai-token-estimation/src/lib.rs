//! Pure shared token-estimation primitives.
//!
//! This crate is the single source of truth for token counting and the
//! derived-display arithmetic that `/context`, `/session-info`, the
//! auto-compact gates, the preflight overflow check, and every client
//! renderer use to talk about context-window usage.
//!
//! ## Counting tiers
//!
//! 1. **Model-aware BPE counting** ([`estimate_tokens_for_model`]) — real
//!    tokenizer counts via `tiktoken-rs` for model families whose tokenizers
//!    we bundle (OpenAI `cl100k`/`o200k`, and `cl100k` as an approximation
//!    for DeepSeek). Callers that know the model id should prefer this.
//! 2. **CJK-aware heuristic** ([`estimate_tokens`]) — the shared default.
//!    ASCII/latin text keeps the historical bytes/4 arithmetic; CJK, kana,
//!    and Hangul characters count as one token each, which corrects the
//!    severe undercount the raw bytes/4 rule produced for Chinese/Japanese/
//!    Korean input (3 UTF-8 bytes per ideograph → 0.75 tokens, versus the
//!    ~1.0–1.5 real tokens). Underestimating drives the auto-compact gates
//!    to fire too late and overflow the context window, so the heuristic is
//!    deliberately conservative for CJK.
//! 3. **Legacy bytes/4** ([`estimate_tokens_bytes4`]) — preserved verbatim
//!    for callers that need the old semantics (e.g. byte-budget sizing).
//!
//! The heuristic tier stays dependency-free in spirit (no I/O, no runtime
//! download); the BPE tier is CPU-only construction, cached process-wide.

/// Bytes per token under the rough character-based heuristic.
pub const BYTES_PER_TOKEN: u64 = 4;

/// Per-image approximate token cost when summing
/// low-resolution image patches.
pub const IMAGE_TOKEN_ESTIMATE: u64 = 765;

/// Bytes/4 estimate of a string's token count (legacy semantics).
///
/// Prefer [`estimate_tokens`] (CJK-aware) for context accounting and
/// [`estimate_tokens_for_model`] when the model id is known.
#[inline]
pub fn estimate_tokens_bytes4(s: &str) -> u64 {
    (s.len() as u64) / BYTES_PER_TOKEN
}

/// CJK-aware token estimate of a string's token count.
///
/// ASCII text reduces exactly to the historical bytes/4 arithmetic;
/// CJK ideographs, kana, and Hangul syllables count as one token each and
/// contribute no bytes to the byte-half of the estimate.
#[inline]
pub fn estimate_tokens(s: &str) -> u64 {
    let mut cjk_chars: u64 = 0;
    let mut other_bytes: u64 = 0;
    for ch in s.chars() {
        if is_cjk(ch) {
            cjk_chars += 1;
        } else {
            other_bytes += ch.len_utf8() as u64;
        }
    }
    other_bytes / BYTES_PER_TOKEN + cjk_chars
}

/// True when `ch` is a CJK ideograph, CJK punctuation, kana, or Hangul
/// syllable — the code-point ranges where BPE tokenizers commonly spend
/// (at least) one token per character.
#[inline]
pub fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x3000..=0x303F   // CJK symbols and punctuation
        | 0x3040..=0x30FF // Hiragana + Katakana
        | 0x3130..=0x318F // Hangul compatibility jamo
        | 0x3400..=0x4DBF // CJK unified ideographs extension A
        | 0x4E00..=0x9FFF // CJK unified ideographs
        | 0xAC00..=0xD7AF // Hangul syllables
        | 0xF900..=0xFAFF // CJK compatibility ideographs
        | 0xFF00..=0xFFEF // Full-width forms
    )
}

/// Which tokenizer family a model id belongs to, as far as this crate can
/// tell from the name alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelFamily {
    /// OpenAI models whose tokenizer ships in `tiktoken-rs` (`cl100k` or
    /// `o200k`, selected by model id).
    OpenAi,
    /// DeepSeek models — approximated with `cl100k` (their native BPE is
    /// not public, but vocabulary overlap makes the count close).
    DeepSeek,
    /// Anthropic Claude models — no public offline tokenizer; use the
    /// CJK-aware heuristic.
    Anthropic,
    /// Everything else (Grok, Qwen, GLM, Llama, Ollama tags, ...) —
    /// CJK-aware heuristic.
    Other,
}

/// Best-effort model-family classification from a model id.
pub fn model_family(model: &str) -> ModelFamily {
    let m = model.to_ascii_lowercase();
    if m.contains("deepseek") {
        return ModelFamily::DeepSeek;
    }
    if m.contains("claude") {
        return ModelFamily::Anthropic;
    }
    const OPENAI_MARKERS: &[&str] = &[
        "gpt-",
        "gpt4",
        "gpt5",
        "chatgpt",
        "codex",
        "davinci",
        "text-embedding",
        "omni",
    ];
    if OPENAI_MARKERS.iter().any(|marker| m.contains(marker))
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4-")
    {
        return ModelFamily::OpenAi;
    }
    ModelFamily::Other
}

/// Token estimate for `s` as `model` would count it.
///
/// Uses a real bundled BPE for [`ModelFamily::OpenAi`] and
/// [`ModelFamily::DeepSeek`]; falls back to the CJK-aware heuristic
/// (matching [`estimate_tokens`]) for every other family or if BPE
/// construction fails.
pub fn estimate_tokens_for_model(model: &str, s: &str) -> u64 {
    match model_family(model) {
        ModelFamily::OpenAi => {
            let bpe = if uses_o200k(model) {
                o200k_bpe()
            } else {
                cl100k_bpe()
            };
            bpe.and_then(|bpe| bpe.encode_ordinary(s).len().try_into().ok())
                .unwrap_or_else(|| estimate_tokens(s))
        }
        ModelFamily::DeepSeek => cl100k_bpe()
            .and_then(|bpe| bpe.encode_ordinary(s).len().try_into().ok())
            .unwrap_or_else(|| estimate_tokens(s)),
        ModelFamily::Anthropic | ModelFamily::Other => estimate_tokens(s),
    }
}
/// Model ids tokenized with `o200k_base` (GPT-4o/4.1/5 generations, the
/// `o`-series reasoners, and chatgpt-branded variants). Everything else
/// OpenAI defaults to `cl100k_base`.
fn uses_o200k(model: &str) -> bool {
    let m = model.to_ascii_lowercase();
    const O200K_MARKERS: &[&str] = &["gpt-4o", "gpt-4.1", "gpt-5", "chatgpt", "omni", "codex"];
    O200K_MARKERS.iter().any(|marker| m.contains(marker))
        || m.starts_with("o1")
        || m.starts_with("o3")
        || m.starts_with("o4-")
}

fn o200k_bpe() -> Option<&'static tiktoken_rs::CoreBPE> {
    static BPE: std::sync::OnceLock<Option<tiktoken_rs::CoreBPE>> = std::sync::OnceLock::new();
    BPE.get_or_init(|| tiktoken_rs::o200k_base().ok()).as_ref()
}

fn cl100k_bpe() -> Option<&'static tiktoken_rs::CoreBPE> {
    static BPE: std::sync::OnceLock<Option<tiktoken_rs::CoreBPE>> = std::sync::OnceLock::new();
    BPE.get_or_init(|| tiktoken_rs::cl100k_base().ok()).as_ref()
}

/// Inverse of [`estimate_tokens`]: convert a token budget into a character
/// budget. Used by skill discovery to size text passages against the model's
/// context window. (Byte-oriented; exact for ASCII-only text.)
#[inline]
pub fn estimate_chars(tokens: u64) -> u64 {
    tokens.saturating_mul(BYTES_PER_TOKEN)
}

/// Token estimate for `image_count` images at [`IMAGE_TOKEN_ESTIMATE`] each.
#[inline]
pub fn estimate_image_tokens(image_count: u64) -> u64 {
    image_count.saturating_mul(IMAGE_TOKEN_ESTIMATE)
}

/// Usage percentage as `f64`, clamped to `100.0`. Returns `0.0` when
/// `total == 0`.
#[inline]
pub fn usage_percentage(used: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        ((used as f64) / (total as f64) * 100.0).min(100.0)
    }
}

/// Usage percentage rounded to `u8`, clamped to `100`.
#[inline]
pub fn usage_percentage_u8(used: u64, total: u64) -> u8 {
    usage_percentage(used, total).round() as u8
}

/// Integer-arithmetic (truncating) usage percentage, clamped to `100`.
///
/// Differs from [`usage_percentage_u8`] in two ways: no `f64` round-trip,
/// and the result is **truncated** (not rounded).
///
/// Returns `u8` because the result is bounded to `100`. Saturates on
/// overflow via `saturating_mul`.
#[inline]
pub fn usage_percentage_truncated_u8(used: u64, total: u64) -> u8 {
    if total == 0 {
        0
    } else {
        ((used.saturating_mul(100) / total).min(100)) as u8
    }
}

/// `total - used`, saturating at zero. The "free" portion of the context
/// window for `/context` rendering.
#[inline]
pub fn free_tokens(total: u64, used: u64) -> u64 {
    total.saturating_sub(used)
}

/// True when `used >= context_window * threshold_percent / 100`. Returns
/// `false` for `context_window == 0` so callers do not have to special-case
/// missing windows. Computed in integer arithmetic to match the existing
/// auto-compact gate semantics.
#[inline]
pub fn exceeds_threshold(used: u64, context_window: u64, threshold_percent: u8) -> bool {
    if context_window == 0 {
        return false;
    }
    used.saturating_mul(100) >= context_window.saturating_mul(threshold_percent as u64)
}

/// True when `used * 100 >= context_window * threshold_percent - headroom * 100`,
/// the scaled form of [`exceeds_threshold`] minus a token headroom.
/// Returns `false` for `context_window == 0`.
#[inline]
pub fn exceeds_threshold_with_headroom(
    used: u64,
    context_window: u64,
    threshold_percent: u8,
    headroom: u64,
) -> bool {
    if context_window == 0 {
        return false;
    }
    used.saturating_mul(100)
        >= context_window
            .saturating_mul(threshold_percent as u64)
            .saturating_sub(headroom.saturating_mul(100))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_tokens_is_bytes_over_four() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abc"), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens(&"x".repeat(4000)), 1000);
    }

    /// ASCII text keeps the exact legacy bytes/4 arithmetic.
    #[test]
    fn estimate_tokens_matches_bytes4_for_ascii() {
        for s in ["", "abc", "abcd", "hello world", &"x".repeat(4000)] {
            assert_eq!(estimate_tokens(s), estimate_tokens_bytes4(s), "input: {s}");
        }
    }

    /// CJK text previously undercounted by ~4x (3 bytes/char → 0.75 tokens
    /// versus ~1 real token). The CJK-aware rule counts one token per
    /// ideograph, which must never be below the legacy estimate for
    /// CJK-bearing input.
    #[test]
    fn estimate_tokens_counts_cjk_chars_as_tokens() {
        assert_eq!(estimate_tokens("你好"), 2);
        assert_eq!(estimate_tokens("你好世界"), 4);
        assert_eq!(estimate_tokens("こんにちは"), 5);
        assert_eq!(estimate_tokens("안녕하세요"), 5);
        // Mixed: "abc " is 4 other-bytes (1 token) + 2 CJK chars.
        assert_eq!(estimate_tokens("abc 你好"), 3);
        // Full-width punctuation is CJK-classified.
        assert_eq!(estimate_tokens("你好。"), 3);
        assert!(estimate_tokens("你好") > estimate_tokens_bytes4("你好"));
    }

    #[test]
    fn is_cjk_covers_expected_ranges() {
        assert!(is_cjk('你'));
        assert!(is_cjk('あ'));
        assert!(is_cjk('가'));
        assert!(is_cjk('。'));
        assert!(is_cjk('Ａ')); // full-width
        assert!(!is_cjk('a'));
        assert!(!is_cjk(' '));
        assert!(!is_cjk('é'));
    }

    #[test]
    fn model_family_classification() {
        assert_eq!(model_family("gpt-4"), ModelFamily::OpenAi);
        assert_eq!(model_family("gpt-4.1"), ModelFamily::OpenAi);
        assert_eq!(model_family("gpt-4o-mini"), ModelFamily::OpenAi);
        assert_eq!(model_family("o3-mini"), ModelFamily::OpenAi);
        assert_eq!(model_family("codex-latest"), ModelFamily::OpenAi);
        assert_eq!(model_family("deepseek-chat"), ModelFamily::DeepSeek);
        assert_eq!(model_family("deepseek-reasoner"), ModelFamily::DeepSeek);
        assert_eq!(
            model_family("claude-sonnet-4-20250514"),
            ModelFamily::Anthropic
        );
        assert_eq!(model_family("grok-build"), ModelFamily::Other);
        assert_eq!(model_family("qwen3:8b"), ModelFamily::Other);
        assert_eq!(model_family("llama3.2"), ModelFamily::Other);
        assert_eq!(model_family(""), ModelFamily::Other);
    }

    /// Anchor: `cl100k_base` encodes "hello world" as 2 tokens. Pins that
    /// the BPE path is actually reached for cl100k-classified models.
    #[test]
    fn estimate_tokens_for_model_uses_cl100k_for_gpt4() {
        assert_eq!(estimate_tokens_for_model("gpt-4", "hello world"), 2);
    }

    /// Property: the model-aware estimate is total, non-negative, and
    /// bounded (never wildly above the bytes/4 ceiling — BPE never spends
    /// more than ~1 token per byte for these tokenizers).
    #[test]
    fn estimate_tokens_for_model_is_bounded() {
        let samples = [
            "def tokenize(text: str) -> list[int]: ...",
            "你好，世界！这是一个测试。",
            "",
            "mixed 中文 and english 🎉 emoji",
        ];
        for model in [
            "gpt-4o",
            "gpt-4",
            "deepseek-chat",
            "claude-sonnet-4",
            "qwen3:8b",
        ] {
            for s in samples {
                let est = estimate_tokens_for_model(model, s);
                assert!(
                    est <= (s.len() as u64).max(1),
                    "model={model} s={s:?} est={est}"
                );
            }
        }
    }

    /// DeepSeek and OpenAI families fall back to the heuristic if BPE
    /// construction fails; Anthropic/Other always use it. Just pins the
    /// Anthropic path equals `estimate_tokens`.
    #[test]
    fn estimate_tokens_for_model_heuristic_families_match_estimate_tokens() {
        for model in ["claude-sonnet-4", "grok-build", "qwen3:8b"] {
            for s in ["hello", "你好世界", "mixed 中文 text"] {
                assert_eq!(estimate_tokens_for_model(model, s), estimate_tokens(s));
            }
        }
    }

    #[test]
    fn estimate_chars_is_inverse() {
        assert_eq!(estimate_chars(0), 0);
        assert_eq!(estimate_chars(1), 4);
        assert_eq!(estimate_chars(1000), 4000);
    }

    #[test]
    fn estimate_image_tokens_uses_constant() {
        assert_eq!(estimate_image_tokens(0), 0);
        assert_eq!(estimate_image_tokens(1), IMAGE_TOKEN_ESTIMATE);
        assert_eq!(estimate_image_tokens(3), 3 * IMAGE_TOKEN_ESTIMATE);
    }

    #[test]
    fn usage_percentage_clamps_and_handles_zero_total() {
        assert_eq!(usage_percentage(0, 0), 0.0);
        assert_eq!(usage_percentage(50, 100), 50.0);
        assert_eq!(usage_percentage(150, 100), 100.0);
        assert_eq!(usage_percentage(100, 0), 0.0);
    }

    #[test]
    fn usage_percentage_u8_rounds() {
        assert_eq!(usage_percentage_u8(0, 100), 0);
        assert_eq!(usage_percentage_u8(50, 100), 50);
        assert_eq!(usage_percentage_u8(99, 100), 99);
        // 12_700 / 256_000 = 0.04960... -> 5 after rounding
        assert_eq!(usage_percentage_u8(12_700, 256_000), 5);
        assert_eq!(usage_percentage_u8(150, 100), 100);
    }

    /// Half-boundary contract — locks rounding direction. `85 / 200 = 0.425`
    /// becomes `42.5%` which rounds half-up to `43`. The truncating helper
    /// returns `42` for the same input (see `usage_percentage_truncated_u8`).
    #[test]
    fn usage_percentage_u8_rounds_half_up() {
        assert_eq!(usage_percentage_u8(85, 200), 43);
        // 7 / 8 = 0.875, rounds to 88 (truncated would be 87).
        assert_eq!(usage_percentage_u8(7, 8), 88);
    }

    #[test]
    fn usage_percentage_truncated_u8_clamps_and_handles_zero_total() {
        assert_eq!(usage_percentage_truncated_u8(0, 0), 0);
        assert_eq!(usage_percentage_truncated_u8(50, 100), 50);
        assert_eq!(usage_percentage_truncated_u8(150, 100), 100);
        // Large values do not overflow because we use saturating_mul.
        assert_eq!(usage_percentage_truncated_u8(u64::MAX, 1), 100);
    }

    /// Truncation contract — distinguishes this helper from
    /// `usage_percentage_u8`, which rounds. Locks in that
    /// `exceeds_threshold(used, cw, p)` and
    /// `usage_percentage_truncated_u8(used, cw) >= p` agree.
    #[test]
    fn usage_percentage_truncated_u8_truncates_does_not_round() {
        // 85 / 200 = 0.425, truncated -> 42 (rounded would be 43).
        assert_eq!(usage_percentage_truncated_u8(85, 200), 42);
        // 7 / 8 = 0.875, truncated -> 87 (rounded would be 88).
        assert_eq!(usage_percentage_truncated_u8(7, 8), 87);
    }

    #[test]
    fn free_tokens_saturates() {
        assert_eq!(free_tokens(100, 30), 70);
        assert_eq!(free_tokens(100, 100), 0);
        assert_eq!(free_tokens(100, 200), 0);
    }

    #[test]
    fn exceeds_threshold_matches_integer_pct() {
        assert!(!exceeds_threshold(50, 100, 85));
        assert!(exceeds_threshold(85, 100, 85));
        assert!(exceeds_threshold(99, 100, 85));
        assert!(!exceeds_threshold(50, 0, 85));
    }

    /// Strict-boundary contract — pin the `>=` semantics. At cw=1000,
    /// pct=85, `850 * 100 == 1000 * 85` so the gate must fire at exactly
    /// 850 tokens. This is one token earlier than the legacy `>` gate
    /// (`total > cw * pct / 100` which fired at 851).
    #[test]
    fn exceeds_threshold_fires_on_strict_boundary() {
        assert!(exceeds_threshold(850, 1000, 85));
        assert!(!exceeds_threshold(849, 1000, 85));
        // 1000 * 85 / 100 = 850, so 850 is the new strict boundary.
        // Same shape at the other commonly-configured threshold (95%):
        assert!(exceeds_threshold(950, 1000, 95));
        assert!(!exceeds_threshold(949, 1000, 95));
    }

    /// Property: with `headroom == 0` the helper agrees with
    /// [`exceeds_threshold`] across a representative grid of inputs,
    /// including the non-round windows where floor-divide drifts.
    #[test]
    fn exceeds_threshold_with_headroom_zero_headroom_matches_exceeds_threshold() {
        for cw in [0_u64, 1, 50, 100, 101, 1024, 100_000, 128_001, 1_000_001] {
            for pct in [0_u8, 1, 50, 85, 99, 100] {
                for used in [
                    0_u64,
                    1,
                    cw / 2,
                    cw.saturating_sub(1),
                    cw,
                    cw + 1,
                    cw + 1000,
                ] {
                    assert_eq!(
                        exceeds_threshold_with_headroom(used, cw, pct, 0),
                        exceeds_threshold(used, cw, pct),
                        "mismatch at used={used} cw={cw} pct={pct}",
                    );
                }
            }
        }
    }

    #[test]
    fn exceeds_threshold_with_headroom_subtracts_headroom() {
        // 100K window, 85% threshold = 85_000. Headroom 4_000 -> fires at 81_000.
        assert!(!exceeds_threshold_with_headroom(80_999, 100_000, 85, 4_000));
        assert!(exceeds_threshold_with_headroom(81_000, 100_000, 85, 4_000));
    }

    #[test]
    fn exceeds_threshold_with_headroom_zero_window() {
        assert!(!exceeds_threshold_with_headroom(0, 0, 85, 0));
        assert!(!exceeds_threshold_with_headroom(100, 0, 85, 4_000));
    }

    #[test]
    fn exceeds_threshold_with_headroom_headroom_larger_than_threshold_saturates() {
        // 100K * 85% = 85_000 (8_500_000 scaled). Headroom 1M tokens scales to
        // 100_000_000 — saturating sub yields 0, so any used fires.
        assert!(exceeds_threshold_with_headroom(0, 100_000, 85, 1_000_000));
    }
}
