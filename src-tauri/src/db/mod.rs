use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub agent_id: String,
    pub project_path: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn new(connection: Connection) -> rusqlite::Result<Self> {
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS conversations (
               id TEXT PRIMARY KEY,
               title TEXT NOT NULL,
               agent_id TEXT NOT NULL,
               project_path TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS messages (
               id TEXT PRIMARY KEY,
               conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
               role TEXT NOT NULL,
               content TEXT NOT NULL,
               created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_messages_conversation
               ON messages(conversation_id, created_at);",
        )?;
        Ok(Self { connection })
    }

    pub fn create_conversation(&self, item: &Conversation) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO conversations (id, title, agent_id, project_path, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                item.id,
                item.title,
                item.agent_id,
                item.project_path,
                item.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn list_conversations(&self) -> rusqlite::Result<Vec<Conversation>> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, agent_id, project_path, updated_at
             FROM conversations ORDER BY updated_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                agent_id: row.get(2)?,
                project_path: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_messages(&self, conversation_id: &str) -> rusqlite::Result<Vec<Message>> {
        let mut statement = self.connection.prepare(
            "SELECT id, conversation_id, role, content, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = statement.query_map([conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn save_message(&self, item: &Message) -> rusqlite::Result<()> {
        self.connection.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                item.id,
                item.conversation_id,
                item.role,
                item.content,
                item.created_at
            ],
        )?;
        self.connection.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![item.created_at, item.conversation_id],
        )?;
        Ok(())
    }

    pub fn rename_conversation(&self, id: &str, title: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, chrono::Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn update_project(&self, id: &str, project_path: Option<&str>) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE conversations SET project_path = ?1, updated_at = ?2 WHERE id = ?3",
            params![project_path, chrono::Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn update_agent(&self, id: &str, agent_id: &str) -> rusqlite::Result<()> {
        self.connection.execute(
            "UPDATE conversations SET agent_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![agent_id, chrono::Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: &str) -> rusqlite::Result<()> {
        self.connection
            .execute("DELETE FROM conversations WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{Conversation, Database, Message};
    use rusqlite::Connection;

    #[test]
    fn conversation_messages_persist_and_cascade_delete() {
        let database = Database::new(Connection::open_in_memory().unwrap()).unwrap();
        let conversation = Conversation {
            id: "conversation-1".into(),
            title: "Test conversation".into(),
            agent_id: "codex".into(),
            project_path: None,
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        database.create_conversation(&conversation).unwrap();
        let message = Message {
            id: "message-1".into(),
            conversation_id: conversation.id.clone(),
            role: "user".into(),
            content: "Hello".into(),
            created_at: "2026-01-01T00:00:01Z".into(),
        };
        database.save_message(&message).unwrap();

        let messages = database.get_messages(&conversation.id).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Hello");

        database.delete_conversation(&conversation.id).unwrap();
        assert!(database.get_messages(&conversation.id).unwrap().is_empty());
    }
}
