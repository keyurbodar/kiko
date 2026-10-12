# account

Covers saved model keys, the bring-your-own-key gate, and provider sign-in.

Suites: `credentials`, `byok`, `provider-login`. Flags: `byok` sets `model: true`. `provider-login` needs `--fake` for its sign-in cases. None sets `human: true`.

## Sub-features

- **Saved keys.** One API key per provider, sealed in the user's Durable Object. Reads return metadata only: provider id, kind, last four characters.
- **BYOK gate.** A user with no connected provider gets a `no_provider` event and no agent run. After a disconnect, the next message is refused the same way.
- **Provider sign-in.** Login frames run over the user socket: `login.start`, `login.answer`, `login.cancel`. The test provider `yuki-fake` exists only in development.

## How to get to it (user POV)

1. Save an API key for a provider. The app shows only the last four characters.
2. Start a sign-in for a provider that offers one. Enter the code it shows.

## Driving it with the yuki CLI

```bash
bun yuki verify credentials --url http://localhost:8787
bun yuki verify provider-login --fake --url http://localhost:8787
bun yuki verify byok --url http://localhost:8787
```

- `credentials`: 401 anonymous, 403 foreign origin, save returns metadata only, another user sees none, bad id 400, disconnect `{removed: true}`.
- `byok`: needs `OPENCODE_API_KEY` in the shell. No provider gets `no_provider` with slug `yuki`, a connected user gets an answer, a disconnected user is refused.
- `provider-login`: without `--fake`, only the `openrouter` refusal and unknown cancel run. With `--fake`: device code `YUKI-0000`, a wrong code fails, cancel works, a reconnect restarts the login.

## Gotchas

- Keys never leave the server. `credentials` fails if a response contains the full key.
- At most 4 sign-ins run at once (`MAX_LOGINS` in `provider-login.ts`). A fifth is refused with "too many sign-ins are running".
