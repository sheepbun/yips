# IPC Client Inventory and Signoff

## Purpose

Track all IPC clients that consume daemon messages so compatibility-breaking
changes can be removed safely.

## In-Workspace Clients

- `crates/yips-cli`: consumes `DaemonMessage::CancelResult`
- `crates/yips-tui`: consumes `DaemonMessage::CancelResult`
- `crates/yips-gateway`: currently placeholder, no daemon IPC consumer implemented

## Out-of-Tree Clients

No out-of-tree IPC clients are confirmed as of 2026-02-27.

Verification basis:
- Repository scan for daemon IPC consumers and cancel message handling paths.
- Maintainer review of known downstream integrations.

When external consumers are identified, record them here:

| Client | Repo/Location | Maintainer Contact | CancelResult Support | Signoff Status | Last Verified |
| --- | --- | --- | --- | --- | --- |
| _None confirmed_ | _N/A_ | _N/A_ | _N/A_ | _N/A_ | 2026-02-27 |

## Signoff Checklist for Legacy Cancel Removal

- [x] In-workspace clients verified against typed cancel flow.
- [x] External client inventory reviewed and updated.
- [x] Maintainer signoff captured below.

### Maintainer Signoff

- Owner: Katherine
- Date: 2026-02-27
- Decision: Approved staged migration and completed hard removal in N+2+; legacy cancel compatibility paths have been removed.
