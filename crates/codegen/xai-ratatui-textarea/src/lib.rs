//! The prompt editor: a ratatui `TextArea` holding multiple `TextElement`s —
//! typed text interleaved with pasted-image and file chips — with selection,
//! word motions, undo/redo and screen-coordinate hit testing. Layer L1:
//! terminal-agnostic; consumers are the pager crates and `wth-markdown`.
//!
//! It never touches the pasteboard itself, only the injected
//! `ClipboardProvider` (default: in-memory `InternalClipboard`) — that is why
//! `arboard` is a dev-dependency here. Note that `cursor()` is a byte offset
//! which snaps to the nearest element boundary: a position you computed from
//! the plain text can silently move.

#![allow(clippy::new_without_default)]

pub mod render;
pub mod textarea;
pub mod wrapping;

pub use textarea::{
    ClipboardProvider, ElementId, ElementKind, InternalClipboard, MouseAction, TextArea,
    TextAreaState, TextElement, TextElementEvent, TextElementEventKind, is_undo_input,
};

use crossterm::event::KeyModifiers;

// On Windows, AltGr arrives as Ctrl+Alt; on other platforms it's composed before reaching us.
#[cfg(target_os = "windows")]
#[inline]
pub fn is_altgr(modifiers: KeyModifiers) -> bool {
    let without_shift = modifiers & !KeyModifiers::SHIFT;
    without_shift == (KeyModifiers::CONTROL | KeyModifiers::ALT)
}

#[cfg(not(target_os = "windows"))]
#[inline]
pub fn is_altgr(_modifiers: KeyModifiers) -> bool {
    false
}
