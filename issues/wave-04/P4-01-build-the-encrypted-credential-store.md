# P4-01 Build the encrypted credential store

| Field | Value |
| --- | --- |
| Phase | 4 (`docs/phases/04-providers.md`) |
| Wave | 4 |
| Depends on | P1-05 |
| Difficulty | 4 of 5 |
| Area | backend |
| Parallel with its wave | yes |
| Needs a worktree | yes |
| Needs a human step | no |
| Branch | `yuki/p4-01-build-the-encrypted-credential-store` |

## Verification

`bun yuki verify credentials` passes: save a key, read back only the last four characters, disconnect, and see the row gone. `bun test apps/server/test/credentials.test.ts` passes a wrong-user decrypt failure and a key rotation.

## Task

**Goal.** Store provider credentials per user, encrypted, with `UserDO` as the only owner.

**Read first.** Architecture sections 11.1 and 11.2. `refs/pi/packages/ai/src/auth/types.ts`.

**Files.** Create `apps/server/src/user/credentials.ts`, `apps/server/src/lib/crypto.ts`, and tests.

**Build.**

- Derive the data key with HKDF-SHA256 from `CREDENTIALS_KEK` and the user id. Encrypt with AES-256-GCM, a random 12-byte IV, and `userId || providerId` as additional data.
- Store `kek_version` per row and support decrypting with an older secret during rotation.
- Implement pi-ai's `CredentialStore` over the table.
- RPC methods `connect(provider, apiKey)`, `disconnect(provider)`, and `listProviders()`, which returns provider id, kind, and last four characters.
- Never log a credential. Add a test that greps the log output of the suite for the test key.

**Done when.** No method returns a full credential to the Worker's HTTP layer.

## Rules for this task

- Read `AGENTS.md` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from `docs/phases/04-providers.md` by `bun scripts/plan.ts`. Edit the phase file, not this file.
