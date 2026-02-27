#![cfg(unix)]

use std::process::Stdio;
use std::time::Duration;

use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

#[tokio::test]
#[ignore = "process signal behavior is environment-sensitive; run explicitly"]
async fn process_exits_cleanly_on_sigint() {
    run_signal_case(Signal::SIGINT, "sigint").await;
}

#[tokio::test]
#[ignore = "process signal behavior is environment-sensitive; run explicitly"]
async fn process_exits_cleanly_on_sigterm() {
    run_signal_case(Signal::SIGTERM, "sigterm").await;
}

async fn run_signal_case(signal: Signal, expected_reason: &str) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_gateway_signal_harness"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn gateway signal harness");

    let stdout = child.stdout.take().expect("capture harness stdout");
    let stderr = child.stderr.take().expect("capture harness stderr");

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        let _ = reader.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).into_owned()
    });

    let mut stdout_reader = BufReader::new(stdout);
    let mut ready_line = String::new();
    let ready_read = timeout(
        Duration::from_secs(5),
        stdout_reader.read_line(&mut ready_line),
    )
    .await
    .expect("timed out waiting for harness ready line")
    .expect("read harness ready line");
    assert!(ready_read > 0, "harness stdout closed before ready line");
    assert!(
        ready_line.contains("gateway-signal-harness-ready"),
        "unexpected ready line: {ready_line}"
    );

    let pid = child.id().expect("child pid");
    kill(Pid::from_raw(pid as i32), signal).expect("send signal to harness process");

    let status = match timeout(Duration::from_secs(5), child.wait()).await {
        Ok(Ok(status)) => status,
        _ => {
            let _ = child.kill().await;
            panic!("harness did not exit cleanly after {signal:?}");
        }
    };
    assert!(
        status.success(),
        "harness exited with non-zero status after {signal:?}: {status}"
    );

    let stderr_output = timeout(Duration::from_secs(2), stderr_task)
        .await
        .expect("timed out waiting for harness stderr output")
        .expect("join harness stderr task");

    assert!(
        stderr_output.contains("Starting gateway adapter"),
        "missing adapter startup log in stderr:\n{stderr_output}"
    );
    assert!(
        stderr_output.contains("shutdown signal received; cancelling adapter tasks"),
        "missing shutdown log in stderr:\n{stderr_output}"
    );
    assert!(
        stderr_output.contains("gateway adapter task cancelled during shutdown"),
        "missing cancellation log in stderr:\n{stderr_output}"
    );
    assert!(
        stderr_output.contains(expected_reason),
        "missing shutdown reason `{expected_reason}` in stderr:\n{stderr_output}"
    );
}
