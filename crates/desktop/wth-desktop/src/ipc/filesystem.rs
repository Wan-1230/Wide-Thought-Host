//! IPC commands for local filesystem operations.
//!
//! Safety: all paths are validated against the user's project workspace.
//! Directory traversal attacks are prevented by canonicalization checks
//! and workspace root confinement.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The workspace root — set once on first access via [`set_workspace_root`].
static WORKSPACE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Set the allowed workspace root. All filesystem IPC operations are
/// confined to this directory and its descendants. The path is canonicalized
/// before storing.
pub fn set_workspace_root(path: &Path) {
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let _ = WORKSPACE_ROOT.set(canonical);
}

/// Returns the workspace root if set, otherwise the user's home directory.
fn workspace_root() -> &'static Path {
    WORKSPACE_ROOT.get().map(|p| p.as_path()).unwrap_or_else(|| {
        static HOME: OnceLock<PathBuf> = OnceLock::new();
        HOME.get_or_init(|| {
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
        })
        .as_path()
    })
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
pub async fn file_read(args: FileReadArgs) -> Result<String, String> {
    let path = sanitize_path(&args.path)?;
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", args.path, e))
}

/// Write content to a file (creates or overwrites).
#[tauri::command]
pub async fn file_write(args: FileWriteArgs) -> Result<(), String> {
    let path = sanitize_parent(&args.path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }
    std::fs::write(&path, &args.content)
        .map_err(|_| format!("Failed to write file"))
}

/// Delete a file (directories are not deletable via this command).
#[tauri::command]
pub async fn file_delete(path: String) -> Result<(), String> {
    let p = sanitize_path(&path)?;
    if p.is_dir() {
        return Err("Cannot delete directories. Use your file manager.".into());
    }
    std::fs::remove_file(&p)
        .map_err(|_| format!("Failed to delete file"))
}

/// List files in a directory.
#[tauri::command]
pub async fn file_list(args: FileListArgs) -> Result<Vec<FileEntry>, String> {
    // "." 或空路径：使用 workspace_root 本身
    if args.path.is_empty() || args.path == "." {
        let root = workspace_root().to_path_buf();
        return list_dir(&root, args.recursive);
    }
    let path = sanitize_path(&args.path)?;
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
fn sanitize_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    let canonical = dunce::canonicalize(&path)
        .map_err(|e| format!("Path not found: {}", e))?;

    check_workspace_confined(&canonical)?;
    Ok(canonical)
}

/// Like [`sanitize_path`] but validates the parent directory, allowing
/// operations on files that don't exist yet (e.g. `file_write` creating a new file).
fn sanitize_parent(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    if let Some(parent) = path.parent() {
        if parent.as_os_str().is_empty() {
            // Relative path with no parent component — use cwd
            let cwd = std::env::current_dir().map_err(|e| format!("cwd: {}", e))?;
            check_workspace_confined(&cwd)?;
            return Ok(dunce::canonicalize(&cwd)
                .unwrap_or(cwd)
                .join(path.file_name().unwrap_or_default()));
        }
        // Canonicalize the parent, then rejoin the filename
        let canonical_parent = dunce::canonicalize(parent)
            .map_err(|e| format!("Parent dir not found: {}", e))?;
        check_workspace_confined(&canonical_parent)?;
        Ok(canonical_parent.join(path.file_name().unwrap_or_default()))
    } else {
        // No parent (e.g. just a filename) — use cwd
        let cwd = std::env::current_dir().map_err(|e| format!("cwd: {}", e))?;
        check_workspace_confined(&cwd)?;
        Ok(dunce::canonicalize(&cwd)
            .unwrap_or(cwd)
            .join(path.file_name().unwrap_or_default()))
    }
}

/// Check that a canonical path is within the workspace root.
fn check_workspace_confined(path: &Path) -> Result<(), String> {
    let root = workspace_root();
    if !path.starts_with(root) {
        return Err("Access denied: path is outside the workspace".into());
    }
    Ok(())
}
