#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD, Engine as _};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{oneshot, Mutex},
};
use uuid::Uuid;

use crate::SendAgentRequest;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub integration: String,
    pub status: String,
    pub compatible: bool,
    pub detail: String,
}

#[derive(Default)]
pub struct ProcessRegistry {
    stop_signals: Arc<Mutex<HashMap<String, ProcessStopHandle>>>,
}

struct ProcessStopHandle {
    signal: oneshot::Sender<()>,
    #[cfg(windows)]
    process_id: Option<u32>,
}

struct Candidate {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    integration: &'static str,
    supported: bool,
    detail: &'static str,
}

const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
        integration: "cli",
        supported: true,
        detail: "Prompt mode through the official Claude Code CLI.",
    },
    Candidate {
        id: "codex",
        name: "OpenAI Codex CLI",
        command: "codex",
        integration: "cli",
        supported: true,
        detail: "Non-interactive execution through `codex exec`.",
    },
    Candidate {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        integration: "cli",
        supported: true,
        detail: "Non-interactive execution through `opencode run`.",
    },
    Candidate {
        id: "gemini-cli",
        name: "Gemini CLI",
        command: "gemini",
        integration: "cli",
        supported: true,
        detail: "Prompt mode through the Gemini CLI.",
    },
    Candidate {
        id: "aider",
        name: "Aider",
        command: "aider",
        integration: "detection-only",
        supported: false,
        detail: "Detected only; interactive approval needs the planned PTY and file-diff workflow.",
    },
    Candidate {
        id: "ollama",
        name: "Ollama",
        command: "ollama",
        integration: "local-api",
        supported: true,
        detail: "Local model API is handled in the Models section.",
    },
    Candidate {
        id: "cursor",
        name: "Cursor",
        command: "cursor",
        integration: "gui-only",
        supported: false,
        detail: "Editor detected; direct conversation control is not exposed by this adapter.",
    },
    Candidate {
        id: "windsurf",
        name: "Windsurf",
        command: "windsurf",
        integration: "gui-only",
        supported: false,
        detail: "Editor detected; direct conversation control is not exposed by this adapter.",
    },
    Candidate {
        id: "claude-desktop",
        name: "Claude Desktop",
        command: "claude-desktop",
        integration: "gui-only",
        supported: false,
        detail: "Desktop app detection only; no supported local control interface is assumed.",
    },
];

pub async fn detect_tools() -> Vec<AgentInfo> {
    let mut found = Vec::new();

    for candidate in CANDIDATES {
        if let Some(path) = find_executable(candidate.command) {
            let version = get_version(&path).await;
            let status = if candidate.supported && version.is_some() {
                "available"
            } else {
                "detected"
            };
            let detail = if candidate.integration == "local-api" {
                "CLI detected. Check the Models section for local server availability.".to_string()
            } else {
                candidate.detail.to_string()
            };

            found.push(AgentInfo {
                id: candidate.id.to_string(),
                name: candidate.name.to_string(),
                executable: Some(path.display().to_string()),
                version,
                integration: candidate.integration.to_string(),
                status: status.to_string(),
                compatible: candidate.supported,
                detail,
            });
        }
    }

    found
}

fn find_executable(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;

    #[cfg(windows)]
    let extensions: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .map(str::to_string)
        .collect();

    #[cfg(not(windows))]
    let extensions = vec![String::new()];

    for directory in std::env::split_paths(&path_var) {
        for extension in &extensions {
            let filename = if extension.is_empty()
                || name
                    .to_ascii_lowercase()
                    .ends_with(&extension.to_ascii_lowercase())
            {
                name.to_string()
            } else {
                format!("{name}{extension}")
            };
            let candidate = directory.join(filename);

            if candidate.is_file() {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }

    None
}

fn platform_command(executable: &Path, args: &[String]) -> Result<Command, String> {
    #[cfg(windows)]
    {
        let executable_b64 = STANDARD.encode(executable.as_os_str().to_string_lossy().as_bytes());
        let argument_expressions = args
            .iter()
            .map(|argument| {
                format!(
                    "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}'))",
                    STANDARD.encode(argument.as_bytes())
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let script = format!(
            "$ErrorActionPreference='Stop'; $agentHubExe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{}')); $agentHubArgs=@({}); & $agentHubExe @agentHubArgs; exit $LASTEXITCODE",
            executable_b64, argument_expressions
        );
        let encoded_script = STANDARD.encode(
            script
                .encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<u8>>(),
        );
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            encoded_script.as_str(),
        ]);
        command.as_std_mut().creation_flags(0x08000000);
        Ok(command)
    }

    #[cfg(not(windows))]
    {
        let mut command = Command::new(executable);
        command.args(args);
        Ok(command)
    }
}

async fn get_version(executable: &Path) -> Option<String> {
    let mut command = platform_command(executable, &["--version".to_string()]).ok()?;
    command.kill_on_drop(true);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let output = tokio::time::timeout(Duration::from_secs(3), command.output())
        .await
        .ok()?
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let text = if stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).trim().to_string()
    } else {
        stdout
    };

    if text.is_empty() {
        None
    } else {
        Some(
            text.lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(100)
                .collect(),
        )
    }
}

pub async fn run_agent_prompt(
    app: AppHandle,
    registry: &ProcessRegistry,
    request: SendAgentRequest,
) -> Result<String, String> {
    if request.prompt.trim().is_empty() {
        return Err("Write a prompt before starting an agent.".into());
    }

    let executable_name = match request.agent_id.as_str() {
        "claude-code" => "claude",
        "codex" => "codex",
        "opencode" => "opencode",
        "gemini-cli" => "gemini",
        _ => return Err("This tool does not have a runnable AgentHub adapter yet.".into()),
    };
    let executable = find_executable(executable_name).ok_or_else(|| {
        format!("{executable_name} is not on PATH. Install it or add its location to PATH.")
    })?;

    let args = match request.agent_id.as_str() {
        "claude-code" => vec!["-p".to_string(), request.prompt.clone()],
        "codex" => vec!["exec".to_string(), request.prompt.clone()],
        "opencode" => vec!["run".to_string(), request.prompt.clone()],
        "gemini-cli" => vec!["-p".to_string(), request.prompt.clone()],
        _ => unreachable!(),
    };
    let mut command = platform_command(&executable, &args)?;

    if let Some(project) = request.project_path.as_deref() {
        let path = PathBuf::from(project)
            .canonicalize()
            .map_err(|error| format!("Project directory is unavailable: {error}"))?;
        if !path.is_dir() {
            return Err("The selected project path is not a directory.".into());
        }
        command.current_dir(path);
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start {executable_name}: {error}"))?;

    let process_id = Uuid::new_v4().to_string();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (stop_signal, stop_receiver) = oneshot::channel();
    registry.stop_signals.lock().await.insert(
        process_id.clone(),
        ProcessStopHandle {
            signal: stop_signal,
            #[cfg(windows)]
            process_id: child.id(),
        },
    );

    let mut reader_tasks = Vec::new();
    if let Some(stdout) = stdout {
        let app = app.clone();
        let id = process_id.clone();
        reader_tasks.push(tokio::spawn(async move {
            stream_lines(app, id, "stdout", stdout).await;
        }));
    }
    if let Some(stderr) = stderr {
        let app = app.clone();
        let id = process_id.clone();
        reader_tasks.push(tokio::spawn(async move {
            stream_lines(app, id, "stderr", stderr).await;
        }));
    }

    let stop_signals = registry.stop_signals.clone();
    let app_for_exit = app.clone();
    let exit_id = process_id.clone();
    let exit_conversation_id = request.conversation_id.clone();
    tokio::spawn(async move {
        let (status, cancelled) = tokio::select! {
            result = child.wait() => (result.ok(), false),
            _ = stop_receiver => {
                let _ = child.kill().await;
                (child.wait().await.ok(), true)
            }
        };
        let code = status.and_then(|value| value.code());
        for reader in reader_tasks {
            let _ = reader.await;
        }
        stop_signals.lock().await.remove(&exit_id);
        let _ = app_for_exit.emit(
            "agent-exit",
            serde_json::json!({
                "processId": exit_id,
                "conversationId": exit_conversation_id,
                "code": code,
                "cancelled": cancelled
            }),
        );
    });

    let _ = app.emit(
        "agent-started",
        serde_json::json!({
            "processId": process_id,
            "agentId": request.agent_id,
            "conversationId": request.conversation_id
        }),
    );
    Ok(process_id)
}

async fn stream_lines<R>(app: AppHandle, process_id: String, stream: &'static str, reader: R)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = app.emit(
            "agent-output",
            serde_json::json!({
                "processId": process_id,
                "stream": stream,
                "text": line
            }),
        );
    }
}

pub async fn kill_agent(registry: &ProcessRegistry, process_id: &str) -> Result<(), String> {
    let handle = registry
        .stop_signals
        .lock()
        .await
        .remove(process_id)
        .ok_or_else(|| "This process is no longer running.".to_string())?;
    let signal_result = handle.signal.send(());

    #[cfg(windows)]
    if let Some(process_id) = handle.process_id {
        let process_id = process_id.to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", process_id.as_str(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }

    signal_result.map_err(|_| "The process has already exited.".to_string())
}
