use anyhow::{Context, Result};
use clap::Parser;
use std::path::PathBuf;
use tracing::Level;
use tracing_subscriber::FmtSubscriber;
use yips_core::config::YipsConfig;
use yips_gateway::config::GatewaySettings;

mod orchestration;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to a custom config file.
    #[arg(short, long)]
    config: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .context("Failed to set tracing subscriber")?;

    let args = Args::parse();
    let config = if let Some(path) = args.config {
        YipsConfig::load_from(&path)?
    } else {
        YipsConfig::load()?
    };

    let settings = GatewaySettings::from_config(&config);
    orchestration::run_gateway(settings).await
}
