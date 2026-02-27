use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;
use async_trait::async_trait;
use yips_gateway::bot_adapter::{BotAdapter, GatewayHandler, InboundMessage, OutboundMessage};
use yips_gateway::daemon_client::DaemonClientApi;
use yips_gateway::error::Result as GatewayResult;
use yips_gateway::policy::{AuthPolicy, NowProvider, SystemNow};
use yips_gateway::runtime::GatewayRuntime;

#[derive(Default)]
struct FakeAdapter {
    sent_messages: Arc<Mutex<Vec<OutboundMessage>>>,
}

#[async_trait]
impl BotAdapter for FakeAdapter {
    fn adapter_name(&self) -> &'static str {
        "fake"
    }

    async fn run(&self, _handler: Arc<dyn GatewayHandler>) -> Result<()> {
        Ok(())
    }

    async fn send(&self, msg: OutboundMessage) -> Result<()> {
        self.sent_messages.lock().unwrap().push(msg);
        Ok(())
    }
}

#[derive(Default)]
struct FakeDaemon {
    calls: Vec<(String, String)>,
    response: String,
}

#[async_trait]
impl DaemonClientApi for FakeDaemon {
    async fn send_chat(&mut self, session_id: String, text: String) -> GatewayResult<String> {
        self.calls.push((session_id, text));
        Ok(self.response.clone())
    }
}

#[derive(Clone)]
struct FixedClock {
    now: Instant,
}

impl NowProvider for FixedClock {
    fn now(&self) -> Instant {
        self.now
    }
}

#[tokio::test]
async fn happy_path_routes_to_daemon_and_sends_response() {
    let auth = AuthPolicy::new(HashSet::new());
    let runtime = GatewayRuntime::new("gw", auth, 5, Duration::from_secs(60), SystemNow);
    let adapter = FakeAdapter::default();
    let mut daemon = FakeDaemon {
        response: "assistant reply".to_string(),
        ..Default::default()
    };

    runtime
        .process_message(
            &mut daemon,
            &adapter,
            InboundMessage {
                adapter: "discord".to_string(),
                user_id: "u123".to_string(),
                channel_id: Some("c1".to_string()),
                text: "hello".to_string(),
            },
        )
        .await
        .unwrap();

    assert_eq!(daemon.calls.len(), 1);
    assert_eq!(daemon.calls[0].0, "gw:discord:u123");
    assert_eq!(daemon.calls[0].1, "hello");

    let sent = adapter.sent_messages.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].text, "assistant reply");
}

#[tokio::test]
async fn auth_denied_blocks_daemon_call() {
    let mut allow = HashSet::new();
    allow.insert("allowed-user".to_string());

    let auth = AuthPolicy::new(allow);
    let runtime = GatewayRuntime::new("gw", auth, 5, Duration::from_secs(60), SystemNow);
    let adapter = FakeAdapter::default();
    let mut daemon = FakeDaemon {
        response: "assistant reply".to_string(),
        ..Default::default()
    };

    runtime
        .process_message(
            &mut daemon,
            &adapter,
            InboundMessage {
                adapter: "discord".to_string(),
                user_id: "blocked-user".to_string(),
                channel_id: Some("c1".to_string()),
                text: "hello".to_string(),
            },
        )
        .await
        .unwrap();

    assert!(daemon.calls.is_empty());
    let sent = adapter.sent_messages.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert!(sent[0].text.contains("not authorized"));
}

#[tokio::test]
async fn rate_limited_user_does_not_hit_daemon() {
    let auth = AuthPolicy::new(HashSet::new());
    let clock = FixedClock {
        now: Instant::now(),
    };
    let runtime = GatewayRuntime::new("gw", auth, 1, Duration::from_secs(60), clock);
    let adapter = FakeAdapter::default();
    let mut daemon = FakeDaemon {
        response: "assistant reply".to_string(),
        ..Default::default()
    };

    runtime
        .process_message(
            &mut daemon,
            &adapter,
            InboundMessage {
                adapter: "discord".to_string(),
                user_id: "u123".to_string(),
                channel_id: Some("c1".to_string()),
                text: "hello".to_string(),
            },
        )
        .await
        .unwrap();

    runtime
        .process_message(
            &mut daemon,
            &adapter,
            InboundMessage {
                adapter: "discord".to_string(),
                user_id: "u123".to_string(),
                channel_id: Some("c1".to_string()),
                text: "hello again".to_string(),
            },
        )
        .await
        .unwrap();

    assert_eq!(daemon.calls.len(), 1);
    let sent = adapter.sent_messages.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert!(sent[1].text.contains("Rate limit exceeded"));
}
