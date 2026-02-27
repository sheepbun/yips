use anyhow::{Context, Result};
use clap::Parser;
use std::path::PathBuf;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;
use yips_core::config::YipsConfig;

mod server;
mod session;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to a custom config file
    #[arg(short, long)]
    config: Option<PathBuf>,

    /// Run in foreground (default, systemd handles backgrounding usually)
    #[arg(short, long, default_value_t = false)]
    daemonize: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .context("Failed to set tracing subscriber")?;

    let args = Args::parse();

    // Load configuration
    let config = if let Some(path) = args.config {
        YipsConfig::load_from(&path)?
    } else {
        YipsConfig::load()?
    };

    info!("Starting yips-daemon...");

    // Determine socket path
    let socket_path = config.socket_path();

    // Start server
    let server = server::DaemonServer::new(config, socket_path);
    server.run().await?;

    Ok(())
}
