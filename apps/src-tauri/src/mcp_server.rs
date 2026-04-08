//! MCP Server — JSON-RPC 2.0 over stdio for external AI clients.
//!
//! When Xplorer is launched with `--mcp-server`, it starts a headless
//! MCP server that reads JSON-RPC requests from stdin and writes
//! responses to stdout.  This allows Claude Code (and other MCP
//! clients) to connect:
//!
//!     claude --mcp-server "xplorer --mcp-server"
//!
//! Supported methods:
//!   - `initialize`  — handshake, returns server capabilities
//!   - `tools/list`  — returns available MCP tools
//!   - `tools/call`  — invokes a tool, routes to `mcp_host` handlers

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use tracing::{error, info};

use crate::mcp_host;

// ─── JSON-RPC 2.0 Types ──────────────────────────────────────────────────────

/// Incoming JSON-RPC request.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

/// Outgoing JSON-RPC success response.
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

/// JSON-RPC error object.
#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

// Standard JSON-RPC error codes
const PARSE_ERROR: i64 = -32700;
const METHOD_NOT_FOUND: i64 = -32601;
const INTERNAL_ERROR: i64 = -32603;

// ─── MCP Protocol Constants ──────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "xplorer";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

// ─── Response Builders ───────────────────────────────────────────────────────

const fn rpc_version() -> &'static str {
    "2.0"
}

fn success_response(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: rpc_version().to_string(),
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Value, code: i64, message: String) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: rpc_version().to_string(),
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message,
            data: None,
        }),
    }
}

// ─── Method Handlers ─────────────────────────────────────────────────────────

/// Handle `initialize` — return server info and capabilities.
fn handle_initialize(id: Value, _params: &Value) -> JsonRpcResponse {
    success_response(
        id,
        json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": SERVER_NAME,
                "version": SERVER_VERSION
            }
        }),
    )
}

/// Handle `tools/list` — return all available MCP tools.
async fn handle_tools_list(id: Value) -> JsonRpcResponse {
    match mcp_host::mcp_list_tools().await {
        Ok(tools) => {
            let tool_list: Vec<Value> = tools
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.input_schema
                    })
                })
                .collect();
            success_response(id, json!({ "tools": tool_list }))
        }
        Err(e) => error_response(id, INTERNAL_ERROR, format!("Failed to list tools: {}", e)),
    }
}

/// Handle `tools/call` — dispatch to the appropriate tool handler.
async fn handle_tools_call(id: Value, params: &Value) -> JsonRpcResponse {
    let tool_name = match params.get("name").and_then(|v| v.as_str()) {
        Some(name) => name.to_string(),
        None => {
            return error_response(
                id,
                INTERNAL_ERROR,
                "Missing 'name' in tools/call params".to_string(),
            );
        }
    };

    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    match mcp_host::mcp_call_tool(tool_name.clone(), arguments).await {
        Ok(result) => {
            // Convert McpToolResult into MCP content format
            let content = if result.success {
                vec![json!({
                    "type": "text",
                    "text": serde_json::to_string_pretty(&result.data)
                        .unwrap_or_else(|_| result.data.to_string())
                })]
            } else {
                let err_text = result.error.unwrap_or_else(|| "Unknown error".to_string());
                vec![json!({
                    "type": "text",
                    "text": err_text
                })]
            };

            success_response(
                id,
                json!({
                    "content": content,
                    "isError": !result.success
                }),
            )
        }
        Err(e) => error_response(id, INTERNAL_ERROR, format!("Tool execution failed: {}", e)),
    }
}

// ─── Request Dispatcher ──────────────────────────────────────────────────────

/// Route a single JSON-RPC request to the appropriate handler.
async fn dispatch(req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    let id = req.id.clone().unwrap_or(Value::Null);

    // Notifications (no id) that we acknowledge silently
    match req.method.as_str() {
        "notifications/initialized" | "initialized" => return None,
        _ => {}
    }

    let response = match req.method.as_str() {
        "initialize" => handle_initialize(id, &req.params),
        "tools/list" => handle_tools_list(id).await,
        "tools/call" => handle_tools_call(id, &req.params).await,
        _ => error_response(
            id,
            METHOD_NOT_FOUND,
            format!("Method not found: {}", req.method),
        ),
    };

    Some(response)
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

/// Run the MCP server, reading from stdin and writing to stdout.
///
/// This function blocks until stdin is closed (EOF). It is intended
/// to be called from `main()` when `--mcp-server` is passed.
pub fn run_mcp_server() {
    info!(
        "[MCP Server] Starting Xplorer MCP server v{}",
        SERVER_VERSION
    );

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap_or_else(|e| {
            error!("[MCP Server] Failed to build tokio runtime: {}", e);
            std::process::exit(1);
        });

    let stdin = io::stdin();
    let stdout = io::stdout();
    let reader = stdin.lock();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                error!("[MCP Server] Failed to read stdin: {}", e);
                break;
            }
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Parse JSON-RPC request
        let request: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                let err_resp =
                    error_response(Value::Null, PARSE_ERROR, format!("Parse error: {}", e));
                let mut out = stdout.lock();
                if let Ok(json_bytes) = serde_json::to_vec(&err_resp) {
                    let _ = out.write_all(&json_bytes);
                    let _ = out.write_all(b"\n");
                    let _ = out.flush();
                }
                continue;
            }
        };

        // Validate jsonrpc version
        if request.jsonrpc != "2.0" {
            let err_resp = error_response(
                request.id.unwrap_or(Value::Null),
                PARSE_ERROR,
                "Invalid JSON-RPC version; expected \"2.0\"".to_string(),
            );
            let mut out = stdout.lock();
            if let Ok(json_bytes) = serde_json::to_vec(&err_resp) {
                let _ = out.write_all(&json_bytes);
                let _ = out.write_all(b"\n");
                let _ = out.flush();
            }
            continue;
        }

        // Dispatch asynchronously
        let maybe_response = rt.block_on(dispatch(request));

        if let Some(response) = maybe_response {
            let mut out = stdout.lock();
            match serde_json::to_vec(&response) {
                Ok(json_bytes) => {
                    let _ = out.write_all(&json_bytes);
                    let _ = out.write_all(b"\n");
                    let _ = out.flush();
                }
                Err(e) => {
                    error!("[MCP Server] Failed to serialize response: {}", e);
                }
            }
        }
    }

    info!("[MCP Server] Stdin closed, shutting down");
}
