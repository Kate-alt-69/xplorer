//! MCP Host — Exposes Xplorer's file-system capabilities as MCP-compatible tools.
//!
//! This module defines a lightweight MCP tool provider that maps standard
//! Model Context Protocol tool schemas to existing Xplorer operations.
//! External AI clients can call these Tauri commands to interact with the
//! file system through Xplorer's managed runtime.
//!
//! The actual MCP JSON-RPC over stdio transport can be layered on top later;
//! for now these are plain Tauri commands that follow MCP tool conventions.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use tauri::command;

// ─── MCP Tool Schema Types ─────────────────────────────────────────────────

/// Describes a single MCP tool (returned by `mcp_list_tools`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolSchema {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Result envelope returned by every MCP tool invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolResult {
    pub tool: String,
    pub success: bool,
    pub data: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl McpToolResult {
    const fn ok(tool: String, data: Value) -> Self {
        Self {
            tool,
            success: true,
            data,
            error: None,
        }
    }

    const fn err(tool: String, data: Value, error: String) -> Self {
        Self {
            tool,
            success: false,
            data,
            error: Some(error),
        }
    }
}

// ─── Tool Catalogue ────────────────────────────────────────────────────────

/// Returns the list of MCP-compatible tools that Xplorer exposes.
#[command]
pub async fn mcp_list_tools() -> Result<Vec<McpToolSchema>, String> {
    Ok(vec![
        McpToolSchema {
            name: "read_file".to_string(),
            description: "Read the text content of a file at the given path.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to read."
                    }
                },
                "required": ["path"]
            }),
        },
        McpToolSchema {
            name: "write_file".to_string(),
            description: "Create or overwrite a file with the given content. Requires approval."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to write."
                    },
                    "content": {
                        "type": "string",
                        "description": "Text content to write to the file."
                    }
                },
                "required": ["path", "content"]
            }),
        },
        McpToolSchema {
            name: "list_directory".to_string(),
            description: "List the entries (files and directories) in a directory.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the directory to list."
                    }
                },
                "required": ["path"]
            }),
        },
        McpToolSchema {
            name: "search_files".to_string(),
            description: "Search for files by name pattern or content within a directory."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Absolute path to the directory to search in."
                    },
                    "query": {
                        "type": "string",
                        "description": "Search query (file name glob or content substring)."
                    },
                    "search_content": {
                        "type": "boolean",
                        "description": "If true, search inside file contents instead of file names."
                    }
                },
                "required": ["directory", "query"]
            }),
        },
        McpToolSchema {
            name: "run_command".to_string(),
            description: "Execute a shell command in a working directory. Requires approval."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The shell command to execute."
                    },
                    "working_directory": {
                        "type": "string",
                        "description": "Working directory for the command."
                    }
                },
                "required": ["command"]
            }),
        },
        McpToolSchema {
            name: "get_git_status".to_string(),
            description: "Get git status for a repository at the given directory.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "directory": {
                        "type": "string",
                        "description": "Path inside a git repository."
                    }
                },
                "required": ["directory"]
            }),
        },
    ])
}

// ─── Tool Dispatch ─────────────────────────────────────────────────────────

/// Invoke an MCP tool by name, passing arguments as a JSON object.
///
/// This is the main entry-point for external MCP clients.  It dispatches
/// to the appropriate handler and returns a uniform result envelope.
#[command]
pub async fn mcp_call_tool(name: String, arguments: Value) -> Result<McpToolResult, String> {
    match name.as_str() {
        "read_file" => mcp_read_file(arguments).await,
        "write_file" => mcp_write_file(arguments).await,
        "list_directory" => mcp_list_directory(arguments).await,
        "search_files" => mcp_search_files(arguments).await,
        "run_command" => mcp_run_command(arguments).await,
        "get_git_status" => mcp_get_git_status(arguments).await,
        _ => Ok(McpToolResult::err(
            name,
            json!(null),
            "Unknown tool".to_string(),
        )),
    }
}

// ─── Tool Implementations ──────────────────────────────────────────────────

/// Read the text content of a file.
async fn mcp_read_file(args: Value) -> Result<McpToolResult, String> {
    let tool = "read_file".to_string();
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: path".to_string())?
        .to_string();

    let result = tokio::task::spawn_blocking(move || {
        crate::operations::validate_file_path(&path)?;
        let p = Path::new(&path);
        if !p.exists() {
            return Err(format!("File not found: {}", path));
        }
        if p.is_dir() {
            return Err(format!("Path is a directory, not a file: {}", path));
        }
        std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read file: {}", e))
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(content) => Ok(McpToolResult::ok(tool, json!({ "content": content }))),
        Err(e) => Ok(McpToolResult::err(tool, json!(null), e)),
    }
}

/// Write content to a file (create or overwrite).
///
/// In a full MCP implementation this would go through an approval flow.
/// For now the `requires_approval` flag is set so the frontend can gate it.
async fn mcp_write_file(args: Value) -> Result<McpToolResult, String> {
    let tool = "write_file".to_string();
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: path".to_string())?
        .to_string();
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: content".to_string())?
        .to_string();

    let result = tokio::task::spawn_blocking(move || {
        crate::operations::validate_file_path(&path)?;

        // Ensure parent directory exists
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent directories: {}", e))?;
            }
        }

        std::fs::write(&path, &content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        let bytes_written = content.len();
        Ok(json!({
            "path": path,
            "bytes_written": bytes_written,
            "requires_approval": true,
        }))
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(data) => Ok(McpToolResult::ok(tool, data)),
        Err(e) => Ok(McpToolResult::err(tool, json!(null), e)),
    }
}

/// List directory entries.
async fn mcp_list_directory(args: Value) -> Result<McpToolResult, String> {
    let tool = "list_directory".to_string();
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: path".to_string())?
        .to_string();

    let result = tokio::task::spawn_blocking(move || {
        crate::operations::validate_file_path(&path)?;
        let p = Path::new(&path);

        if !p.exists() {
            return Err(format!("Directory not found: {}", path));
        }
        if !p.is_dir() {
            return Err(format!("Path is not a directory: {}", path));
        }

        let entries: Vec<Value> = std::fs::read_dir(p)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let metadata = entry.metadata().ok()?;
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = metadata.is_dir();
                let size = metadata.len();
                Some(json!({
                    "name": name,
                    "path": entry.path().to_string_lossy().to_string(),
                    "is_dir": is_dir,
                    "size": size,
                }))
            })
            .collect();

        Ok(json!({
            "directory": path,
            "entries": entries,
            "count": entries.len(),
        }))
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(data) => Ok(McpToolResult::ok(tool, data)),
        Err(e) => Ok(McpToolResult::err(tool, json!(null), e)),
    }
}

/// Search files by name pattern or content.
async fn mcp_search_files(args: Value) -> Result<McpToolResult, String> {
    let tool = "search_files".to_string();
    let directory = args
        .get("directory")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: directory".to_string())?
        .to_string();
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: query".to_string())?
        .to_string();
    let search_content = args
        .get("search_content")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let result = tokio::task::spawn_blocking(move || {
        crate::operations::validate_file_path(&directory)?;
        let dir_path = Path::new(&directory);
        if !dir_path.exists() || !dir_path.is_dir() {
            return Err(format!("Directory not found: {}", directory));
        }

        let mut matches: Vec<Value> = Vec::new();
        let query_lower = query.to_lowercase();
        let max_results = 100_usize;

        // Walk directory tree
        for entry in walkdir::WalkDir::new(&directory)
            .max_depth(10)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if matches.len() >= max_results {
                break;
            }

            let entry_path = entry.path();

            if search_content {
                // Search file contents
                if entry_path.is_file() {
                    if let Ok(content) = std::fs::read_to_string(entry_path) {
                        if content.to_lowercase().contains(&query_lower) {
                            // Find matching line numbers
                            let matching_lines: Vec<Value> = content
                                .lines()
                                .enumerate()
                                .filter(|(_, line)| line.to_lowercase().contains(&query_lower))
                                .take(5)
                                .map(|(i, line)| {
                                    json!({
                                        "line_number": i + 1,
                                        "content": line.chars().take(200).collect::<String>(),
                                    })
                                })
                                .collect();

                            matches.push(json!({
                                "path": entry_path.to_string_lossy().to_string(),
                                "name": entry_path.file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default(),
                                "matches": matching_lines,
                            }));
                        }
                    }
                }
            } else {
                // Search by file name
                let name = entry_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if name.to_lowercase().contains(&query_lower) {
                    matches.push(json!({
                        "path": entry_path.to_string_lossy().to_string(),
                        "name": name,
                        "is_dir": entry_path.is_dir(),
                    }));
                }
            }
        }

        Ok(json!({
            "query": query,
            "directory": directory,
            "search_content": search_content,
            "results": matches,
            "count": matches.len(),
            "truncated": matches.len() >= max_results,
        }))
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(data) => Ok(McpToolResult::ok(tool, data)),
        Err(e) => Ok(McpToolResult::err(tool, json!(null), e)),
    }
}

/// Execute a shell command.
///
/// In a full MCP implementation this would require explicit user approval.
async fn mcp_run_command(args: Value) -> Result<McpToolResult, String> {
    let tool = "run_command".to_string();
    let cmd = args
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: command".to_string())?
        .to_string();
    let working_directory = args
        .get("working_directory")
        .and_then(|v| v.as_str())
        .unwrap_or(".")
        .to_string();

    let result = tokio::task::spawn_blocking(move || {
        let wd = Path::new(&working_directory);
        if !wd.exists() {
            return Err(format!(
                "Working directory not found: {}",
                working_directory
            ));
        }

        #[cfg(target_os = "windows")]
        let output = std::process::Command::new("cmd")
            .args(["/C", &cmd])
            .current_dir(&working_directory)
            .output()
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        #[cfg(not(target_os = "windows"))]
        let output = std::process::Command::new("sh")
            .args(["-c", &cmd])
            .current_dir(&working_directory)
            .output()
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);

        Ok(json!({
            "command": cmd,
            "working_directory": working_directory,
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "requires_approval": true,
        }))
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(data) => Ok(McpToolResult::ok(tool, data)),
        Err(e) => Ok(McpToolResult::err(tool, json!(null), e)),
    }
}

/// Get git status for a repository.
async fn mcp_get_git_status(args: Value) -> Result<McpToolResult, String> {
    let tool = "get_git_status".to_string();
    let directory = args
        .get("directory")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing required parameter: directory".to_string())?
        .to_string();

    let result = tokio::task::spawn_blocking(move || {
        let repo = git2::Repository::discover(&directory)
            .map_err(|e| format!("Not a git repository: {}", e))?;

        let workdir = repo
            .workdir()
            .ok_or_else(|| "Bare repository".to_string())?
            .to_string_lossy()
            .to_string();

        // Current branch
        let branch = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "HEAD (detached)".to_string());

        // Collect statuses
        let statuses = repo
            .statuses(None)
            .map_err(|e| format!("Failed to get git statuses: {}", e))?;

        let mut staged: Vec<Value> = Vec::new();
        let mut unstaged: Vec<Value> = Vec::new();
        let mut untracked: Vec<Value> = Vec::new();

        for entry in statuses.iter() {
            let st = entry.status();
            if st.is_empty() {
                continue;
            }
            let path_str = entry.path().unwrap_or("").to_string();

            // Staged changes
            if st.is_index_new()
                || st.is_index_modified()
                || st.is_index_deleted()
                || st.is_index_renamed()
                || st.is_index_typechange()
            {
                let kind = if st.is_index_new() {
                    "new"
                } else if st.is_index_deleted() {
                    "deleted"
                } else if st.is_index_renamed() {
                    "renamed"
                } else {
                    "modified"
                };
                staged.push(json!({ "path": path_str, "status": kind }));
            }

            // Unstaged changes
            if st.is_wt_modified() || st.is_wt_deleted() || st.is_wt_renamed() || st.is_wt_typechange() {
                let kind = if st.is_wt_deleted() {
                    "deleted"
                } else if st.is_wt_renamed() {
                    "renamed"
                } else {
                    "modified"
                };
                unstaged.push(json!({ "path": path_str, "status": kind }));
            }

            // Untracked
            if st.is_wt_new() {
                untracked.push(json!({ "path": path_str }));
            }
        }

        Ok(json!({
            "directory": directory,
            "workdir": workdir,
            "branch": branch,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": untracked,
            "staged_count": staged.len(),
            "unstaged_count": unstaged.len(),
            "untracked_count": untracked.len(),
        }))
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(data) => Ok(McpToolResult::ok(tool, data)),
        Err(e) => Ok(McpToolResult::err(tool, json!(null), e)),
    }
}
