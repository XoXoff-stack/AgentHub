use crate::LocalChatRequest;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalProvider {
    Ollama,
    LmStudio,
    OpenAiCompatible,
}

impl LocalProvider {
    fn base_url(&self) -> &'static str {
        match self {
            Self::Ollama => "http://127.0.0.1:11434",
            Self::LmStudio | Self::OpenAiCompatible => "http://127.0.0.1:1234",
        }
    }

    fn is_ollama(&self) -> bool {
        matches!(self, Self::Ollama)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub id: String,
    pub name: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalReply {
    pub model: String,
    pub provider: String,
}

pub async fn list_models(provider: LocalProvider) -> Result<Vec<LocalModel>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|error| error.to_string())?;
    let url = if provider.is_ollama() {
        format!("{}/api/tags", provider.base_url())
    } else {
        format!("{}/v1/models", provider.base_url())
    };
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Local server is not reachable: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Local server returned HTTP {}", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("Invalid model list response: {error}"))?;
    let models = if provider.is_ollama() {
        body.get("models")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let id = item.get("name")?.as_str()?.to_string();
                let size = item.get("size").and_then(|value| value.as_u64());
                Some(LocalModel {
                    name: id.clone(),
                    id,
                    size,
                })
            })
            .collect()
    } else {
        body.get("data")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let id = item.get("id")?.as_str()?.to_string();
                Some(LocalModel {
                    name: id.clone(),
                    id,
                    size: None,
                })
            })
            .collect()
    };
    Ok(models)
}

pub async fn chat_local(app: AppHandle, request: LocalChatRequest) -> Result<LocalReply, String> {
    if request.model.trim().is_empty() {
        return Err("Select a local model first.".into());
    }
    if request.prompt.trim().is_empty() {
        return Err("Write a message first.".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| error.to_string())?;
    let mut turns = request
        .history
        .into_iter()
        .map(|turn| serde_json::json!({ "role": turn.role, "content": turn.content }))
        .collect::<Vec<_>>();
    turns.push(serde_json::json!({ "role": "user", "content": request.prompt }));

    if request.provider.is_ollama() {
        let response = client
            .post(format!("{}/api/chat", request.provider.base_url()))
            .json(&serde_json::json!({
                "model": request.model.clone(),
                "messages": turns,
                "stream": true
            }))
            .send()
            .await
            .map_err(|error| format!("Could not reach Ollama: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Ollama returned HTTP {}", response.status()));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("Ollama stream failed: {error}"))?;
            buffer.extend_from_slice(&chunk);
            while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=index).collect();
                emit_ollama_line(&app, &request.conversation_id, &line);
            }
        }
        if !buffer.is_empty() {
            emit_ollama_line(&app, &request.conversation_id, &buffer);
        }
    } else {
        let response = client
            .post(format!(
                "{}/v1/chat/completions",
                request.provider.base_url()
            ))
            .json(&serde_json::json!({
                "model": request.model.clone(),
                "messages": turns,
                "stream": true
            }))
            .send()
            .await
            .map_err(|error| format!("Could not reach the OpenAI-compatible server: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Local server returned HTTP {}", response.status()));
        }

        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("Model stream failed: {error}"))?;
            buffer.extend_from_slice(&chunk);
            while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
                let line: Vec<u8> = buffer.drain(..=index).collect();
                emit_openai_line(&app, &request.conversation_id, &line);
            }
        }
        if !buffer.is_empty() {
            emit_openai_line(&app, &request.conversation_id, &buffer);
        }
    }

    let _ = app.emit(
        "model-finished",
        serde_json::json!({ "conversationId": request.conversation_id }),
    );
    Ok(LocalReply {
        model: request.model,
        provider: match request.provider {
            LocalProvider::Ollama => "ollama",
            LocalProvider::LmStudio => "lmStudio",
            LocalProvider::OpenAiCompatible => "openAiCompatible",
        }
        .to_string(),
    })
}

fn emit_ollama_line(app: &AppHandle, conversation_id: &str, line: &[u8]) {
    let line = String::from_utf8_lossy(line);
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
        if let Some(content) = value
            .pointer("/message/content")
            .and_then(|value| value.as_str())
        {
            emit_model_text(app, conversation_id, content);
        }
    }
}

fn emit_openai_line(app: &AppHandle, conversation_id: &str, line: &[u8]) {
    let line = String::from_utf8_lossy(line);
    let data = line
        .trim()
        .strip_prefix("data:")
        .map(str::trim)
        .unwrap_or("");
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
        if let Some(content) = value
            .pointer("/choices/0/delta/content")
            .and_then(|value| value.as_str())
        {
            emit_model_text(app, conversation_id, content);
        }
    }
}

fn emit_model_text(app: &AppHandle, conversation_id: &str, text: &str) {
    if !text.is_empty() {
        let _ = app.emit(
            "model-output",
            serde_json::json!({
                "conversationId": conversation_id,
                "text": text
            }),
        );
    }
}
