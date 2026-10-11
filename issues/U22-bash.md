# U22 Bash is honest about writes that span spaces

**Model** Sonnet 5.5 medium. **Wave** 1. **Depends on** nothing. **Timebox** 75 min.

## Goal
A bash command either commits fully or says exactly what happened.

## Context
`apps/server/src/files/room-fs.ts:627-630` (`withMount`) commits chat files, then the drive in UserDO; `698-701` (`withSoul`) commits the rest, then `soul.set`. If the second commit is refused, the first already landed, but `bash.ts:382-386` reports that nothing was saved and the tool text (`apps/server/src/agent/extensions/files.ts:201`) promises one transaction. The simplest honest fix is to refuse a command whose changes touch more than one space, with a clear message, before committing anything. Check how often real commands span spaces (`cp /chat/x /home/y` is plausible). If refusing would break a normal workflow, instead commit per space and report per space exactly. Decide from evidence and say why.

Also `bash.ts:13-14` claims Free allows 1,000 subrequests and sets `MAX_READS=400`; AGENTS.md says 50. Do not change the number (U-measure will). Make the comment state the open question honestly.

## Scope
`apps/server/src/files/room-fs.ts`, `apps/server/src/files/bash.ts`, `apps/server/src/agent/extensions/files.ts`, `apps/server/test/bash.test.ts`, `room-fs.test.ts`.

## Acceptance
A test where the second space refuses: today it reports a false "nothing saved"; after, the outcome is atomic or exactly reported.

## Report

**Decision: per space, not refusal.** Evidence: `apps/server/test/bash.test.ts` already asserts that `echo chat > /c.txt; echo drive > /home/both.txt` saves both (the test "changes to the chat's files and the drive in one command both save"). The agent prompt (`agent/prompt.ts`, FILES) also names `/home` as a normal write target. Refusing multi-space commands would break that workflow, so the brief's fallback applies: each space commits on its own and the output reports each one. I could not measure real usage frequency (no telemetry in the repo), so the choice rests on the tested workflow, not on counts.

**Reproduced.** Before the fix, `bash.test.ts` "when the drive refuses a command's write, the output says the chat's files did save" failed:

```
Expected to contain: "saved in the chat's files"
Received: "bash: /home/d.txt: not saved: /home/d.txt changed after this command started (a teammate or the human wrote it). nothing this command changed in the drive (/home) was saved. look again, then run it again\nCommand exited with code 1"
```

The chat's `/a.txt` had saved, but the output never said so.

**What changed.** `CommandFs.commit` groups the planned changes by space (chat, home, me) and commits each group through `RoomFs.commit`. It returns the saved spaces and the refused ones. `runCommand` prints one `not saved` line per refused space, and when some saved and some did not, a `saved in ...` line. Exit code is 1 when anything was refused. The tool text now says a command saves per space and names the spaces that saved. A single-space conflict keeps its old message, so the existing conflict test still passes.

**Side effects to know about.**
- `withSoul` used to refuse the whole batch when any `/me` path other than `soul.md` was touched. Now only the `me` group is refused; chat and home changes in the same command save. This matches the per-space rule.
- Commit order is chat, then home, then me, which matches the order `architecture.md` section 18 already describes.

**MAX_READS.** The number stays at 400. The comment now says UNVERIFIED and names the open question, per AGENTS.md. `architecture.md` (around line 1076) still says "a Free invocation may make 1,000 calls" without a label. I did not change it because it is outside this unit's scope.

## Discoveries

- `docs/architecture.md` section 18 (the "A command is a transaction" block) already documents per-space atomicity and the `saved` line in its own words. The code was the part that lagged. No doc change was needed for this unit.
- `architecture.md` around line 1076 states the 1,000-call Free budget as fact. That contradicts AGENTS.md (50). It should carry the UNVERIFIED label until the U-measure unit settles it.
- The bash verify suite (`apps/cli/src/verify/suites/bash.ts`) was not run. It is outside SCOPE, and the behavior change only touches multi-space refusals, which that suite does not appear to cover.
