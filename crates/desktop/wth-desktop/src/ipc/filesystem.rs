//! IPC commands for local filesystem operations.
//!
//! Safety: all paths are validated against the user's project workspace.
//! Directory traversal attacks are prevented by canonicalization checks
//! and workspace root confinement.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
fn workspace_root(state: &crate::state::AppState) -> Result<PathBuf, String> {
    state
        .workspace_root
        .read()
        .map(|root| root.clone())
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

#[derive(Debug, Deserialize)]
pub struct FileReadArgs {
    pub path: String,
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FileWriteArgs {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct FileListArgs {
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

/// Read a file from the filesystem.
#[tauri::command]
pub async fn file_read(
    args: FileReadArgs,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let path = sanitize_path(&args.path, &root)?;
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", args.path, e))
}

/// Write content to a file (creates or overwrites).
#[tauri::command]
pub async fn file_write(
    args: FileWriteArgs,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = sanitize_parent(&args.path, &root)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }
    std::fs::write(&path, &args.content).map_err(|_| format!("Failed to write file"))
}

/// Delete a file (directories are not deletable via this command).
#[tauri::command]
pub async fn file_delete(
    path: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let p = sanitize_path(&path, &root)?;
    if p.is_dir() {
        return Err("Cannot delete directories. Use your file manager.".into());
    }
    std::fs::remove_file(&p).map_err(|_| format!("Failed to delete file"))
}

/// List files in a directory.
#[tauri::command]
pub async fn file_list(
    args: FileListArgs,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<FileEntry>, String> {
    let root = workspace_root(&state)?;
    // "." 或空路径：使用 workspace_root 本身
    if args.path.is_empty() || args.path == "." {
        return list_dir(&root, args.recursive);
    }
    let path = sanitize_path(&args.path, &root)?;
    list_dir(&path, args.recursive)
}

fn list_dir(path: &PathBuf, recursive: bool) -> Result<Vec<FileEntry>, String> {
    let entries: Vec<FileEntry> = std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = entry.path();

            // Skip hidden files by default
            if name.starts_with('.') && name != ".env" {
                return None;
            }

            let children = if recursive && metadata.is_dir() {
                list_dir(&entry_path, true).ok()
            } else {
                None
            };

            Some(FileEntry {
                name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                children,
            })
        })
        .collect();

    // Sort: dirs first, then alphabetical
    let mut entries = entries;
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Prevent directory traversal attacks and confine access to the workspace root.
///
/// The path must already exist (uses canonicalize). For write operations
/// on new files, use [`sanitize_parent`] instead.
fn sanitize_path(raw: &str, root: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    let canonical = dunce::canonicalize(&path).map_err(|e| format!("Path not found: {}", e))?;

    check_workspace_confined(&canonical, root)?;
    Ok(canonical)
}

/// Like [`sanitize_path`] but validates the parent directory, allowing
/// operations on files that don't exist yet (e.g. `file_write` creating a new file).
fn sanitize_parent(raw: &str, root: &Path) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if let Some(parent) = path.parent() {
        if parent.as_os_str().is_empty() {
            // Relative path with no parent component — use cwd
            let cwd = std::env::current_dir().map_err(|e| format!("cwd: {}", e))?;
            check_workspace_confined(&cwd, root)?;
            return Ok(dunce::canonicalize(&cwd)
                .unwrap_or(cwd)
                .join(path.file_name().unwrap_or_default()));
        }
        // Canonicalize the parent, then rejoin the filename
        let canonical_parent =
            dunce::canonicalize(parent).map_err(|e| format!("Parent dir not found: {}", e))?;
        check_workspace_confined(&canonical_parent, root)?;
        Ok(canonical_parent.join(path.file_name().unwrap_or_default()))
    } else {
        // No parent (e.g. just a filename) — use cwd
        let cwd = std::env::current_dir().map_err(|e| format!("cwd: {}", e))?;
        check_workspace_confined(&cwd, root)?;
        Ok(dunce::canonicalize(&cwd)
            .unwrap_or(cwd)
            .join(path.file_name().unwrap_or_default()))
    }
}

/// Check that a canonical path is within the workspace root.
fn check_workspace_confined(path: &Path, root: &Path) -> Result<(), String> {
    if !path.starts_with(root) {
        return Err("Access denied: path is outside the workspace".into());
    }
    Ok(())
}
