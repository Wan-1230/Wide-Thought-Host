//! 基于 portable-pty 的嵌入式终端。

use crate::state::{AppState, TerminalHandle};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, State};

#[derive(Debug, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub pid: u32,
    pub shell: String,
    pub cwd: String,
}

#[derive(Debug, Deserialize)]
pub struct TerminalSpawnArgs {
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default = "default_cols")]
    pub cols: u16,
    #[serde(default = "default_rows")]
    pub rows: u16,
}

fn default_cols() -> u16 {
    120
}
fn default_rows() -> u16 {
    32
}

#[derive(Debug, Deserialize)]
pub struct TerminalResizeArgs {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Serialize, Clone)]
struct TerminalDataEvent {
    id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
struct TerminalExitEvent {
    id: String,
    exit_code: Option<u32>,
    message: Option<String>,
}

fn find_on_path(program: &str) -> Option<PathBuf> {
    let path = Path::new(program);
    if path.is_absolute() && path.is_file() {
        return Some(path.to_path_buf());
    }
    let candidates = if Path::new(program).extension().is_some() {
        vec![program.to_string()]
    } else {
        vec![program.to_string(), format!("{program}.exe")]
    };
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|dir| candidates.iter().map(move |name| dir.join(name)))
            .find(|candidate| candidate.is_file())
    })
}

fn resolve_shell(requested: Option<&str>) -> Result<PathBuf, String> {
    if let Some(shell) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return find_on_path(shell).ok_or_else(|| format!("找不到指定 Shell：{shell}"));
    }
    for candidate in ["pwsh", "powershell", "cmd"] {
        if let Some(path) = find_on_path(candidate) {
            return Ok(path);
        }
    }
    Err("未找到 PowerShell 7、Windows PowerShell 或 cmd".into())
}

#[tauri::command]
pub async fn terminal_spawn(
    args: Option<TerminalSpawnArgs>,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<TerminalInfo, String> {
    let args = args.unwrap_or(TerminalSpawnArgs {
        shell: None,
        cwd: None,
        cols: default_cols(),
        rows: default_rows(),
    });
    let configured_shell = args.shell.or_else(|| {
        state
            .settings
            .read()
            .ok()
            .and_then(|settings| settings.terminal_shell.clone())
    });
    let shell = resolve_shell(configured_shell.as_deref())?;
    let workspace = state
        .workspace_root
        .read()
        .map_err(|e| e.to_string())?
        .clone();
    let cwd = match args.cwd {
        Some(path) => {
            let canonical =
                dunce::canonicalize(path).map_err(|e| format!("终端目录不存在：{e}"))?;
            if !canonical.starts_with(&workspace) {
                return Err("终端目录必须位于当前工作区内".into());
            }
            canonical
        }
        None => workspace,
    };

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: args.rows.max(2),
            cols: args.cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("创建 PTY 失败：{e}"))?;

    let mut command = CommandBuilder::new(&shell);
    let shell_name = shell
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("shell");
    if shell_name.eq_ignore_ascii_case("pwsh") || shell_name.eq_ignore_ascii_case("powershell") {
        command.arg("-NoLogo");
    }
    command.cwd(&cwd);

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("启动 Shell 失败：{e}"))?;
    drop(pair.slave);
    let pid = child.process_id().unwrap_or(0);
    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("打开终端输出失败：{e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("打开终端输入失败：{e}"))?;
    let id = uuid::Uuid::new_v4().to_string();

    {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.sessions.insert(
            id.clone(),
            TerminalHandle {
                id: id.clone(),
                pid,
                writer: Some(writer),
                master: pair.master,
                killer,
            },
        );
    }

    let terminals = state.terminals.clone();
    let terminal_id = id.clone();
    let event_window = window.clone();
    std::thread::Builder::new()
        .name(format!("wth-pty-{}", &terminal_id[..8]))
        .spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        let data = String::from_utf8_lossy(&buffer[..read]).into_owned();
                        let _ = event_window.emit(
                            "terminal:data",
                            TerminalDataEvent {
                                id: terminal_id.clone(),
                                data,
                            },
                        );
                    }
                    Err(error) => {
                        let _ = event_window.emit(
                            "terminal:exit",
                            TerminalExitEvent {
                                id: terminal_id.clone(),
                                exit_code: None,
                                message: Some(format!("读取终端输出失败：{error}")),
                            },
                        );
                        break;
                    }
                }
            }
            let status = child.wait();
            let (exit_code, message) = match status {
                Ok(status) => (Some(status.exit_code()), None),
                Err(error) => (None, Some(format!("等待终端退出失败：{error}"))),
            };
            if let Ok(mut sessions) = terminals.lock() {
                sessions.sessions.remove(&terminal_id);
            }
            let _ = event_window.emit(
                "terminal:exit",
                TerminalExitEvent {
                    id: terminal_id,
                    exit_code,
                    message,
                },
            );
        })
        .map_err(|e| format!("创建终端读取线程失败：{e}"))?;

    Ok(TerminalInfo {
        id,
        pid,
        shell: shell.to_string_lossy().to_string(),
        cwd: cwd.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, AppState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let handle = terminals
        .sessions
        .get_mut(&id)
        .ok_or_else(|| "终端会话不存在".to_string())?;
    let writer = handle
        .writer
        .as_mut()
        .ok_or_else(|| "终端输入已关闭".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("终端写入失败：{e}"))?;
    writer.flush().map_err(|e| format!("终端刷新失败：{e}"))
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    args: TerminalResizeArgs,
) -> Result<(), String> {
    let terminals = state.terminals.lock().map_err(|e| e.to_string())?;
    let handle = terminals
        .sessions
        .get(&args.id)
        .ok_or_else(|| "终端会话不存在".to_string())?;
    handle
        .master
        .resize(PtySize {
            rows: args.rows.max(2),
            cols: args.cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("调整终端尺寸失败：{e}"))
}

#[tauri::command]
pub async fn terminal_kill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut handle = {
        let mut terminals = state.terminals.lock().map_err(|e| e.to_string())?;
        terminals.sessions.remove(&id)
    };
    if let Some(ref mut handle) = handle {
        handle.writer.take();
        handle
            .killer
            .kill()
            .map_err(|e| format!("关闭终端失败：{e}"))?;
    }
    Ok(())
}

pub fn kill_all(state: &AppState) {
    if let Ok(mut terminals) = state.terminals.lock() {
        for (_, mut handle) in terminals.sessions.drain() {
            handle.writer.take();
            let _ = handle.killer.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_shell;

    #[test]
    fn system_shell_can_be_resolved() {
        assert!(resolve_shell(None).is_ok());
    }
}
