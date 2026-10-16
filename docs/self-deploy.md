# Self-deploy

Kiko runs on your own Cloudflare account. One deployment serves one owner. You sign in with an access code that you set.

## What you need

- A Cloudflare account on the Free plan.
- Bun.
- A model key from a provider you use, added in the app after sign-in.

## Steps

1. **Fork the repo** on GitHub, then clone your fork.

2. **Sign in to Cloudflare.**

   ```bash
   bunx wrangler login
   ```

3. **Optional: create the R2 bucket** for files. Skip it and Kiko keeps files in Durable Object storage: up to 100 MB a file and 800 MB a chat or drive. R2 on a Free account asks you to turn it on in the dashboard, possibly with a card. To use it, create the bucket (the name must match `bucket_name` in `apps/server/wrangler.jsonc`). To go without, delete the `r2_buckets` line from `apps/server/wrangler.jsonc`.

   ```bash
   bunx wrangler r2 bucket create kiko-files
   ```

   Pick one and keep it. Files saved without R2 are not copied to a bucket you add later.

4. **Install dependencies.**

   ```bash
   bun install
   ```

5. **Build the client.** The Worker serves `apps/web-solid/dist` as static assets, so build it first.

   ```bash
   bun run --cwd apps/web-solid build
   ```

6. **Deploy the Worker.** This forces `NODE_ENV=production`, so dev-only routes are left out of the bundle.

   ```bash
   bun run --cwd apps/server deploy
   ```

   Wrangler prints the URL of your Worker.

7. **Set the secrets.** Run each command in `apps/server`. Wrangler prompts for the value, so it stays out of your shell history.

   | Secret | What it is |
   | --- | --- |
   | `SESSION_SECRET` | Signs the session tokens. Use a long random string, 32 bytes or more. Changing it signs every device out. |
   | `CREDENTIALS_KEK` | Encrypts your provider keys in the owner's Durable Object. Use a long random string. Keep it: a new value cannot read the keys stored under the old one. |
   | `ACCESS_CODE` | The code you type on the sign-in screen. Make it long, at least 24 random characters, for example `openssl rand -hex 16`. The sign-in route has no attempt limit. |

   ```bash
   cd apps/server
   bunx wrangler secret put SESSION_SECRET
   bunx wrangler secret put CREDENTIALS_KEK
   bunx wrangler secret put ACCESS_CODE
   ```

   UNVERIFIED on this account: whether `wrangler secret put` accepts a secret before the first deploy. If it refuses, deploy once more after setting the secrets.

   `TRUSTED_ORIGINS` is optional. Set it to a comma-separated list of extra origins only if you serve the app from another hostname.

8. **Open the URL** that `wrangler` printed, enter the access code, and add a model key in Settings.

## Signing out

Sessions are signed bearer tokens that last 30 days, and the server stores none. Sign-out clears the token on the device you sign out on. Other devices stay signed in until `SESSION_SECRET` changes, which signs all of them out at once.

## Upgrading from before the single-owner change

Objects are now named for the owner id `owner`. An instance deployed before that change keeps its data under the old user ids, so it opens empty. Connect your Composio apps again.

## Local development

Keys for local runs go in `apps/server/.dev.vars`. `OPENCODE_API_KEY`, `CREDENTIALS_KEK`, and `SESSION_SECRET` are the names the example file lists. See `AGENTS.md` for the dev servers.

## Cost

The app runs on Cloudflare's Free plan. The Durable Object limits that bind first are per day:

- 100,000 rows written.
- 5,000,000 rows read.

One owner uses a small part of both. Architecture section 17 has the measured numbers.
