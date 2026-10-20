# kiko

A self-deployed AI chat app on Cloudflare Workers with a SolidJS client. Read `ARCHITECTURE.md` for how it fits together.

## Run

```bash
bun install
bun dev:server   # localhost:8787
bun dev:web      # localhost:5173
```

Model keys for local runs go in `apps/server/.dev.vars`. Use your own port if another dev server is running.

## Check

```bash
bun run check                                                # typecheck, lint, import layering
bun kiko verify journal-overhead --url http://localhost:8787  # the e2e
```

## Rules

- No unit or integration tests, and no mocks. Test the real app end to end.
- No comments in code. Explanations go in `ARCHITECTURE.md`.
- Keep functions under the lint's complexity limit. The pre-commit hook runs it.
- Never commit secrets.
- Commit only code. No docs, plans, notes or reports.
