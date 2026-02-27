use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tokio::net::UnixStream;
use yips_core::ipc::{
    read_message, write_message, CancelOrigin, CancelOutcome, ClientMessage, DaemonMessage,
};

#[derive(Parser, Debug)]
#[command(author, version, about = "Yips AI Agent CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Send a query to the Yips agent
    Ask {
        /// Your question or instruction
        query: String,
        /// Optional session ID to continue a conversation
        #[arg(short, long)]
        session: Option<String>,
    },
    /// Check daemon status
    Status,
    /// List active sessions
    Sessions,
    /// Stop the daemon
    Stop,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let socket_path = get_socket_path();
    let mut stream = UnixStream::connect(&socket_path).await.context(format!(
        "Could not connect to daemon at {:?}. Is it running?",
        socket_path
    ))?;

    match cli.command {
        Commands::Ask { query, session } => {
            run_ask(&mut stream, query, session).await?;
        }
        Commands::Status => {
            write_message(&mut stream, &ClientMessage::Status).await?;
            let response: DaemonMessage = read_message(&mut stream).await?;
            if let DaemonMessage::StatusResponse {
                active_sessions,
                llm_connected,
            } = response
            {
                println!("Daemon: Running");
                println!("LLM Connected: {}", llm_connected);
                println!("Active Sessions: {}", active_sessions.len());
            }
        }
        Commands::Sessions => {
            write_message(&mut stream, &ClientMessage::ListSessions).await?;
            let response: DaemonMessage = read_message(&mut stream).await?;
            if let DaemonMessage::SessionList { sessions } = response {
                if sessions.is_empty() {
                    println!("No active sessions.");
                } else {
                    println!("{:<36} {:<10}", "ID", "Messages");
                    for s in sessions {
                        println!("{:<36} {:<10}", s.id, s.message_count);
                    }
                }
            }
        }
        Commands::Stop => {
            write_message(&mut stream, &ClientMessage::Shutdown).await?;
            println!("Shutdown requested.");
        }
    }

    Ok(())
}

fn get_socket_path() -> PathBuf {
    if let Ok(runtime_dir) = std::env::var("XDG_RUNTIME_DIR") {
        let mut path = PathBuf::from(runtime_dir);
        path.push("yips");
        path.push("daemon.sock");
        if path.exists() {
            return path;
        }
    }

    let mut path = std::env::temp_dir();
    path.push("yips");
    path.push("daemon.sock");
    path
}

async fn run_ask(stream: &mut UnixStream, query: String, session: Option<String>) -> Result<()> {
    let msg = ClientMessage::Chat {
        session_id: session,
        message: query,
        working_directory: std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string()),
    };
    write_message(stream, &msg).await?;

    let mut saw_streamed_tokens = false;

    loop {
        let response: DaemonMessage = read_message(stream).await?;
        match response {
            DaemonMessage::Token { token, .. } => {
                saw_streamed_tokens = true;
                print!("{}", token);
                use std::io::Write;
                std::io::stdout().flush().ok();
            }
            DaemonMessage::AssistantMessage { content, .. } => {
                if !content.is_empty() && !saw_streamed_tokens {
                    println!("\n--- Final Response ---\n{}", content);
                } else if saw_streamed_tokens {
                    println!();
                }
            }
            DaemonMessage::ToolStart { tool_name, .. } => {
                println!("\n[Tool: {}]", tool_name);
            }
            DaemonMessage::ToolResult {
                tool_call_id,
                success,
                output,
                ..
            } => {
                if success {
                    println!("[Tool {} ok]", tool_call_id);
                } else {
                    println!("[Tool {} failed: {}]", tool_call_id, output);
                }
            }
            DaemonMessage::TurnComplete {
                session_id,
                round_count,
            } => {
                println!(
                    "[Turn complete] session={} rounds={}",
                    session_id, round_count
                );
                break;
            }
            DaemonMessage::CancelResult {
                session_id,
                outcome,
                origin,
            } => {
                let msg = match (outcome, origin) {
                    (CancelOutcome::CancelledActiveTurn, CancelOrigin::UserRequest) => {
                        format!("Cancel succeeded: session={session_id}")
                    }
                    (CancelOutcome::NoActiveTurn, CancelOrigin::UserRequest) => {
                        format!("Cancel ignored: no active turn (session={session_id})")
                    }
                    (CancelOutcome::CancelledActiveTurn, CancelOrigin::SupersededByNewChat) => {
                        format!(
                            "Previous turn cancelled by a new chat request (session={session_id})"
                        )
                    }
                    (CancelOutcome::NoActiveTurn, CancelOrigin::SupersededByNewChat) => {
                        format!("Cancel ignored: no active turn (session={session_id})")
                    }
                };
                println!("[System] {}", msg);
            }
            DaemonMessage::Error { message, .. } => {
                return Err(anyhow::anyhow!(message));
            }
            _ => {}
        }
    }

    Ok(())
}
