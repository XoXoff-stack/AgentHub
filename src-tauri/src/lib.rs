mod agents;
mod db;
mod models;
mod projects;

use agents::{detect_tools, kill_agent, run_agent_prompt, AgentInfo, ProcessRegistry};
use db::{Conversation, Database, Message};
use models::{chat_local, list_models, LocalModel, LocalProvider, LocalReply};
use projects::{
    delete_project_file, list_project_files, read_project_file, write_project_file, ProjectFile,
};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use uuid::Uuid;

pub struct AppState {
    pub processes: ProcessRegistry,
    pub database: Mutex<Option<Database>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAgentRequest {
    pub agent_id: String,
    pub prompt: String,
    pub project_path: Option<String>,
    pub conversation_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChatRequest {
    pub provider: LocalProvider,
    pub model: String,
    pub prompt: String,
    pub conversation_id: String,
    pub history: Vec<ChatTurn>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct ChatTurn {
    pub role: String,
    pub content: String,
}

#[tauri::command]
async fn scan_agents() -> Vec<AgentInfo> {
    detect_tools().await
}

#[tauri::command]
async fn run_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: SendAgentRequest,
) -> Result<String, String> {
    run_agent_prompt(app, &state.processes, request).await
}

#[tauri::command]
async fn stop_agent(state: State<'_, AppState>, process_id: String) -> Result<(), String> {
    kill_agent(&state.processes, &process_id).await
}

#[tauri::command]
async fn get_local_models(provider: LocalProvider) -> Result<Vec<LocalModel>, String> {
    list_models(provider).await
}

#[tauri::command]
async fn send_local_chat(
    app: tauri::AppHandle,
    request: LocalChatRequest,
) -> Result<LocalReply, String> {
    chat_local(app, request).await
}

#[tauri::command]
fn create_conversation(
    state: State<'_, AppState>,
    title: String,
    agent_id: String,
    project_path: Option<String>,
) -> Result<Conversation, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let conversation = Conversation {
        id: Uuid::new_v4().to_string(),
        title,
        agent_id,
        project_path,
        updated_at: now,
    };
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    let database = guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?;
    database
        .create_conversation(&conversation)
        .map_err(|error| error.to_string())?;
    Ok(conversation)
}

#[tauri::command]
fn list_conversations(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .list_conversations()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .get_messages(&conversation_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_message(
    state: State<'_, AppState>,
    conversation_id: String,
    role: String,
    content: String,
) -> Result<Message, String> {
    if !["user", "assistant", "system"].contains(&role.as_str()) {
        return Err("Unsupported message role".into());
    }
    let message = Message {
        id: Uuid::new_v4().to_string(),
        conversation_id: conversation_id.clone(),
        role,
        content,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .save_message(&message)
        .map_err(|error| error.to_string())?;
    Ok(message)
}

#[tauri::command]
fn rename_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .rename_conversation(&conversation_id, &title)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_conversation_agent(
    state: State<'_, AppState>,
    conversation_id: String,
    agent_id: String,
) -> Result<(), String> {
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .update_agent(&conversation_id, &agent_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_conversation_project(
    state: State<'_, AppState>,
    conversation_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .update_project(&conversation_id, project_path.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    let guard = state
        .database
        .lock()
        .map_err(|_| "Database lock is unavailable".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "Database is not initialized".to_string())?
        .delete_conversation(&conversation_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn project_list_files(root: String) -> Result<Vec<ProjectFile>, String> {
    list_project_files(&root)
}

#[tauri::command]
fn project_read_file(root: String, relative_path: String) -> Result<String, String> {
    read_project_file(&root, &relative_path)
}

#[tauri::command]
fn project_write_file(root: String, relative_path: String, content: String) -> Result<(), String> {
    write_project_file(&root, &relative_path, &content)
}

#[tauri::command]
fn project_delete_file(root: String, relative_path: String) -> Result<(), String> {
    delete_project_file(&root, &relative_path)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            processes: ProcessRegistry::default(),
            database: Mutex::new(None),
        })
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let db_path: PathBuf = app_data.join("agenthub.sqlite3");
            let connection = Connection::open(db_path)?;
            let database = Database::new(connection)?;
            let state = app.state::<AppState>();
            *state
                .database
                .lock()
                .map_err(|_| std::io::Error::other("Database lock is unavailable"))? =
                Some(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_agents,
            run_agent,
            stop_agent,
            send_local_chat,
            get_local_models,
            create_conversation,
            list_conversations,
            get_conversation,
            save_message,
            rename_conversation,
            update_conversation_agent,
            update_conversation_project,
            delete_conversation,
            project_list_files,
            project_read_file,
            project_write_file,
            project_delete_file,
            get_app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running AgentHub");
}
