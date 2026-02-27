use anyhow::{Context, Result};
use clap::Parser;
use crossterm::event::{self, Event};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::{execute, ExecutableCommand};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::Terminal;
use std::io::{self, Stdout};
use std::path::PathBuf;
use std::time::Duration;
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tracing::{error, Level};
use tracing_subscriber::FmtSubscriber;
use yips_core::config::YipsConfig;
use yips_core::ipc::{read_message, write_message, DaemonMessage};

mod state;
mod ui;

use state::{AppState, KeyAction};

#[derive(Parser, Debug)]
#[command(author, version, about = "Yips terminal UI")]
struct Args {
    /// Optional custom config path.
    #[arg(short, long)]
    config: Option<PathBuf>,

    /// Optional session ID to continue a conversation.
    #[arg(short, long)]
    session: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing()?;

    let args = Args::parse();
    let config = load_config(args.config.as_deref())?;

    let socket_path = config.socket_path();
    let stream = UnixStream::connect(&socket_path).await.context(format!(
        "Could not connect to daemon at {:?}. Is it running?",
        socket_path
    ))?;

    let mut app = AppState::new(args.session);
    let cwd = std::env::current_dir()
        .ok()
        .map(|p| p.to_string_lossy().to_string());

    let _terminal_guard = TerminalGuard::setup()?;
    let backend = CrosstermBackend::new(io::stdout());
    let mut terminal = Terminal::new(backend).context("failed to create terminal")?;

    let (mut reader, mut writer) = stream.into_split();
    let (daemon_tx, mut daemon_rx) = mpsc::unbounded_channel::<Result<DaemonMessage>>();

    tokio::spawn(async move {
        loop {
            let msg = read_message::<_, DaemonMessage>(&mut reader)
                .await
                .context("failed to read daemon message");
            let is_err = msg.is_err();
            if daemon_tx.send(msg).is_err() {
                break;
            }
            if is_err {
                break;
            }
        }
    });

    while !app.should_quit {
        let terminal_area = terminal
            .size()
            .context("failed to read terminal size for viewport")?;
        let terminal_rect = Rect::new(0, 0, terminal_area.width, terminal_area.height);
        app.set_history_viewport_lines(ui::history_viewport_lines(terminal_rect));

        terminal
            .draw(|frame| ui::draw(frame, &app))
            .context("failed to draw frame")?;

        while let Ok(msg_result) = daemon_rx.try_recv() {
            match msg_result {
                Ok(msg) => app.apply_daemon_message(msg),
                Err(e) => {
                    app.apply_daemon_message(DaemonMessage::Error {
                        session_id: app.session_id.clone(),
                        message: e.to_string(),
                    });
                    app.should_quit = true;
                }
            }
        }

        if event::poll(Duration::from_millis(50)).context("input poll failed")? {
            if let Event::Key(key) = event::read().context("input read failed")? {
                match app.handle_key_event(key) {
                    KeyAction::Submit => {
                        if let Some(msg) = app.submit_input(cwd.clone()) {
                            write_message(&mut writer, &msg)
                                .await
                                .context("failed to send chat message")?;
                        }
                    }
                    KeyAction::CancelTurn => {
                        if let Some(msg) = app.build_cancel_message() {
                            write_message(&mut writer, &msg)
                                .await
                                .context("failed to send cancel message")?;
                        }
                    }
                    KeyAction::ScrollUpLine => app.scroll_history_up(1),
                    KeyAction::ScrollDownLine => app.scroll_history_down(1),
                    KeyAction::ScrollUpPage => app.scroll_history_page_up(),
                    KeyAction::ScrollDownPage => app.scroll_history_page_down(),
                    KeyAction::Quit => {
                        break;
                    }
                    KeyAction::None => {}
                }
            }
        }
    }

    Ok(())
}

fn init_tracing() -> Result<()> {
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).context("failed to set tracing subscriber")
}

fn load_config(path: Option<&std::path::Path>) -> Result<YipsConfig> {
    match path {
        Some(path) => YipsConfig::load_from(path).context("failed to load config file"),
        None => YipsConfig::load().context("failed to load default config"),
    }
}

struct TerminalGuard {
    stdout: Stdout,
}

impl TerminalGuard {
    fn setup() -> Result<Self> {
        enable_raw_mode().context("failed to enable raw mode")?;

        let mut stdout = io::stdout();
        execute!(stdout, EnterAlternateScreen).context("failed to enter alternate screen")?;
        stdout
            .execute(crossterm::cursor::Hide)
            .context("failed to hide cursor")?;

        Ok(Self { stdout })
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        if let Err(e) = self.stdout.execute(crossterm::cursor::Show) {
            error!(error = %e, "failed to show cursor");
        }
        if let Err(e) = execute!(self.stdout, LeaveAlternateScreen) {
            error!(error = %e, "failed to leave alternate screen");
        }
        if let Err(e) = disable_raw_mode() {
            error!(error = %e, "failed to disable raw mode");
        }
    }
}
