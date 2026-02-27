use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
use yips_core::ipc::SessionInfo;
use yips_core::message::ChatMessage;

/// Session state and history.
pub struct Session {
    pub id: String,
    pub messages: Vec<ChatMessage>,
    pub created_at: String,
    pub working_directory: Option<String>,
}

impl Session {
    pub fn new(id: Option<String>, working_directory: Option<String>) -> Self {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());

        Self {
            id: id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            messages: Vec::new(),
            created_at,
            working_directory,
        }
    }

    pub fn add_message(&mut self, message: ChatMessage) {
        self.messages.push(message);
    }
}

/// Registry of active sessions.
#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, Arc<RwLock<Session>>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_or_create(
        &self,
        id: Option<String>,
        working_directory: Option<String>,
    ) -> Arc<RwLock<Session>> {
        let mut sessions = self.sessions.write().unwrap();

        if let Some(ref id_str) = id {
            if let Some(session) = sessions.get(id_str) {
                return session.clone();
            }
        }

        let session = Arc::new(RwLock::new(Session::new(id, working_directory)));
        let session_id = session.read().unwrap().id.clone();
        sessions.insert(session_id, session.clone());
        session
    }

    pub fn list_ids(&self) -> Vec<String> {
        let sessions = self.sessions.read().unwrap();
        sessions.keys().cloned().collect()
    }

    pub fn list_info(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.read().unwrap();
        sessions
            .values()
            .map(|session| {
                let session = session.read().unwrap();
                SessionInfo {
                    id: session.id.clone(),
                    created_at: session.created_at.clone(),
                    message_count: session.messages.len(),
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_info_reports_real_message_count() {
        let manager = SessionManager::new();
        let session = manager.get_or_create(Some("s1".to_string()), None);

        {
            let mut session = session.write().unwrap();
            session.add_message(ChatMessage::user("hello"));
            session.add_message(ChatMessage::assistant("world"));
        }

        let info = manager.list_info();
        assert_eq!(info.len(), 1);
        assert_eq!(info[0].id, "s1");
        assert_eq!(info[0].message_count, 2);
        assert_ne!(info[0].created_at, "unknown");
    }
}
