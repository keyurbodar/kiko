# account

Covers account deletion, saved model keys, the bring-your-own-key gate, and provider sign-in.

Suites: `account-delete`, `credentials`, `byok`, `provider-login`. Flags: `byok` sets `model: true`. `provider-login` needs `--fake` for its sign-in cases. None sets `human: true`.

## Sub-features

- **Account deletion.** `POST /api/account/delete` needs the typed phrase `delete my account` and a session under 10 minutes old. The user is marked deleting, rooms and agents become jobs, and data is wiped. If the enqueue fails, the mark is rolled back and the user is restored.
- **Saved keys.** One API key per provider, sealed in the user's Durable Object. Reads return metadata only: provider id, kind, last four characters.
- **BYOK gate.** A user with no connected provider gets a `no_provider` event and no agent run. After a disconnect, the next message is refused the same way.
- **Provider sign-in.** Login frames run over the user socket: `login.start`, `login.answer`, `login.cancel`. The test provider `yuki-fake` exists only in development.

## How to get to it (user POV)

1. Save an API key for a provider. The app shows only the last four characters.
2. Start a sign-in for a provider that offers one. Enter the code it shows.
3. To delete the account, type `delete my account`. If the session is older than 10 minutes, sign in again first.
4. After deletion, the session cookie is cleared, old sockets close, and rooms, files, and the user row are removed.

## Driving it with the yuki CLI

```bash
bun yuki verify account-delete --url http://localhost:8787
bun yuki verify credentials --url http://localhost:8787
bun yuki verify provider-login --fake --url http://localhost:8787
bun yuki verify byok --url http://localhost:8787
```

- `account-delete`: 400 without the phrase, 202 with `{rooms: 4}`, old cookie gets 401, residue gone within 30 s, a second run reports nothing.
- `credentials`: 401 anonymous, 403 foreign origin, save returns metadata only, another user sees none, bad id 400, disconnect `{removed: true}`.
- `byok`: needs `OPENCODE_API_KEY` in the shell. No provider gets `no_provider` with slug `yuki`, a connected user gets an answer, a disconnected user is refused.
- `provider-login`: without `--fake`, only the `openrouter` refusal and unknown cancel run. With `--fake`: device code `YUKI-0000`, a wrong code fails, cancel works, a reconnect restarts the login.

## Gotchas

- Residue checks use `/api/dev/account/...` routes. They return 404 outside development.
- The freshness check runs before the phrase check. A stale session gets 403 with `reauth` even when the phrase is right.
- Deletion jobs never give up. A dead letter is requeued, with no alert. A deletion that always fails retries forever.
- Keys never leave the server. `credentials` fails if a response contains the full key.
- Subscription sign-ins need `PROVIDER_OAUTH=on`. Logins time out after 10 minutes, and at most 4 run at once.
