//! Multi-session agent runtime — manages concurrent AI agent sessions.
//!
//! Each session has its own conversation history, working directory, model
//! configuration, and status lifecycle. Sessions run the existing agent loop
//! infrastructure (streaming, tool execution, approval) independently.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{command, Emitter, Listener};

use crate::agent;
use crate::utils::now_ms;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Thinking,
    Executing,
    WaitingApproval,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub change_type: String, // "created", "modified", "deleted"
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub model: String,
    pub provider: String,
    pub status: SessionStatus,
    pub working_directory: String,
    pub selected_files: Vec<String>,
    pub project_context: Option<String>,
    pub scope: Option<AgentScopeConfig>,
    pub created_at: u64,
    pub updated_at: u64,
    pub file_changes: Vec<FileChange>,
    pub tool_calls_count: u32,
    pub turns_completed: u32,
    pub error_message: Option<String>,
}

/// Lightweight summary returned by `list_agent_sessions` to avoid
/// serialising full conversation history on every poll.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionSummary {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub model: String,
    pub provider: String,
    pub status: SessionStatus,
    pub working_directory: String,
    pub selected_files: Vec<String>,
    pub project_context: Option<String>,
    pub scope: Option<AgentScopeConfig>,
    pub created_at: u64,
    pub updated_at: u64,
    pub file_changes_count: u32,
    pub tool_calls_count: u32,
    pub turns_completed: u32,
    pub error_message: Option<String>,
}

impl AgentSession {
    fn to_summary(&self) -> AgentSessionSummary {
        AgentSessionSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            prompt: self.prompt.clone(),
            model: self.model.clone(),
            provider: self.provider.clone(),
            status: self.status.clone(),
            working_directory: self.working_directory.clone(),
            selected_files: self.selected_files.clone(),
            project_context: self.project_context.clone(),
            scope: self.scope.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            file_changes_count: self.file_changes.len() as u32,
            tool_calls_count: self.tool_calls_count,
            turns_completed: self.turns_completed,
            error_message: self.error_message.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentScopeConfig {
    /// "all" | "selected" | "glob"
    pub file_scope: String,
    /// Optional glob pattern when file_scope == "glob"
    pub glob_pattern: Option<String>,
    /// "folder" | "subfolders" | "project"
    pub depth: String,
    /// "all" | "modified" | "staged"
    pub git_filter: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionParams {
    pub name: String,
    pub prompt: String,
    pub model: String,
    pub working_directory: String,
    #[serde(default)]
    pub selected_files: Vec<String>,
    pub project_context: Option<String>,
    pub scope: Option<AgentScopeConfig>,
}

// ─── Global Session Registry ────────────────────────────────────────────────

static SESSIONS: LazyLock<Arc<Mutex<HashMap<String, AgentSession>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

// ─── Helpers ────────────────────────────────────────────────────────────────

fn detect_provider(model: &str) -> String {
    if model.starts_with("claude-") {
        "anthropic".to_string()
    } else if model.starts_with("gpt-")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
        || model.starts_with("chatgpt-")
    {
        "openai".to_string()
    } else {
        "ollama".to_string()
    }
}

fn generate_session_id() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let id: u64 = rng.gen();
    format!("session-{:016x}", id)
}

fn update_session_status(session_id: &str, status: SessionStatus) {
    if let Ok(mut map) = SESSIONS.lock() {
        if let Some(session) = map.get_mut(session_id) {
            session.status = status;
            session.updated_at = now_ms();
        }
    }
}

fn update_session_error(session_id: &str, error: &str) {
    if let Ok(mut map) = SESSIONS.lock() {
        if let Some(session) = map.get_mut(session_id) {
            session.status = SessionStatus::Error;
            session.error_message = Some(error.to_string());
            session.updated_at = now_ms();
        }
    }
}

fn emit_session_event(app_handle: &tauri::AppHandle, session_id: &str, event_type: &str) {
    let summary = {
        SESSIONS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(session_id)
            .map(|s| s.to_summary())
    };
    if let Some(summary) = summary {
        let _ = app_handle.emit(
            "agent-session-update",
            json!({
                "event_type": event_type,
                "session": summary,
            }),
        );
    }
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[command]
pub async fn create_agent_session(
    params: CreateSessionParams,
    app_handle: tauri::AppHandle,
) -> Result<AgentSessionSummary, String> {
    let session_id = generate_session_id();
    let provider = detect_provider(&params.model);
    let now = now_ms();

    let session = AgentSession {
        id: session_id.clone(),
        name: params.name,
        prompt: params.prompt.clone(),
        model: params.model.clone(),
        provider,
        status: SessionStatus::Idle,
        working_directory: params.working_directory.clone(),
        selected_files: params.selected_files.clone(),
        project_context: params.project_context.clone(),
        scope: params.scope.clone(),
        created_at: now,
        updated_at: now,
        file_changes: Vec::new(),
        tool_calls_count: 0,
        turns_completed: 0,
        error_message: None,
    };

    let summary = session.to_summary();

    {
        SESSIONS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session_id.clone(), session);
    }

    emit_session_event(&app_handle, &session_id, "created");

    // Spawn the agent loop in a background task
    let sid = session_id.clone();
    let prompt = params.prompt;
    let model = params.model;
    let working_dir = params.working_directory;
    let selected = params.selected_files;
    let project_ctx = params.project_context;
    let scope_cfg = params.scope;
    let ah = app_handle.clone();

    tokio::spawn(async move {
        run_agent_session(
            &sid,
            &prompt,
            &model,
            &working_dir,
            &selected,
            &project_ctx,
            &scope_cfg,
            &ah,
        )
        .await;
    });

    Ok(summary)
}

#[command]
pub async fn list_agent_sessions() -> Result<Vec<AgentSessionSummary>, String> {
    let map = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let mut summaries: Vec<AgentSessionSummary> = map.values().map(|s| s.to_summary()).collect();
    // Sort newest first
    summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(summaries)
}

#[command]
pub async fn get_agent_session(session_id: String) -> Result<AgentSessionSummary, String> {
    let map = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    map.get(&session_id)
        .map(|s| s.to_summary())
        .ok_or_else(|| format!("Session not found: {}", session_id))
}

#[command]
pub async fn stop_agent_session(
    session_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Mark as cancelled in the agent module's cancellation set
    agent::agent_cancel_session(session_id.clone()).await?;

    // Update our session registry
    update_session_status(&session_id, SessionStatus::Cancelled);
    emit_session_event(&app_handle, &session_id, "cancelled");

    Ok(())
}

#[command]
pub async fn remove_agent_session(
    session_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    {
        SESSIONS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&session_id);
    }
    let _ = app_handle.emit(
        "agent-session-update",
        json!({
            "event_type": "removed",
            "session": { "id": session_id },
        }),
    );
    Ok(())
}

// ─── Agent Loop Runner ──────────────────────────────────────────────────────

/// Build a context preamble from Xplorer state to prepend to the user prompt.
fn build_session_context(
    working_directory: &str,
    selected_files: &[String],
    project_context: &Option<String>,
    scope: &Option<AgentScopeConfig>,
) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push("You are an AI agent running inside Xplorer file manager.".to_string());
    lines.push(format!("Working directory: {}", working_directory));

    if let Some(ref ctx) = project_context {
        if !ctx.is_empty() {
            lines.push(format!("Project context: {}", ctx));
        }
    }

    if !selected_files.is_empty() {
        let file_list = selected_files.join(", ");
        lines.push(format!("Selected files: {}", file_list));
    }

    if let Some(ref s) = scope {
        let scope_desc = match s.file_scope.as_str() {
            "selected" => "Only operate on the selected files.".to_string(),
            "glob" => {
                let pat = s.glob_pattern.as_deref().unwrap_or("*");
                format!("Only operate on files matching: {}", pat)
            }
            _ => "All files are in scope.".to_string(),
        };
        lines.push(scope_desc);

        let depth_desc = match s.depth.as_str() {
            "folder" => "Scope: this folder only (no subfolders).",
            "subfolders" => "Scope: this folder and all subfolders.",
            _ => "Scope: entire project.",
        };
        lines.push(depth_desc.to_string());

        let git_desc = match s.git_filter.as_str() {
            "modified" => "Git filter: only modified (uncommitted) files.",
            "staged" => "Git filter: only staged files.",
            _ => "",
        };
        if !git_desc.is_empty() {
            lines.push(git_desc.to_string());
        }
    }

    lines.join("\n")
}

/// Run the agent loop for a session. This delegates to the existing
/// `agent::agent_chat` infrastructure, updating session status as it
/// progresses.
async fn run_agent_session(
    session_id: &str,
    prompt: &str,
    model: &str,
    working_directory: &str,
    selected_files: &[String],
    project_context: &Option<String>,
    scope: &Option<AgentScopeConfig>,
    app_handle: &tauri::AppHandle,
) {
    // Update status to thinking
    update_session_status(session_id, SessionStatus::Thinking);
    emit_session_event(app_handle, session_id, "started");

    // Listen for agent events to track status transitions
    let sid = session_id.to_string();
    let ah = app_handle.clone();

    // Set up a listener for agent-event to track tool calls and status
    let tracker_sid = sid.clone();
    let tracker_ah = ah.clone();
    let event_listener = app_handle.listen("agent-event", move |event| {
        if let Ok(payload) = serde_json::from_str::<Value>(event.payload()) {
            let event_session = payload["session_id"].as_str().unwrap_or("");
            if event_session != tracker_sid {
                return;
            }

            let event_type = payload["event_type"].as_str().unwrap_or("");
            match event_type {
                "tool_call" => {
                    if let Ok(mut map) = SESSIONS.lock() {
                        if let Some(session) = map.get_mut(&tracker_sid) {
                            session.tool_calls_count += 1;
                            session.status = SessionStatus::Executing;
                            session.updated_at = now_ms();
                        }
                    }
                    emit_session_event(&tracker_ah, &tracker_sid, "status_changed");
                }
                "approval_request" => {
                    update_session_status(&tracker_sid, SessionStatus::WaitingApproval);
                    emit_session_event(&tracker_ah, &tracker_sid, "status_changed");
                }
                "tool_result" => {
                    // Check if the tool wrote a file
                    if let Some(tc) = payload.get("tool_call") {
                        let tool_name = tc["name"].as_str().unwrap_or("");
                        if matches!(
                            tool_name,
                            "write_file"
                                | "create_directory"
                                | "rename"
                                | "delete"
                                | "move_file"
                                | "copy_file"
                        ) {
                            if tc["status"].as_str() == Some("completed") {
                                if let Some(path) = tc["input"]["path"].as_str() {
                                    let change_type = match tool_name {
                                        "write_file" | "create_directory" => "modified",
                                        "delete" => "deleted",
                                        "rename" | "move_file" | "copy_file" => "modified",
                                        _ => "modified",
                                    };
                                    if let Ok(mut map) = SESSIONS.lock() {
                                        if let Some(session) = map.get_mut(&tracker_sid) {
                                            session.file_changes.push(FileChange {
                                                path: path.to_string(),
                                                change_type: change_type.to_string(),
                                                timestamp: now_ms(),
                                            });
                                            session.updated_at = now_ms();
                                        }
                                    }
                                }
                            }
                        }
                    }
                    update_session_status(&tracker_sid, SessionStatus::Thinking);
                    emit_session_event(&tracker_ah, &tracker_sid, "status_changed");
                }
                "text_delta" => {
                    // Forward the partial text to the frontend for real-time streaming
                    let delta_text = payload["text"].as_str().unwrap_or("");
                    if !delta_text.is_empty() {
                        let _ = tracker_ah.emit(
                            "agent-session-stream",
                            json!({
                                "session_id": tracker_sid,
                                "text": delta_text,
                            }),
                        );
                    }
                    update_session_status(&tracker_sid, SessionStatus::Thinking);
                }
                _ => {}
            }
        }
    });

    // Build context-enriched prompt
    let context_preamble =
        build_session_context(working_directory, selected_files, project_context, scope);
    let enriched_prompt = if context_preamble.is_empty() {
        prompt.to_string()
    } else {
        format!(
            "[Agent Context]\n{}\n\n[Task]\n{}",
            context_preamble, prompt
        )
    };

    // Build the initial messages for the agent loop
    let messages = vec![json!({
        "role": "user",
        "content": enriched_prompt,
    })];

    // Call the existing agent_chat function
    let result = agent::agent_chat(
        sid.clone(),
        messages,
        working_directory.to_string(),
        None,
        Some(model.to_string()),
        ah.clone(),
    )
    .await;

    // Unlisten when done
    app_handle.unlisten(event_listener);

    // Update final status
    match result {
        Ok(_) => {
            // Check if it was cancelled during execution
            let current_status = {
                SESSIONS
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&sid)
                    .map(|s| s.status.clone())
            };

            if current_status == Some(SessionStatus::Cancelled) {
                emit_session_event(app_handle, &sid, "cancelled");
            } else {
                // Increment turns completed
                if let Ok(mut map) = SESSIONS.lock() {
                    if let Some(session) = map.get_mut(&sid) {
                        session.turns_completed += 1;
                    }
                }
                update_session_status(&sid, SessionStatus::Done);
                emit_session_event(app_handle, &sid, "completed");
            }
        }
        Err(err) => {
            update_session_error(&sid, &err);
            emit_session_event(app_handle, &sid, "error");
        }
    }
}
