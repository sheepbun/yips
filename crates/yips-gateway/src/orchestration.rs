use std::future::pending;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use tokio::task::JoinSet;
use tracing::{error, info};
use yips_gateway::bot_adapter::BotAdapter;
use yips_gateway::config::GatewaySettings;
use yips_gateway::daemon_client::{DaemonClient, DaemonClientApi};
use yips_gateway::discord_adapter::{DiscordAdapter, DiscordAdapterConfig};
use yips_gateway::policy::{AuthPolicy, SystemNow};
use yips_gateway::runtime::{GatewayRuntime, RuntimeHandler};
use yips_gateway::telegram_adapter::{TelegramAdapter, TelegramAdapterConfig};

pub(crate) fn build_enabled_adapters(
    settings: &GatewaySettings,
) -> Result<Vec<Arc<dyn BotAdapter>>> {
    let mut adapters: Vec<Arc<dyn BotAdapter>> = Vec::new();

    if settings.discord_enabled {
        let token = settings.discord_token.clone().ok_or_else(|| {
            anyhow::anyhow!("gateway.discord.token is required when discord is enabled")
        })?;

        let discord_adapter: Arc<dyn BotAdapter> = Arc::new(
            DiscordAdapter::new(DiscordAdapterConfig {
                token,
                allowed_guild_ids: settings.discord_allowed_guild_ids.clone(),
                allow_dms: settings.discord_allow_dms,
                trigger_mode: settings.discord_trigger_mode.clone(),
            })
            .context("invalid gateway.discord.allowed_guild_ids configuration")?,
        );
        adapters.push(discord_adapter);
    }

    if settings.telegram_enabled {
        let token = settings.telegram_token.clone().ok_or_else(|| {
            anyhow::anyhow!("gateway.telegram.token is required when telegram is enabled")
        })?;

        let telegram_adapter: Arc<dyn BotAdapter> = Arc::new(
            TelegramAdapter::new(TelegramAdapterConfig {
                token,
                allowed_chat_ids: settings.telegram_allowed_chat_ids.clone(),
            })
            .context("invalid gateway.telegram.allowed_chat_ids configuration")?,
        );
        adapters.push(telegram_adapter);
    }

    Ok(adapters)
}

#[async_trait]
pub(crate) trait DaemonConnector: Send + Sync {
    async fn connect(&self, socket_path: &Path) -> Result<Box<dyn DaemonClientApi>>;
}

struct IpcDaemonConnector;

#[async_trait]
impl DaemonConnector for IpcDaemonConnector {
    async fn connect(&self, socket_path: &Path) -> Result<Box<dyn DaemonClientApi>> {
        let daemon_client = DaemonClient::connect(socket_path).await?;
        Ok(Box::new(daemon_client))
    }
}

#[async_trait]
pub(crate) trait ShutdownSignal: Send {
    async fn wait(&mut self) -> &'static str;
}

#[cfg_attr(not(test), allow(dead_code))]
struct NeverShutdownSignal;

#[async_trait]
impl ShutdownSignal for NeverShutdownSignal {
    async fn wait(&mut self) -> &'static str {
        pending::<()>().await;
        "never"
    }
}

struct OsShutdownSignal {
    #[cfg(unix)]
    sigint: tokio::signal::unix::Signal,
    #[cfg(unix)]
    sigterm: tokio::signal::unix::Signal,
}

impl OsShutdownSignal {
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
impl ShutdownSignal for OsShutdownSignal {
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
            if let Err(err) = tokio::signal::ctrl_c().await {
                error!(error = %err, "failed waiting for ctrl_c");
            }
            "ctrl_c"
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn run_adapters<C: DaemonConnector>(
    settings: &GatewaySettings,
    runtime: Arc<GatewayRuntime>,
    adapters: Vec<Arc<dyn BotAdapter>>,
    daemon_connector: &C,
) -> Result<()> {
    run_adapters_with_shutdown(
        settings,
        runtime,
        adapters,
        daemon_connector,
        NeverShutdownSignal,
    )
    .await
}

pub(crate) async fn run_adapters_with_shutdown<C: DaemonConnector, S: ShutdownSignal>(
    settings: &GatewaySettings,
    runtime: Arc<GatewayRuntime>,
    adapters: Vec<Arc<dyn BotAdapter>>,
    daemon_connector: &C,
    mut shutdown_signal: S,
) -> Result<()> {
    let mut adapter_runners: JoinSet<(&'static str, Result<()>)> = JoinSet::new();

    for adapter in adapters {
        let daemon_client = daemon_connector
            .connect(&settings.daemon_socket_path)
            .await
            .with_context(|| {
                format!(
                    "Could not connect to daemon at {}",
                    settings.daemon_socket_path.display()
                )
            })?;

        let adapter_name = adapter.adapter_name();
        let handler = Arc::new(RuntimeHandler::new(
            runtime.clone(),
            adapter.clone(),
            daemon_client,
        ));

        info!(adapter = adapter_name, "Starting gateway adapter");
        adapter_runners.spawn(async move { (adapter_name, adapter.run(handler).await) });
    }

    let mut last_error: Option<anyhow::Error> = None;
    let mut shutdown_requested = false;

    while !adapter_runners.is_empty() {
        tokio::select! {
            reason = shutdown_signal.wait(), if !shutdown_requested => {
                info!(reason, "shutdown signal received; cancelling adapter tasks");
                shutdown_requested = true;
                adapter_runners.abort_all();
            }
            outcome = adapter_runners.join_next() => {
                let Some(outcome) = outcome else {
                    break;
                };

                match outcome {
                    Ok((adapter_name, Ok(()))) => {
                        info!(adapter = adapter_name, "gateway adapter exited cleanly");
                    }
                    Ok((adapter_name, Err(err))) => {
                        error!(adapter = adapter_name, error = %err, "gateway adapter exited with error; keeping remaining adapters alive");
                        if !shutdown_requested {
                            last_error = Some(err);
                        }
                    }
                    Err(err) if shutdown_requested && err.is_cancelled() => {
                        info!("gateway adapter task cancelled during shutdown");
                    }
                    Err(err) => {
                        error!(error = %err, "gateway adapter task join failed; keeping remaining adapters alive");
                        if !shutdown_requested {
                            last_error = Some(anyhow::anyhow!("adapter task join failed: {err}"));
                        }
                    }
                }
            }
        }
    }

    if shutdown_requested {
        return Ok(());
    }

    if let Some(err) = last_error {
        return Err(err);
    }

    Ok(())
}

pub(crate) async fn run_gateway(settings: GatewaySettings) -> Result<()> {
    if !settings.enabled {
        info!("Gateway disabled in config; exiting");
        return Ok(());
    }

    if settings.max_requests == 0 {
        bail!("gateway.rate_limit.max_requests must be greater than zero");
    }

    let adapters = build_enabled_adapters(&settings)?;
    if adapters.is_empty() {
        info!("Gateway enabled but no adapters are enabled; exiting");
        return Ok(());
    }

    let auth_policy = AuthPolicy::new(settings.allow_user_ids.clone());
    let runtime = Arc::new(GatewayRuntime::new(
        settings.session_prefix.clone(),
        auth_policy,
        settings.max_requests,
        Duration::from_secs(settings.window_secs),
        SystemNow,
    ));

    let shutdown_signal = OsShutdownSignal::new()?;
    run_adapters_with_shutdown(
        &settings,
        runtime,
        adapters,
        &IpcDaemonConnector,
        shutdown_signal,
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use anyhow::Result;
    use async_trait::async_trait;
    use tokio::sync::{mpsc, oneshot, Mutex};
    use yips_core::config::YipsConfig;
    use yips_gateway::bot_adapter::{GatewayHandler, OutboundMessage};
    use yips_gateway::error::Result as GatewayResult;

    use super::*;

    struct FakeDaemon;

    #[async_trait]
    impl DaemonClientApi for FakeDaemon {
        async fn send_chat(&mut self, _session_id: String, _text: String) -> GatewayResult<String> {
            Ok(String::new())
        }
    }

    struct FakeDaemonConnector {
        connect_calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl DaemonConnector for FakeDaemonConnector {
        async fn connect(&self, _socket_path: &Path) -> Result<Box<dyn DaemonClientApi>> {
            self.connect_calls.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(FakeDaemon))
        }
    }

    struct FailingDaemonConnector;

    #[async_trait]
    impl DaemonConnector for FailingDaemonConnector {
        async fn connect(&self, _socket_path: &Path) -> Result<Box<dyn DaemonClientApi>> {
            Err(std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "connect boom").into())
        }
    }

    struct ManualShutdownSignal {
        rx: oneshot::Receiver<()>,
    }

    #[async_trait]
    impl ShutdownSignal for ManualShutdownSignal {
        async fn wait(&mut self) -> &'static str {
            let _ = (&mut self.rx).await;
            "manual"
        }
    }

    enum FakeAdapterMode {
        ReturnOk,
        ReturnErr(&'static str),
        WaitForever,
        WaitForRelease {
            rx: Mutex<Option<oneshot::Receiver<()>>>,
        },
    }

    struct FakeAdapter {
        name: &'static str,
        started_tx: mpsc::UnboundedSender<&'static str>,
        mode: FakeAdapterMode,
    }

    #[async_trait]
    impl BotAdapter for FakeAdapter {
        fn adapter_name(&self) -> &'static str {
            self.name
        }

        async fn run(&self, _handler: Arc<dyn GatewayHandler>) -> Result<()> {
            let _ = self.started_tx.send(self.name);

            match &self.mode {
                FakeAdapterMode::ReturnOk => Ok(()),
                FakeAdapterMode::ReturnErr(message) => bail!("{message}"),
                FakeAdapterMode::WaitForever => {
                    pending::<()>().await;
                    Ok(())
                }
                FakeAdapterMode::WaitForRelease { rx } => {
                    let receiver = {
                        let mut guard = rx.lock().await;
                        guard.take().context("release receiver already taken")?
                    };
                    let _ = receiver.await;
                    Ok(())
                }
            }
        }

        async fn send(&self, _msg: OutboundMessage) -> Result<()> {
            Ok(())
        }
    }

    fn test_runtime() -> Arc<GatewayRuntime> {
        Arc::new(GatewayRuntime::new(
            "gw",
            AuthPolicy::new(HashSet::new()),
            5,
            Duration::from_secs(60),
            SystemNow,
        ))
    }

    fn base_settings() -> GatewaySettings {
        GatewaySettings {
            enabled: true,
            daemon_socket_path: "/tmp/yips/test.sock".into(),
            session_prefix: "gw".to_string(),
            allow_user_ids: HashSet::new(),
            max_requests: 5,
            window_secs: 60,
            discord_enabled: false,
            discord_token: None,
            discord_allowed_guild_ids: Vec::new(),
            discord_allow_dms: true,
            discord_trigger_mode: yips_core::config::DiscordTriggerMode::AllMessages,
            telegram_enabled: false,
            telegram_token: None,
            telegram_allowed_chat_ids: Vec::new(),
        }
    }

    fn manual_shutdown() -> (oneshot::Sender<()>, ManualShutdownSignal) {
        let (tx, rx) = oneshot::channel();
        (tx, ManualShutdownSignal { rx })
    }

    #[tokio::test]
    async fn no_adapters_enabled_exits_cleanly() {
        let mut config = YipsConfig::default();
        config.gateway.enabled = true;
        let settings = GatewaySettings::from_config(&config);

        run_gateway(settings).await.unwrap();
    }

    #[test]
    fn missing_discord_token_errors_when_discord_enabled() {
        let mut settings = base_settings();
        settings.discord_enabled = true;

        let err = match build_enabled_adapters(&settings) {
            Ok(_) => panic!("expected missing Discord token to error"),
            Err(err) => err,
        };
        assert!(err
            .to_string()
            .contains("gateway.discord.token is required when discord is enabled"));
    }

    #[test]
    fn missing_telegram_token_errors_when_telegram_enabled() {
        let mut settings = base_settings();
        settings.telegram_enabled = true;

        let err = match build_enabled_adapters(&settings) {
            Ok(_) => panic!("expected missing Telegram token to error"),
            Err(err) => err,
        };
        assert!(err
            .to_string()
            .contains("gateway.telegram.token is required when telegram is enabled"));
    }

    #[tokio::test]
    async fn two_enabled_adapters_are_both_started() {
        let (started_tx, mut started_rx) = mpsc::unbounded_channel();
        let connectors = Arc::new(AtomicUsize::new(0));
        let daemon_connector = FakeDaemonConnector {
            connect_calls: connectors.clone(),
        };

        let adapters: Vec<Arc<dyn BotAdapter>> = vec![
            Arc::new(FakeAdapter {
                name: "discord",
                started_tx: started_tx.clone(),
                mode: FakeAdapterMode::ReturnOk,
            }),
            Arc::new(FakeAdapter {
                name: "telegram",
                started_tx,
                mode: FakeAdapterMode::ReturnOk,
            }),
        ];

        run_adapters(
            &base_settings(),
            test_runtime(),
            adapters,
            &daemon_connector,
        )
        .await
        .unwrap();

        let mut started = vec![
            started_rx.try_recv().expect("first adapter start event"),
            started_rx.try_recv().expect("second adapter start event"),
        ];
        started.sort_unstable();

        assert_eq!(started, vec!["discord", "telegram"]);
        assert_eq!(connectors.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn failing_adapter_does_not_stop_other_adapter() {
        let (started_tx, mut started_rx) = mpsc::unbounded_channel();
        let connectors = Arc::new(AtomicUsize::new(0));
        let daemon_connector = FakeDaemonConnector {
            connect_calls: connectors.clone(),
        };

        let (release_tx, release_rx) = oneshot::channel();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            let _ = release_tx.send(());
        });

        let adapters: Vec<Arc<dyn BotAdapter>> = vec![
            Arc::new(FakeAdapter {
                name: "discord",
                started_tx: started_tx.clone(),
                mode: FakeAdapterMode::ReturnErr("boom"),
            }),
            Arc::new(FakeAdapter {
                name: "telegram",
                started_tx,
                mode: FakeAdapterMode::WaitForRelease {
                    rx: Mutex::new(Some(release_rx)),
                },
            }),
        ];

        let err = run_adapters(
            &base_settings(),
            test_runtime(),
            adapters,
            &daemon_connector,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("boom"));

        let mut started = vec![
            started_rx.try_recv().expect("first adapter start event"),
            started_rx.try_recv().expect("second adapter start event"),
        ];
        started.sort_unstable();

        assert_eq!(started, vec!["discord", "telegram"]);
        assert_eq!(connectors.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn shutdown_signal_cancels_all_running_adapters() {
        let (started_tx, mut started_rx) = mpsc::unbounded_channel();
        let connectors = Arc::new(AtomicUsize::new(0));
        let daemon_connector = FakeDaemonConnector {
            connect_calls: connectors.clone(),
        };

        let adapters: Vec<Arc<dyn BotAdapter>> = vec![
            Arc::new(FakeAdapter {
                name: "discord",
                started_tx: started_tx.clone(),
                mode: FakeAdapterMode::WaitForever,
            }),
            Arc::new(FakeAdapter {
                name: "telegram",
                started_tx,
                mode: FakeAdapterMode::WaitForever,
            }),
        ];

        let (shutdown_tx, shutdown_signal) = manual_shutdown();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            let _ = shutdown_tx.send(());
        });

        run_adapters_with_shutdown(
            &base_settings(),
            test_runtime(),
            adapters,
            &daemon_connector,
            shutdown_signal,
        )
        .await
        .unwrap();

        let mut started = vec![
            started_rx.try_recv().expect("first adapter start event"),
            started_rx.try_recv().expect("second adapter start event"),
        ];
        started.sort_unstable();

        assert_eq!(started, vec!["discord", "telegram"]);
        assert_eq!(connectors.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn shutdown_after_adapter_error_cancels_remaining_and_exits_cleanly() {
        let (started_tx, mut started_rx) = mpsc::unbounded_channel();
        let connectors = Arc::new(AtomicUsize::new(0));
        let daemon_connector = FakeDaemonConnector {
            connect_calls: connectors.clone(),
        };

        let adapters: Vec<Arc<dyn BotAdapter>> = vec![
            Arc::new(FakeAdapter {
                name: "discord",
                started_tx: started_tx.clone(),
                mode: FakeAdapterMode::ReturnErr("boom"),
            }),
            Arc::new(FakeAdapter {
                name: "telegram",
                started_tx,
                mode: FakeAdapterMode::WaitForever,
            }),
        ];

        let (shutdown_tx, shutdown_signal) = manual_shutdown();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(25)).await;
            let _ = shutdown_tx.send(());
        });

        run_adapters_with_shutdown(
            &base_settings(),
            test_runtime(),
            adapters,
            &daemon_connector,
            shutdown_signal,
        )
        .await
        .unwrap();

        let mut started = vec![
            started_rx.try_recv().expect("first adapter start event"),
            started_rx.try_recv().expect("second adapter start event"),
        ];
        started.sort_unstable();

        assert_eq!(started, vec!["discord", "telegram"]);
        assert_eq!(connectors.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn daemon_connect_failure_still_errors_before_adapter_runtime() {
        let (started_tx, _started_rx) = mpsc::unbounded_channel();
        let adapters: Vec<Arc<dyn BotAdapter>> = vec![Arc::new(FakeAdapter {
            name: "discord",
            started_tx,
            mode: FakeAdapterMode::ReturnOk,
        })];

        let (_shutdown_tx, shutdown_signal) = manual_shutdown();
        let err = run_adapters_with_shutdown(
            &base_settings(),
            test_runtime(),
            adapters,
            &FailingDaemonConnector,
            shutdown_signal,
        )
        .await
        .unwrap_err();

        let msg = err.to_string();
        assert!(msg.contains("Could not connect to daemon"));
    }
}
