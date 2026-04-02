use tauri::command;

use super::types::GitRemote;
use super::validation::validate_git_path;

#[command]
pub async fn git_pull(directory: String) -> Result<String, String> {
    validate_git_path(&directory, "Directory")?;
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .args(["pull"])
            .current_dir(&directory)
            .output()
            .map_err(|e| format!("Failed to run git pull: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git pull failed: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn git_push(directory: String, force: Option<bool>) -> Result<String, String> {
    validate_git_path(&directory, "Directory")?;
    tokio::task::spawn_blocking(move || {
        let mut args = vec!["push"];
        if force.unwrap_or(false) {
            args.push("--force");
        }

        let output = std::process::Command::new("git")
            .args(&args)
            .current_dir(&directory)
            .output()
            .map_err(|e| format!("Failed to run git push: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git push failed: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn git_fetch(directory: String) -> Result<String, String> {
    validate_git_path(&directory, "Directory")?;
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .args(["fetch", "--all"])
            .current_dir(&directory)
            .output()
            .map_err(|e| format!("Failed to run git fetch: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git fetch failed: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn git_get_remotes(directory: String) -> Result<Vec<GitRemote>, String> {
    validate_git_path(&directory, "Directory")?;
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .args(["remote", "-v"])
            .current_dir(&directory)
            .output()
            .map_err(|e| format!("Failed to run git remote: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git remote failed: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut remotes: Vec<GitRemote> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let name = parts[0].to_string();
                let url = parts[1].to_string();
                let is_push = parts.get(2).map_or(false, |s| s.contains("push"));

                if let Some(existing) = remotes.iter_mut().find(|r| r.name == name) {
                    if is_push {
                        existing.push_url = Some(url);
                    }
                } else if !seen.contains(&name) {
                    seen.insert(name.clone());
                    remotes.push(GitRemote {
                        name,
                        url,
                        push_url: None,
                    });
                }
            }
        }

        Ok(remotes)
    })
    .await
    .map_err(|e| e.to_string())?
}
