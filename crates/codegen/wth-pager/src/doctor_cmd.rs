//! `wth doctor` — one-shot environment and capability diagnostics.
//!
//! Aggregates version, paths, model defaults, sandbox posture, terminal
//! capability, update channel, and MCP server health so a single command can
//! triage a broken install without running the TUI.

use anyhow::Result;
use serde::Serialize;
use std::path::PathBuf;

use crate::terminal::terminal_context;

#[derive(Debug, Clone, Serialize)]
pub struct DoctorCheck {
    pub id: String,
    pub status: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorReport {
    pub checks: Vec<DoctorCheck>,
    pub fail_count: usize,
    pub warn_count: usize,
}

fn push(
    checks: &mut Vec<DoctorCheck>,
    id: &str,
    status: &str,
    summary: impl Into<String>,
    detail: Option<String>,
    fix: Option<String>,
) {
    checks.push(DoctorCheck {
        id: id.to_string(),
        status: status.to_string(),
        summary: summary.into(),
        detail,
        fix,
    });
}

fn check_version(checks: &mut Vec<DoctorCheck>) {
    let version = crate::client_identity::PAGER_CLIENT_VERSION;
    let channel = xai_grok_update::channel_name().unwrap_or("unknown");
    push(
        checks,
        "version",
        "ok",
        format!("wth {version}"),
        Some(format!("channel: {channel}")),
        None,
    );
}

fn check_paths(checks: &mut Vec<DoctorCheck>) {
    let home = xai_grok_shell::util::grok_home::grok_home();
    let home_ok = home.exists();
    push(
        checks,
        "paths",
        if home_ok { "ok" } else { "warn" },
        if home_ok {
            format!("home: {}", home.display())
        } else {
            format!(
                "home missing (created on first use): {}",
                home.display()
            )
        },
        None,
        if home_ok {
            None
        } else {
            Some("Start `wth` once to initialize the home directory".into())
        },
    );

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    push(
        checks,
        "cwd",
        "ok",
        format!("workspace: {}", cwd.display()),
        None,
        None,
    );
}

fn check_models(checks: &mut Vec<DoctorCheck>) {
    let default_model = std::env::var("WTH_MODEL")
        .or_else(|_| std::env::var("GROK_MODEL"))
        .ok()
        .filter(|s| !s.is_empty());
    match default_model {
        Some(m) => push(
            checks,
            "models",
            "ok",
            format!("model override from env: {m}"),
            None,
            None,
        ),
        None => push(
            checks,
            "models",
            "ok",
            "using configured/default model chain",
            Some("precedence: CLI > ENV > config > remote > builtin".into()),
            Some("Set WTH_MODEL or run `wth models` / `wth setup` to pin a model".into()),
        ),
    }
}

fn check_sandbox(checks: &mut Vec<DoctorCheck>) {
    let profile = std::env::var("GROK_SANDBOX_PROFILE")
        .or_else(|_| std::env::var("WTH_SANDBOX_PROFILE"))
        .unwrap_or_else(|_| "workspace".into());
    let (status, fix) = match profile.as_str() {
        "read-only" | "workspace" | "strict" => ("ok", None),
        "devbox" => (
            "warn",
            Some("devbox profile is broader than workspace".to_string()),
        ),
        "none" | "off" => (
            "warn",
            Some("sandbox disabled — prefer workspace or read-only".to_string()),
        ),
        other => ("warn", Some(format!("unknown sandbox profile '{other}'"))),
    };
    push(
        checks,
        "sandbox",
        status,
        format!("sandbox profile: {profile}"),
        Some("Windows uses Job Object containment for child processes".into()),
        fix,
    );
}

fn check_terminal(checks: &mut Vec<DoctorCheck>) {
    let ctx = terminal_context();
    let level = crate::theme::color_support::detect();
    let mut notes = Vec::new();
    notes.push(format!("brand: {:?}", ctx.brand));
    notes.push(format!("multiplexer: {:?}", ctx.multiplexer));
    notes.push(format!("color: {level:?}"));
    if ctx.is_ssh {
        notes.push("ssh: yes".into());
    }
    if let Some(term) = &ctx.term_var {
        notes.push(format!("TERM: {term}"));
    }

    // Conservative, env-only warnings — no tmux subprocess.
    let mut fix = None;
    let mut status = "ok";
    if matches!(ctx.brand, crate::terminal::TerminalName::AppleTerminal)
        && xai_grok_shell::util::clipboard::is_remote_session()
    {
        status = "warn";
        fix = Some(
            "macOS Terminal lacks OSC 52 — clipboard over SSH will not work".to_string(),
        );
    } else if matches!(
        level,
        crate::theme::color_support::ColorLevel::None
            | crate::theme::color_support::ColorLevel::Basic
            | crate::theme::color_support::ColorLevel::Ansi256
    ) {
        status = "warn";
        fix = Some("limited color support — truecolor themes will be reduced".into());
    }

    push(
        checks,
        "terminal",
        status,
        format!("terminal: {:?}", ctx.brand),
        Some(notes.join("; ")),
        fix,
    );
}

fn check_update(checks: &mut Vec<DoctorCheck>) {
    let channel = xai_grok_update::channel_name().unwrap_or("stable");
    push(
        checks,
        "update",
        "ok",
        format!("update channel: {channel}"),
        Some("`wth update --check` verifies the latest release".into()),
        None,
    );
}

fn check_env_quality(checks: &mut Vec<DoctorCheck>) {
    // O-03: 磁盘与关键目录可写性
    let home = xai_grok_shell::util::grok_home::grok_home();
    let mut notes = Vec::new();
    let mut status = "ok";
    if !home.exists() {
        if let Err(e) = std::fs::create_dir_all(&home) {
            status = "fail";
            notes.push(format!("cannot create home: {e}"));
        } else {
            notes.push("home created".into());
        }
    } else {
        notes.push(format!("home ok: {}", home.display()));
    }
    match std::env::current_dir() {
        Ok(cwd) => {
            let probe = cwd.join(".wth-write-probe");
            match std::fs::write(&probe, b"ok") {
                Ok(_) => {
                    let _ = std::fs::remove_file(&probe);
                    notes.push("cwd writable".into());
                }
                Err(e) => {
                    status = "warn";
                    notes.push(format!("cwd not writable: {e}"));
                }
            }
        }
        Err(e) => {
            status = "warn";
            notes.push(format!("cwd unavailable: {e}"));
        }
    }
    push(
        checks,
        "env",
        status,
        "environment / disk checks",
        Some(notes.join("; ")),
        if status == "fail" {
            Some("检查磁盘空间与目录权限".into())
        } else {
            None
        },
    );
}

async fn check_mcp(checks: &mut Vec<DoctorCheck>) {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let report = xai_grok_shell::mcp_doctor::run_doctor(&cwd, None).await;
    if report.servers.is_empty() {
        push(
            checks,
            "mcp",
            "ok",
            "no MCP servers configured",
            None,
            Some("Add one with `wth mcp add <name> <command>`".into()),
        );
        return;
    }
    let status = if report.failing_count > 0 {
        "fail"
    } else {
        "ok"
    };
    let detail = report
        .servers
        .iter()
        .map(|s| {
            format!(
                "{}: {} ({})",
                s.name,
                if s.healthy { "healthy" } else { "unhealthy" },
                s.transport
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    push(
        checks,
        "mcp",
        status,
        format!(
            "MCP servers: {} total, {} failing",
            report.servers.len(),
            report.failing_count
        ),
        Some(detail),
        if report.failing_count > 0 {
            Some("Run `wth mcp doctor` for per-server diagnostics".into())
        } else {
            None
        },
    );
}

/// Run all (or one) doctor checks and print a human or JSON report.
pub async fn run(json: bool, only: Option<String>) -> Result<()> {
    let mut checks: Vec<DoctorCheck> = Vec::new();
    let filter = only.as_deref().map(|s| s.to_ascii_lowercase());

    let want = |id: &str| filter.as_deref().is_none_or(|f| f == id);

    if want("version") {
        check_version(&mut checks);
    }
    if want("paths") {
        check_paths(&mut checks);
    }
    if want("models") {
        check_models(&mut checks);
    }
    if want("sandbox") {
        check_sandbox(&mut checks);
    }
    if want("terminal") {
        check_terminal(&mut checks);
    }
    if want("update") {
        check_update(&mut checks);
    }
    if want("env") {
        check_env_quality(&mut checks);
    }
    if want("mcp") {
        check_mcp(&mut checks).await;
    }

    let fail_count = checks.iter().filter(|c| c.status == "fail").count();
    let warn_count = checks.iter().filter(|c| c.status == "warn").count();

    let report = DoctorReport {
        checks,
        fail_count,
        warn_count,
    };

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).unwrap_or_default()
        );
    } else {
        println!("wth doctor");
        println!();
        for c in &report.checks {
            let mark = match c.status.as_str() {
                "ok" => "[ ok ]",
                "warn" => "[warn]",
                "fail" => "[FAIL]",
                _ => "[skip]",
            };
            println!("{mark} {:<10} {}", c.id, c.summary);
            if let Some(detail) = &c.detail {
                for line in detail.lines() {
                    println!("           {line}");
                }
            }
            if let Some(fix) = &c.fix {
                println!("           fix: {fix}");
            }
        }
        println!();
        if fail_count == 0 && warn_count == 0 {
            println!("All checks passed.");
        } else {
            println!("{warn_count} warning(s), {fail_count} failure(s)");
        }
    }

    if fail_count > 0 {
        std::process::exit(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doctor_report_serializes() {
        let report = DoctorReport {
            checks: vec![DoctorCheck {
                id: "version".into(),
                status: "ok".into(),
                summary: "ok".into(),
                detail: None,
                fix: None,
            }],
            fail_count: 0,
            warn_count: 0,
        };
        let s = serde_json::to_string(&report).unwrap();
        assert!(s.contains("\"version\""));
    }
}
