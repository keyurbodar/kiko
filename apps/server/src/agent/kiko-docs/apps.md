# Apps

You can build a live web app and put it on the internet for the human: a static page, a dashboard, a tool with a database, or something that updates in real time. Apps run on Lakebed, a free host made for agents. Kiko builds them for you; there is no CLI, no npm, and no account to set up.

## Where an app lives

One app is one folder: `/home/apps/<name>/`. The name is 3 to 40 lowercase letters, digits, or dashes, and it is also the app's id in every tool. Write the files with `write` and `edit` like any other file. The folder is the whole app:

| Path | What it is |
| --- | --- |
| server/index.ts | `export default capsule({ name, schema, queries, mutations, actions, endpoints })` |
| client/index.tsx | `export function App()`, in Preact with Tailwind classes |
| shared/*.ts | Pure TypeScript both sides import |
| favicon.svg | Optional icon |

Kiko adds `server/kiko.ts` when it builds. Never write that file.

## The tools

- `app_deploy {name}` builds the folder and deploys it. It returns the url, or the build errors with file and line. Fix them and deploy again. Deploying unchanged source does nothing.
- `app_list` lists the apps with their urls.
- `app_logs {name}` reads the server logs and errors of the live app.
- `app_db {name}` reads its tables and rows.
- `app_call {name, method, path, body?}` sends a request to the app, signed as Kiko.
- `app_claim_link {name}` gives the link the human opens to keep the app. Give it to the human, never post it elsewhere.

## Rules the build enforces

- Import only `lakebed/server` in `server/`, and only `lakebed/client`, `preact`, and `preact/hooks` in `client/`, plus relative files. No npm packages and no Node built-ins.
- Never write `globalThis`, `eval`, or `new Function`.
- Fields: `string()`, `number()`, `boolean()`, `id("table")`, `userId()`, each with `.optional()` or `.default(v)`. Declare an index with `.index("by_x", ["x"])` and read with `ctx.db.t.withIndex("by_x", (q) => q.eq("x", v))`, then `.order("desc")`, `.first()`, `.take(n)`, or `.collect()`. Await every database call.
- Queries and actions only read. Write in mutations and endpoints.
- Queries are live: `client.useQuery("name")` re-renders when the data changes, and returns `undefined` until it loads. Get a typed client with `import type app from "../server/index"` and `createClient<typeof app>()`.
- Pages use `Router`, `Routes`, `Route`, `Link`, and `useParams` from `lakebed/client`.
- Use whole Tailwind class names. Arbitrary values like `bg-[#0b0b0f]` work. No CSS files.
- `endpoint({ method: "POST", path: "/ingest" }, async (ctx, req) => ...)` handles outside HTTP. Return `json(value)` or `text(s, { status })`.
- Pass `{ tool: { description } }` as a query's second argument to make it a tool for browser agents (WebMCP).

## Feeding an app data

A new app cannot fetch other sites or hold secrets until the human claims it. You can, so you fetch and the app stores. That keeps the human's keys in Kiko.

1. Give the app a POST endpoint that checks Kiko and writes rows:

```ts
import { isKiko } from "./kiko"

ingest: endpoint({ method: "POST", path: "/ingest" }, async (ctx, req) => {
  if (!(await isKiko(req))) return text("unauthorized", { status: 401 })
  const body = await req.json<{ items: Item[] }>()
  for (const item of body.items.slice(0, 50)) await ctx.db.items.insert(item)
  return json({ ok: true })
}),
```

2. Deploy it, and fetch, rank, and sort the data with your own tools and the human's connected apps.
3. Push it with `app_call {name, method: "POST", path: "/ingest", body}`, then check it with `app_db`.
4. For "update every 3 hours", make a routine for yourself that does steps 2 and 3. Routines run at most every 30 minutes.

Send at most 50 rows per call, and drop old rows in the same endpoint so the app stays small.

## Limits

Each app gets 10,000 requests and 1,000 writes a day, 1 MB of data, and 5 seconds per request. A new app expires in about a week. Tell the human the expiry and offer the claim link. A claimed app never expires, and its code can use `fetch` and `ctx.env`.

## Check your work

After a deploy, open the url with `browse` to see the page, read `app_logs` for errors, and read `app_db` after you push data. Report the url and what you checked.
