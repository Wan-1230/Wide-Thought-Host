//! Everything the TUI needs to put pixels on a terminal, and nothing about
//! running an agent: themes and appearance config, syntax highlighting,
//! markdown/mermaid drawing, terminal capability probing (truecolor, OSC 8,
//! kitty images, multiplexers), a `vte`-backed embed of command output,
//! clipboard writes, the `/gboom` easter egg. Layer L4 frontend plumbing;
//! `wth-pager` is its only consumer.
//!
//! Terminal facts latch into `OnceLock`s from the process env, so a test that
//! wants a different emulator or display server must call the pure
//! `*_from_env` helpers — the ambient getters have already decided.

pub mod appearance;
pub mod clipboard;
pub mod gboom;
pub mod glyphs;
pub mod host;
pub mod link_opener;
pub mod modal_window_state;
pub mod prompt_images;
pub mod render;
pub mod syntax;
pub mod terminal;
pub mod theme;
pub mod util;
