use tauri::command;

/// Proxy marketplace API requests through the Rust backend to avoid CORS restrictions.
/// The browser's fetch() is blocked by CORS when calling xplorer.space from the Tauri webview.
/// Rust's reqwest doesn't have CORS — it makes direct HTTP requests.
#[command]
pub async fn marketplace_proxy(url: String) -> Result<String, String> {
    // Only allow requests to known marketplace domains
    if !url.starts_with("https://xplorer.space/")
        && !url.starts_with("http://localhost:")
        && !url.starts_with("http://127.0.0.1:")
    {
        return Err(format!("Marketplace proxy: URL not allowed: {}", url));
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Marketplace request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("Marketplace returned HTTP {}", status));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read marketplace response: {}", e))
}
