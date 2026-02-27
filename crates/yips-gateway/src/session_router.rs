//! Per-user session routing for external adapters.

use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct SessionKey {
    adapter: String,
    user_id: String,
}

/// Maintains stable daemon session IDs keyed by adapter and user.
#[derive(Debug)]
pub struct SessionRouter {
    prefix: String,
    sessions: RwLock<HashMap<SessionKey, String>>,
}

impl SessionRouter {
    /// Create a new in-memory session router.
    pub fn new(prefix: impl Into<String>) -> Self {
        Self {
            prefix: prefix.into(),
            sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Resolve stable session ID for an adapter/user pair.
    pub fn session_id_for(&self, adapter: &str, user_id: &str) -> String {
        let key = SessionKey {
            adapter: adapter.to_string(),
            user_id: user_id.to_string(),
        };

        if let Some(session_id) = self.sessions.read().unwrap().get(&key) {
            return session_id.clone();
        }

        let mut sessions = self.sessions.write().unwrap();
        if let Some(session_id) = sessions.get(&key) {
            return session_id.clone();
        }

        let session_id = format!("{}:{}:{}", self.prefix, key.adapter, key.user_id);
        sessions.insert(key, session_id.clone());
        session_id
    }
}

#[cfg(test)]
mod tests {
    use super::SessionRouter;

    #[test]
    fn same_adapter_and_user_gets_stable_session_id() {
        let router = SessionRouter::new("gw");
        let first = router.session_id_for("discord", "u123");
        let second = router.session_id_for("discord", "u123");
        assert_eq!(first, second);
        assert_eq!(first, "gw:discord:u123");
    }

    #[test]
    fn same_user_across_adapters_gets_distinct_session_ids() {
        let router = SessionRouter::new("gw");
        let discord = router.session_id_for("discord", "u123");
        let telegram = router.session_id_for("telegram", "u123");
        assert_ne!(discord, telegram);
    }

    #[test]
    fn different_users_get_distinct_session_ids() {
        let router = SessionRouter::new("gw");
        let a = router.session_id_for("discord", "u1");
        let b = router.session_id_for("discord", "u2");
        assert_ne!(a, b);
    }

    #[test]
    fn channel_does_not_affect_session_id() {
        let router = SessionRouter::new("gw");
        let session_from_channel_a = router.session_id_for("discord", "u123");
        let session_from_channel_b = router.session_id_for("discord", "u123");
        assert_eq!(session_from_channel_a, session_from_channel_b);
    }
}
