# Apps

You can build a live web app and put it on the internet for the human: a page, a dashboard, a tool with a database and sign-in, a multi-page site, or something that updates in real time. Apps run on Lakebed, a free host made for agents. Kiko builds them for you. There is no CLI, no npm, and nothing to install.

## Where an app lives

One app is one folder: `/home/apps/<name>/`. The name is 3 to 40 lowercase letters, digits, or dashes, and it is the app's id in every tool. Write the files with `write` and `edit` like any other file.

| Path | What it is |
| --- | --- |
| server/index.ts | `export default capsule({ name, schema, queries, mutations, actions, endpoints, auth?, favicon? })` |
| server/*.ts | More server code, imported relatively |
| client/index.tsx | `export function App()`, in Preact with Tailwind classes |
| client/*.tsx | More components and pages |
| shared/*.ts | Pure TypeScript both sides import. No DOM, env, or Lakebed imports |
| favicon.svg | Optional icon |

Kiko adds `server/kiko.ts` when it builds. Never write that file.

## The tools

- `app_deploy {name, public_inspect?, delete_tables?}` builds the folder and deploys it. It returns the url, or the build errors with file and line. Fix them and deploy again. Unchanged source does nothing. When a schema change drops a table, Lakebed refuses until you pass `delete_tables: [{table, row_count}]` with the exact row count from `app_inspect tables`. Ask the human before you drop data.
- `app_list` lists your apps, and every deploy on the human's Lakebed account.
- `app_inspect {name, what}`: `logs` for server logs and errors, `tables`, `db` for every row, `manifest` for the app's queries, mutations, endpoints and tools (add `query` to run one), `usage` against the limits, `storage` for uploaded files (`prefix`), and `export` for one page of a table backup (`table`, then `cursor`). `save_to` writes the whole answer to a file.
- `app_call {name, method, path, body | body_file, save_to?}` sends a request to the app, signed as Kiko.
- `app_manage {name, action}` does everything else: `env_list`, `env_set {key, value}`, `env_unset {key}`, `domain_add`, `domain_status`, `domain_remove {hostname}`, `domain_list`, `users_list`, `user_approve`, `user_deny`, `user_remove {subject}`, `storage_get {key, save_to?}`, `storage_delete {key}`, `archive`, `restore`, `terminate`, `claim_link`, and `forget`.
- `lakebed_account {action: connect | status | disconnect}` links the human's Lakebed account.

## Owned and anonymous apps

Without a Lakebed account, an app is anonymous. It expires in about a week, and its server code cannot `fetch` other sites or read `ctx.env`.

With the account connected, every new app is owned. It never expires, it can `fetch`, and `env_set` gives it secrets as `ctx.env.KEY` from the next deploy. Domains, archive, restore, terminate, and storage deletes need the account.

When `app_deploy` makes an anonymous app, it returns a claim link and a code. Send them to the human with the app url, and say plainly: one click keeps this app forever, and every app after it is theirs automatically. Then make the one-time reminder routine the deploy result describes. The human can also connect or claim from Settings, Web apps.

Other ways to connect:
- `lakebed_account connect` returns a link and a code. Give both to the human, then check with `lakebed_account status`.
- `app_manage claim_link` gets a fresh claim link for an anonymous app.

If an anonymous app's code uses `fetch` or env, `app_deploy` puts up a "claim required" page and tells you to get the claim link. A claim link is a key to the app. Give it only to the human.

## Rules the build enforces

- Import only `lakebed/server` in `server/`. In `client/`, import only `lakebed/client`, `preact`, `preact/hooks`, and relative files. No npm packages and no Node built-ins.
- Never write `globalThis`, `eval`, or `new Function`.
- Fields are `string()`, `number()`, `boolean()`, `id("table")`, and `userId()`, each with an optional `.optional()` or `.default(v)`. Store times as epoch ms in `number()`. Declare indexes with `table({...}).index("by_x", ["x"])`.
- To read, call `ctx.db.t.get(id)`, or `ctx.db.t.withIndex("by_x", (q) => q.eq("x", v))`, then one of `.order("asc"|"desc")`, `.first()`, `.take(n)`, `.collect()`, `.count()`, or `.paginate({...})`. `take` and `order` only exist after `withIndex`. Every table has `withIndex("by_creation")`. Await every call. `where`, `orderBy`, `limit`, and `all` do not exist.
- To write, call `ctx.db.t.insert(row)`, `.update(id, patch)`, or `.delete(id)`. Only mutations and endpoints write. Queries and actions only read.
- Queries are live. `client.useQuery("name", args?)` re-renders when the data changes, and returns `undefined` until it loads. Other hooks are `useMutation`, `useAction`, and `usePaginatedQuery`. Get a typed client with `import type app from "../server/index"` and `createClient<typeof app>()`.
- For pages, use `Router`, `Routes`, `Route`, `Link`, `navigate`, `useParams`, and `useLocation` from `lakebed/client`. One app can have many pages.
- For sign-in, every visitor gets a guest session. Use `ctx.auth.requireIdentity()` for their own data and `ctx.auth.requireSignedIn()` for account-only actions. Store owners with `userId()`. Add `SignInWithGoogle` from `lakebed/client`. Set `auth: { requireSignIn: true }` to lock the whole app.
- For uploads, use `storage.upload(file, { public? })`, `storage.url`, and `storage.delete` from `lakebed/client`.
- Use whole Tailwind class names. Arbitrary values like `bg-[#0b0b0f]` work. Use inline styles for values computed at runtime. Do not write CSS files.
- `endpoint({ method: "POST", path: "/ingest" }, async (ctx, req) => ...)` handles outside HTTP. `req` has `headers.get`, `query`, `json()`, `text()`, and `bytes()`. Return `json(value)` or `text(s, { status })`.
- Pass `{ tool: { description, args } }` as the second argument of a query, mutation, or action to make it a WebMCP tool for browser agents.

## Getting data in

Your `bash` has `curl` (https only), `jq`, `html-to-markdown`, `rg`, `awk`, and `sed`. Fetch, filter, and shape data in one command, and write the result to a file under `/home`. `/tmp` is cleared after each command. The data never has to pass through you:

```sh
mkdir -p /home/data
curl -s https://hacker-news.firebaseio.com/v0/showstories.json | jq '.[:30]' > /home/data/ids.json
curl -s https://example.com/launches | html-to-markdown > /home/data/launches.md
```

To push data into an app, give it a POST endpoint that checks Kiko:

```ts
import { isKiko } from "./kiko"

ingest: endpoint({ method: "POST", path: "/ingest" }, async (ctx, req) => {
  if (!(await isKiko(req))) return text("unauthorized", { status: 401 })
  const body = await req.json<{ items: Item[] }>()
  for (const item of body.items.slice(0, 50)) await ctx.db.items.insert(item)
  return json({ ok: true })
}),
```

Then send the file. A `curl` to your own app's url is signed as Kiko automatically:

```sh
curl -s -X POST https://<app-url>/ingest -H 'content-type: application/json' -d @/home/data/items.json
```

`app_call {name, method: "POST", path: "/ingest", body_file: "/home/data/items.json"}` does the same. Check the result with `app_inspect db`.

An owned app can fetch on its own, with keys from `env_set`. Prefer that when the human's key belongs to the app.

For "update every 3 hours", make a routine for yourself that runs the fetch and the push. Routines run at most every 30 minutes. Send at most 50 rows per request, and delete old rows in the same endpoint so the app stays small.

## Limits

Each app gets 10,000 requests and 1,000 writes a day, 1 MB of data, 16,384 rows, and 5 seconds per request. One `bash` fetch is capped at 10 MB. A step gets about 30 fetches. When curl says the step used its share, finish the step and run the rest of the fetches in your next command: the run continues with a fresh budget. Prefer list endpoints that return many items in one call.

## Check your work

app_deploy reports whether the url answers, so do not poll it. When something looks wrong, read `app_inspect logs` for errors, and read `app_inspect db` after you push data. A worker can open the page with `browse`. Report the url, what you checked, and the expiry if the app is anonymous.
