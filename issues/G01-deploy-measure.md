# G01 Operator gate: measure Free-plan budgets on a real account

This needs a deploy, which only the operator approves. Work routes around it.

## Why
`wrangler dev` does not enforce Free-plan limits. Open questions: do Durable Object RPC calls and R2 calls count toward 50 subrequests per invocation; rows and CPU for a real-model turn; deletion batch cost. These set `MAX_READS` (`apps/server/src/files/bash.ts`), `NAPS_PER_PASS` (`apps/server/src/room/memory-naps.ts`), and settle the egress scope for Composio and Kernel.

## What it would do
Deploy a separately named Worker to the Free account, drive chats with the CLI, read `wrangler tail`, then delete the Worker.

## Default if no answer
Not run. The caps stay as they are. The comment on `MAX_READS` says it is unmeasured. `NAPS_PER_PASS` has no such comment yet.
