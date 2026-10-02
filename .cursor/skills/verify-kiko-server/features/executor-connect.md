# executor-connect

Proves a user can connect an Executor Cloud account, list its tools, refresh the token, and disconnect with every row gone. It needs a human to sign in to Executor once per run.

## Without an account

```bash
bun kiko verify executor-connect --url http://localhost:8787
```

This registers kiko with Executor's sign-in server, checks the authorize URL (PKCE S256, `offline_access`, this server's callback), and checks that Executor answers it with its sign-in page. It then fails with "waiting on a human" and prints the steps below. That failure is expected without an account.

## With the test account

The human needs an Executor Cloud account. Create one at https://executor.sh. Do it once.

1. Start the Worker with `NODE_ENV=development bunx wrangler dev --port 8787`. Keep it running for the whole check.
2. Run `KIKO_EXECUTOR_WAIT=300 bun kiko verify executor-connect --url http://localhost:8787`.
3. In one browser, open the first URL it prints, `http://localhost:8787/api/auth/dev/session?name=executor-alice`. This signs the browser in to kiko as the same dev user the suite uses. The callback needs that session.
4. In the same browser, open the second URL it prints, the `https://signin.executor.sh/oauth2/authorize?...` link.
5. Sign in to Executor and approve kiko on the consent screen.
6. The browser lands on `/api/integrations/executor/callback` and shows "executor is connected". The suite goes on by itself.

Pass: `pass executor-connect`, with `tools:` and `token lifetime:` lines on stderr. The suite disconnects at the end, so every run needs steps 3 to 5 again.

Fail: "executor gave no refresh token" means `offline_access` did not produce a refresh token. "executor refused the sign-in" on the callback page means the consent step rejected the dynamically registered client. Then use the API key fallback and record it in `docs/research/experiment-8-executor-oauth.md`.
