use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;

use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UnixStream};
use tokio::process::{Child, Command};
use tokio::time::{sleep, timeout};
use yips_core::ipc::{
    read_message, write_message, CancelOrigin, CancelOutcome, ClientMessage, DaemonMessage,
};

#[tokio::test]
async fn chat_stream_orders_tool_events_before_turn_complete() {
    let (mock_base_url, mock_handle) = start_mock_llama_server().await;

    let temp = tempdir().expect("create temp dir");
    let socket_path = temp.path().join("daemon.sock");
    let config_path = temp.path().join("config.toml");

    let config = format!(
        r#"
[llm]
base_url = "{base_url}"
model = "mock-model"
max_tokens = 512
temperature = 0.1

[daemon]
socket_path = "{socket_path}"
auto_start_llm = false

[agent]
max_rounds = 6
failure_pivot_threshold = 2

[skills]
extra_dirs = []
default_timeout_secs = 30
"#,
        base_url = mock_base_url,
        socket_path = socket_path.display(),
    );

    tokio::fs::write(&config_path, config)
        .await
        .expect("write config");

    let mut daemon = spawn_daemon(&config_path).await;
    wait_for_socket(&socket_path).await;

    let mut stream = UnixStream::connect(&socket_path)
        .await
        .expect("connect daemon socket");

    let chat = ClientMessage::Chat {
        session_id: Some("it-order-session".to_string()),
        message: "List /tmp".to_string(),
        working_directory: Some("/tmp".to_string()),
    };
    write_message(&mut stream, &chat)
        .await
        .expect("send chat request");

    let mut saw_token = false;
    let mut saw_assistant = false;
    let mut saw_tool_start = false;
    let mut saw_tool_result = false;
    let mut saw_turn_complete = false;

    loop {
        let msg = timeout(
            Duration::from_secs(15),
            read_message::<_, DaemonMessage>(&mut stream),
        )
        .await
        .expect("timed out waiting for daemon message")
        .expect("read daemon message");

        match msg {
            DaemonMessage::Token { .. } => {
                saw_token = true;
                assert!(!saw_turn_complete, "token after turn complete");
            }
            DaemonMessage::AssistantMessage { .. } => {
                saw_assistant = true;
                assert!(!saw_turn_complete, "assistant message after turn complete");
            }
            DaemonMessage::ToolStart { .. } => {
                saw_tool_start = true;
                assert!(!saw_turn_complete, "tool start after turn complete");
            }
            DaemonMessage::ToolResult { .. } => {
                assert!(saw_tool_start, "tool result before tool start");
                saw_tool_result = true;
                assert!(!saw_turn_complete, "tool result after turn complete");
            }
            DaemonMessage::TurnComplete { session_id, .. } => {
                assert_eq!(session_id, "it-order-session");
                saw_turn_complete = true;
                break;
            }
            DaemonMessage::Error { message, .. } => {
                panic!("daemon returned error: {message}");
            }
            _ => {}
        }
    }

    assert!(saw_tool_start, "expected tool start event");
    assert!(saw_tool_result, "expected tool result event");
    assert!(saw_token, "expected at least one token event");
    assert!(
        saw_assistant,
        "expected at least one assistant message event"
    );
    assert!(saw_turn_complete, "expected turn complete event");

    send_shutdown(&socket_path).await;
    wait_for_daemon_exit(&mut daemon).await;
    mock_handle.abort();
}

#[tokio::test]
async fn cancel_reports_no_active_turn_when_idle() {
    let (mock_base_url, mock_handle) = start_mock_llama_server().await;

    let temp = tempdir().expect("create temp dir");
    let socket_path = temp.path().join("daemon.sock");
    let config_path = temp.path().join("config.toml");

    let config = format!(
        r#"
[llm]
base_url = "{base_url}"
model = "mock-model"
max_tokens = 512
temperature = 0.1

[daemon]
socket_path = "{socket_path}"
auto_start_llm = false

[agent]
max_rounds = 6
failure_pivot_threshold = 2

[skills]
extra_dirs = []
default_timeout_secs = 30
"#,
        base_url = mock_base_url,
        socket_path = socket_path.display(),
    );

    tokio::fs::write(&config_path, config)
        .await
        .expect("write config");

    let mut daemon = spawn_daemon(&config_path).await;
    wait_for_socket(&socket_path).await;

    let mut stream = UnixStream::connect(&socket_path)
        .await
        .expect("connect daemon socket");

    let session_id = "it-cancel-idle";
    write_message(
        &mut stream,
        &ClientMessage::Cancel {
            session_id: session_id.to_string(),
        },
    )
    .await
    .expect("send cancel request");

    let message = wait_for_daemon_message_matching(&mut stream, Duration::from_secs(10), |msg| {
        matches!(
            msg,
            DaemonMessage::CancelResult {
                session_id: id,
                outcome: CancelOutcome::NoActiveTurn,
                origin: CancelOrigin::UserRequest,
            } if id == session_id
        )
    })
    .await;

    match message {
        DaemonMessage::CancelResult {
            session_id: id,
            outcome,
            origin,
        } => {
            assert_eq!(id, session_id);
            assert_eq!(outcome, CancelOutcome::NoActiveTurn);
            assert_eq!(origin, CancelOrigin::UserRequest);
        }
        other => panic!("unexpected daemon message: {other:?}"),
    }

    assert_no_daemon_message_matching(&mut stream, Duration::from_millis(750), |msg| {
        matches!(
            msg,
            DaemonMessage::Error {
                session_id: Some(id),
                message,
            } if id == session_id && message.starts_with("No active turn for session: ")
        )
    })
    .await;

    send_shutdown(&socket_path).await;
    wait_for_daemon_exit(&mut daemon).await;
    mock_handle.abort();
}

#[tokio::test]
async fn cancel_reports_cancelled_session_turn_when_active() {
    let (mock_base_url, mock_handle) = start_mock_llama_server().await;

    let temp = tempdir().expect("create temp dir");
    let socket_path = temp.path().join("daemon.sock");
    let config_path = temp.path().join("config.toml");

    let config = format!(
        r#"
[llm]
base_url = "{base_url}"
model = "mock-model"
max_tokens = 512
temperature = 0.1

[daemon]
socket_path = "{socket_path}"
auto_start_llm = false

[agent]
max_rounds = 6
failure_pivot_threshold = 2

[skills]
extra_dirs = []
default_timeout_secs = 30
"#,
        base_url = mock_base_url,
        socket_path = socket_path.display(),
    );

    tokio::fs::write(&config_path, config)
        .await
        .expect("write config");

    let mut daemon = spawn_daemon(&config_path).await;
    wait_for_socket(&socket_path).await;

    let mut stream = UnixStream::connect(&socket_path)
        .await
        .expect("connect daemon socket");

    let session_id = "it-cancel-active";
    write_message(
        &mut stream,
        &ClientMessage::Chat {
            session_id: Some(session_id.to_string()),
            message: "Generate output that can be cancelled".to_string(),
            working_directory: Some("/tmp".to_string()),
        },
    )
    .await
    .expect("send chat request");

    write_message(
        &mut stream,
        &ClientMessage::Cancel {
            session_id: session_id.to_string(),
        },
    )
    .await
    .expect("send cancel request");

    let message = wait_for_daemon_message_matching(&mut stream, Duration::from_secs(10), |msg| {
        matches!(
            msg,
            DaemonMessage::CancelResult {
                session_id: id,
                outcome: CancelOutcome::CancelledActiveTurn,
                origin: CancelOrigin::UserRequest,
            } if id == session_id
        )
    })
    .await;

    match message {
        DaemonMessage::CancelResult {
            session_id: id,
            outcome,
            origin,
        } => {
            assert_eq!(id, session_id);
            assert_eq!(outcome, CancelOutcome::CancelledActiveTurn);
            assert_eq!(origin, CancelOrigin::UserRequest);
        }
        other => panic!("unexpected daemon message: {other:?}"),
    }

    assert_no_daemon_message_matching(&mut stream, Duration::from_millis(750), |msg| {
        matches!(
            msg,
            DaemonMessage::Error {
                session_id: Some(id),
                message,
            } if id == session_id && message.starts_with("Cancelled session turn: ")
        )
    })
    .await;

    send_shutdown(&socket_path).await;
    wait_for_daemon_exit(&mut daemon).await;
    mock_handle.abort();
}

async fn spawn_daemon(config_path: &std::path::Path) -> Child {
    Command::new(env!("CARGO_BIN_EXE_yips-daemon"))
        .arg("--config")
        .arg(config_path)
        .spawn()
        .expect("spawn yips-daemon")
}

async fn wait_for_socket(socket_path: &std::path::Path) {
    for _ in 0..100 {
        if socket_path.exists() {
            return;
        }
        sleep(Duration::from_millis(50)).await;
    }
    panic!("daemon socket not created at {}", socket_path.display());
}

async fn send_shutdown(socket_path: &std::path::Path) {
    if let Ok(mut stream) = UnixStream::connect(socket_path).await {
        let _ = write_message(&mut stream, &ClientMessage::Shutdown).await;
    }
}

async fn wait_for_daemon_exit(daemon: &mut Child) {
    match timeout(Duration::from_secs(5), daemon.wait()).await {
        Ok(Ok(status)) => assert!(status.success(), "daemon exited with {status}"),
        _ => {
            let _ = daemon.kill().await;
            let _ = daemon.wait().await;
            panic!("daemon did not exit after shutdown request");
        }
    }
}

async fn wait_for_daemon_message_matching<F>(
    stream: &mut UnixStream,
    total_timeout: Duration,
    mut predicate: F,
) -> DaemonMessage
where
    F: FnMut(&DaemonMessage) -> bool,
{
    let deadline = tokio::time::Instant::now() + total_timeout;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out waiting for expected daemon message"
        );

        let msg = timeout(remaining, read_message::<_, DaemonMessage>(stream))
            .await
            .expect("timed out waiting for daemon message")
            .expect("read daemon message");

        if predicate(&msg) {
            return msg;
        }
    }
}

async fn assert_no_daemon_message_matching<F>(
    stream: &mut UnixStream,
    total_timeout: Duration,
    mut predicate: F,
) where
    F: FnMut(&DaemonMessage) -> bool,
{
    let deadline = tokio::time::Instant::now() + total_timeout;

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return;
        }

        let read_window = remaining.min(Duration::from_millis(100));
        match timeout(read_window, read_message::<_, DaemonMessage>(stream)).await {
            Ok(Ok(msg)) => {
                assert!(
                    !predicate(&msg),
                    "received unexpected daemon message while asserting absence: {msg:?}"
                );
            }
            Ok(Err(_)) => return,
            Err(_) => {}
        }
    }
}

async fn start_mock_llama_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock llama server");
    let addr = listener.local_addr().expect("mock server local addr");
    let req_count = Arc::new(AtomicUsize::new(0));

    let handle = tokio::spawn(async move {
        loop {
            let (socket, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => break,
            };
            let counter = req_count.clone();
            tokio::spawn(async move {
                handle_mock_connection(socket, counter).await;
            });
        }
    });

    (format!("http://{}", addr), handle)
}

async fn handle_mock_connection(mut socket: TcpStream, req_count: Arc<AtomicUsize>) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];

    loop {
        match socket.read(&mut chunk).await {
            Ok(0) => return,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => return,
        }
    }

    let header_end = match find_subslice(&buf, b"\r\n\r\n") {
        Some(idx) => idx + 4,
        None => return,
    };

    let headers = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let mut lines = headers.lines();
    let request_line = match lines.next() {
        Some(line) => line,
        None => return,
    };
    let mut parts = request_line.split_whitespace();
    let _method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default().to_string();

    let mut content_len = 0usize;
    for line in lines {
        let lower = line.to_ascii_lowercase();
        if let Some((name, value)) = lower.split_once(':') {
            if name.trim() == "content-length" {
                content_len = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    let mut already_body = buf.len().saturating_sub(header_end);
    while already_body < content_len {
        match socket.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                already_body += n;
                buf.extend_from_slice(&chunk[..n]);
            }
            Err(_) => break,
        }
    }
    let body_start = header_end;
    let body_end = body_start.saturating_add(content_len).min(buf.len());
    let body = String::from_utf8_lossy(&buf[body_start..body_end]);

    if path == "/health" {
        let _ =
            write_http_response(&mut socket, 200, "application/json", "{\"status\":\"ok\"}").await;
        return;
    }

    if path == "/v1/models" {
        let body = "{\"data\":[{\"id\":\"mock-model\"}]}";
        let _ = write_http_response(&mut socket, 200, "application/json", body).await;
        return;
    }

    if path != "/v1/chat/completions" {
        let _ = write_http_response(&mut socket, 404, "text/plain", "not found").await;
        return;
    }

    if body.contains("Generate output that can be cancelled") {
        sleep(Duration::from_millis(300)).await;
    }

    let call_idx = req_count.fetch_add(1, Ordering::SeqCst);
    let sse_body = if call_idx == 0 {
        [
            sse_chunk(serde_json::json!({
                "tool_calls": [{
                    "index": 0,
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "list_", "arguments": "{\"path\":\"/t"}
                }]
            })),
            sse_chunk(serde_json::json!({
                "tool_calls": [{
                    "index": 0,
                    "function": {"name": "dir", "arguments": "mp\"}"}
                }]
            })),
            "data: [DONE]\n\n".to_string(),
        ]
        .join("")
    } else {
        [
            sse_chunk(serde_json::json!({"content": "Done."})),
            "data: [DONE]\n\n".to_string(),
        ]
        .join("")
    };

    let _ = write_http_response(&mut socket, 200, "text/event-stream", &sse_body).await;
}

async fn write_http_response(
    socket: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> std::io::Result<()> {
    let status_text = if status == 200 { "OK" } else { "ERROR" };
    let response = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        status,
        status_text,
        content_type,
        body.len(),
        body
    );
    socket.write_all(response.as_bytes()).await
}

fn sse_chunk(delta: serde_json::Value) -> String {
    let payload = serde_json::json!({
        "id": "chatcmpl-mock",
        "object": "chat.completion.chunk",
        "created": 1,
        "model": "mock-model",
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": null
        }]
    });

    format!("data: {}\n\n", payload)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
