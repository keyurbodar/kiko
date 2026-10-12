# Simplification audit (read-only)

Decision (owner, 2026-10-12): yuki becomes single-owner. Each person self-deploys their own Worker, so there is exactly one user per deployment. Every feature stays (extensions, Kernel browser, initiative, memory, teams, routines, Composio, files, bash). The goal is to delete complexity, not features: YAGNI and a leaner design.

Already decided for removal (do not re-list these, but do list code in your area that exists only because of them): accounts, sign-in libraries, D1, Queues, account deletion and wipe safety marks, per-user Durable Object naming, daily reply limits and held messages, the autonomous-run budget with refunds and held wakes, the key encryption layer (master key, keyring, rotation).

## Your job
Read-only. Do not edit, commit, run builds, tests or servers. Read the code in your area and list what can be deleted or collapsed while the feature behaves the same for its one owner:
- dead code: exports nobody calls, branches no caller reaches, fields never read;
- two code paths doing one job; wrappers or abstractions with one caller; options or flags nobody sets;
- guards for states that cannot happen, defensive retries with no failure mode, over-general data shapes;
- code that exists only for the removed multi-user, limits or budget design;
- Durable Object reads or writes the feature does not need (a row written every time with the same value, a scan, an alarm pass that does nothing for one owner, a table that grows forever).

For each item give: file:line range, what to delete or collapse, the non-blank lines saved (count them), the behavior kept, and the risk (low/medium). Rank by lines saved. End with your total and the 3 cuts with the best ratio of lines saved to risk.
