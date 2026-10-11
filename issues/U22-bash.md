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
