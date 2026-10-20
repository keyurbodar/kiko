# Owner architecture implementation status

Measured 2026-10-20. Release status: blocked. Do not merge or deploy this branch as a completed performance release.

## Architecture

The Worker resolves one owner name and one OwnerDO. User, room, agent, file and memory services share its SQLite database through explicit room/agent keys. Only OwnerDO owns the physical alarm and external transport. The durable ready queue admits one fully awaited agent invocation per physical alarm, with a 250 ms gap after settlement. Admissions remain optimistic and durable while another agent runs.

Actual Cloudflare Free probes showed that self-RPC and overlapping alarm invocations share the effective subrequest budget. Three serial alarms each completed 45 requests; three overlapping alarms failed. See [probe source and results](evidence/cloudflare-quota/README.md). Twenty simultaneous model runs are not implemented. A 40-admission preflight bounds instrumented network attempts, including retries and awaited after-run work. Opaque SDK internals remain a limitation.

Every successful public journal commit is durable before returning. No RAM-only commit acknowledgement remains. Future routine tasks survive atomic journal rollover and idempotent restore. Completed output is drained before closing the harness. The host waits on commit publications when tasks are blocked, avoiding an immediate idle-check loop.

## Measurements

| Measurement | Frozen production baseline | Current local observation |
| --- | --- | --- |
| Warm prompt SQL writes, median of five | 136 | 55 |
| Warm prompt total billed writes | Baseline meter incomplete | 59 |
| Quiet minute after a prompt | Historical idle alarm loop documented separately | 0 SQL/KV/alarm writes; no agent alarm armed |
| 90-day history workload | No equivalent baseline | 2,840 runs/day, two messages/run; 176,080 hot rows at days 30 and 89 |
| SQLite bytes in history-only load | Not measured | 1,170,997,248 at day 40; 1,218,273,280 at day 89 |

The SQL comparison is approximately 60% fewer writes. It is not a total billing comparison because the old meter omitted billed KV/alarm operations. The current eight-total-write gate remains unchanged and fails. At the observed cost, 2,840 daily prompts would exceed the Free daily write allowance. This branch does not claim to solve that target.

The history test preserves the original 90-day dataset and passed 64 assertions. It proves bounded hot messages, not flat total Owner storage. Memory turns, completed-run dedupe and other lifetime records retain growth. The physical schema has roughly 65 authored tables, not the proposed 15-table target. Archive backlog catch-up remains limited to one old day per current day.

## Verification and unresolved gates

Central verification ran each server test file once, with bounded concurrency. Only failed or source-invalidated checks were rerun. The initial source manifest and per-file logs are retained under the session cache. Runtime bugs found during verification were fixed before follow-up checks.

Verified passing after fixes: installer 41 tests including exact destructive-reset refusal; release-plan 9 tests; Owner dispatch 3 regressions; memory capture 6 tests; attachment 14 tests; query-plan and routine regressions; archive lifecycle cases and worker cases; model changes; 60-effect continuation across four invocations. Typechecks, imports, exports, rules and client build passed at their recorded revisions. Final rerun logs are included beside this report; they contain failures and must not be interpreted as an all-green run.

Still blocking release:

- The eight-total-write gate and the original simultaneous-agent target are unmet.
- Nine user tests still call removed projection RPCs or expect the retired user replay contract. They must be migrated to real room-state mutations and protocol 3 reset behavior, retaining their assertions.
- The agent long-transcript read gate observed 935 reads against a 263 bound after durable harness reopen. Do not raise the bound to hide this.
- The 10,000-message prefix latency test observed 17.4 ms against a 12 ms bound under the verification workload.
- Large user/room measurement fixtures encountered reset/timeouts during seeding. Their read budgets have not been proven after the shared-schema changes.
- Memory-context still timed out; lifecycle recovery retained a failing physical-alarm assertion after unrelated wakeup projection. The erase fixture now supplies its cancellation service; that narrow rerun is recorded separately.

Browser smoke validation used the real built client on localhost:8847: sign-in, provider setup skip, main chat, and settings rendered successfully. No live provider was configured in that isolated browser owner. This is not full end-to-end feature verification.

## Existing releases

Protocol 3 requires an explicit installer reset for legacy class deletion. The exact acknowledgement is `delete-existing-data`; missing or inexact acknowledgement is rejected before upload. The in-place updater refuses destructive plans. The signed manifest carries DO bindings, and the installer verifies signatures before using them. New releases use `latest-owner.json`; legacy `latest.json` and versioned artifacts remain frozen. First-release version guards fall back to the legacy index. Existing data cannot be restored by deploying an older binary after class deletion.

No new version has been released from this implementation. The draft must stay blocked until correctness and acceptance gates pass. The old main release remains v0.4.16.
