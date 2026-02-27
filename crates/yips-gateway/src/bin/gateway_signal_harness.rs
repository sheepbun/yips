use std::collections::HashSet;
use std::future::pending;
use std::io::{self, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use async_trait::async_trait;
use tracing::Level;
use tracing_subscriber::FmtSubscriber;
use yips_core::config::DiscordTriggerMode;
use yips_gateway::bot_adapter::{BotAdapter, GatewayHandler, OutboundMessage};
use yips_gateway::config::GatewaySettings;
use yips_gateway::daemon_client::DaemonClientApi;
use yips_gateway::error::Result as GatewayResult;
use yips_gateway::policy::{AuthPolicy, SystemNow};
use yips_gateway::runtime::GatewayRuntime;

#[allow(dead_code)]
#[path = "../orchestration.rs"]
mod orchestration;

struct FakeAdapter;

#[async_trait]
impl BotAdapter for FakeAdapter {
    fn adapter_name(&self) -> &'static str {
        "signal-harness"
    }

    async fn run(&self, _handler: Arc<dyn GatewayHandler>) -> Result<()> {
        pending::<()>().await;
        Ok(())
    }

    async fn send(&self, _msg: OutboundMessage) -> Result<()> {
        Ok(())
    }
}

struct FakeDaemon;

#[async_trait]
impl DaemonClientApi for FakeDaemon {
    async fn send_chat(&mut self, _session_id: String, _text: String) -> GatewayResult<String> {
        Ok(String::new())
    }
}

struct FakeDaemonConnector;

#[async_trait]
impl orchestration::DaemonConnector for FakeDaemonConnector {
    async fn connect(&self, _socket_path: &Path) -> Result<Box<dyn DaemonClientApi>> {
        Ok(Box::new(FakeDaemon))
    }
}

struct HarnessShutdownSignal {
    #[cfg(unix)]
    sigint: tokio::signal::unix::Signal,
    #[cfg(unix)]
    sigterm: tokio::signal::unix::Signal,
}

impl HarnessShutdownSignal {
    fn new() -> Result<Self> {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};

            let sigint =
                signal(SignalKind::interrupt()).context("failed to register SIGINT handler")?;
            let sigterm =
                signal(SignalKind::terminate()).context("failed to register SIGTERM handler")?;
            Ok(Self { sigint, sigterm })
        }
        #[cfg(not(unix))]
        {
            Ok(Self {})
        }
    }
}

#[async_trait]
impl orchestration::ShutdownSignal for HarnessShutdownSignal {
    async fn wait(&mut self) -> &'static str {
        #[cfg(unix)]
        {
            tokio::select! {
                _ = self.sigint.recv() => "sigint",
                _ = self.sigterm.recv() => "sigterm",
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
            "ctrl_c"
        }
    }
}

fn base_settings() -> GatewaySettings {
    GatewaySettings {
        enabled: true,
        daemon_socket_path: "/tmp/yips/signal-harness.sock".into(),
        session_prefix: "gw".to_string(),
        allow_user_ids: HashSet::new(),
        max_requests: 5,
        window_secs: 60,
        discord_enabled: false,
        discord_token: None,
        discord_allowed_guild_ids: Vec::new(),
        discord_allow_dms: true,
        discord_trigger_mode: DiscordTriggerMode::AllMessages,
        telegram_enabled: false,
        telegram_token: None,
        telegram_allowed_chat_ids: Vec::new(),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_writer(std::io::stderr)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .context("Failed to set tracing subscriber")?;

    let runtime = Arc::new(GatewayRuntime::new(
        "gw",
        AuthPolicy::new(HashSet::new()),
        5,
        Duration::from_secs(60),
        SystemNow,
    ));
    let adapters: Vec<Arc<dyn BotAdapter>> = vec![Arc::new(FakeAdapter)];
    let shutdown_signal = HarnessShutdownSignal::new()?;

    tracing::info!("gateway signal harness ready");
    println!("gateway-signal-harness-ready");
    io::stdout()
        .flush()
        .context("failed to flush harness ready line")?;

    orchestration::run_adapters_with_shutdown(
        &base_settings(),
        runtime,
        adapters,
        &FakeDaemonConnector,
        shutdown_signal,
    )
    .await
}
