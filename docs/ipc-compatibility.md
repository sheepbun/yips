# IPC Compatibility Notes

## Cancel Events Contract

Cancel outcomes are represented by typed IPC events:

- `DaemonMessage::CancelResult`
  - `outcome`: `CancelledActiveTurn` or `NoActiveTurn`
  - `origin`: `UserRequest` or `SupersededByNewChat`

`CancelResult` is the canonical and exclusive cancel contract.

## Legacy Cancel Compatibility Status

- Legacy cancel `DaemonMessage::Error` emissions were removed in N+2+.
- The daemon no longer supports `emit_legacy_cancel_errors`.
- In-workspace clients (`yips-cli`, `yips-tui`) are typed-cancel only.
