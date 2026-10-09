import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { CliError, type Context } from "../main"

// The CLI keeps one cookie header per server origin in a JSON file.
// YUKI_SESSION_FILE moves it, so tests never touch the real one.
type Sessions = Record<string, string>

export function sessionFile(): string {
  return process.env.YUKI_SESSION_FILE ?? join(homedir(), ".config", "yuki", "cli-session.json")
}

async function readSessions(): Promise<Sessions> {
  try {
    return JSON.parse(await readFile(sessionFile(), "utf8")) as Sessions
  } catch {
    return {}
  }
}

/** The stored cookie header for a server, or null. Other commands send it to act as the user. */
export async function sessionCookie(url: string): Promise<string | null> {
  return (await readSessions())[new URL(url).origin] ?? null
}

async function saveCookie(url: string, cookie: string): Promise<void> {
  const sessions = await readSessions()
  sessions[new URL(url).origin] = cookie
  const file = sessionFile()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 })
}

function endpoint(ctx: Context, path: string): URL {
  return new URL(path, ctx.url.endsWith("/") ? ctx.url : `${ctx.url}/`)
}

async function request(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })
  } catch (e) {
    throw new CliError(`cannot reach ${url.origin} (${e instanceof Error ? e.message : e})`)
  }
}

/** `yuki login --dev [--name <name>]` signs in as a test user through the dev-only route. */
export async function login(ctx: Context): Promise<void> {
  if (!ctx.dev) throw new CliError("only `yuki login --dev` exists. sign in with google or github in the browser")
  const url = endpoint(ctx, "api/auth/dev/session")
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: ctx.name }),
  })
  if (res.status === 404) throw new CliError(`login failed: ${url.origin} has no dev sign-in route`)
  if (!res.ok) throw new CliError(`login failed: ${url} returned ${res.status} ${await res.text()}`)
  const cookie = res.headers
    .getSetCookie()
    .map((line) => line.split(";", 1)[0] ?? "")
    .join("; ")
  if (!cookie) throw new CliError("login failed: the server set no cookie")
  const { user } = (await res.json()) as { user: { id: string } }
  await saveCookie(ctx.url, cookie)
  console.log(ctx.json ? JSON.stringify({ id: user.id }) : user.id)
}

/** `yuki whoami` prints the signed-in user id for the server. */
export async function whoami(ctx: Context): Promise<void> {
  const cookie = await sessionCookie(ctx.url)
  if (!cookie) throw new CliError(`not signed in to ${new URL(ctx.url).origin}. run yuki login --dev`)
  const url = endpoint(ctx, "api/me")
  const res = await request(url, { headers: { cookie } })
  if (res.status === 401) throw new CliError("the stored session is not valid. run yuki login --dev")
  if (!res.ok) throw new CliError(`whoami failed: ${url} returned ${res.status}`)
  const { user } = (await res.json()) as { user: { id: string; name: string; email: string } }
  console.log(ctx.json ? JSON.stringify(user) : user.id)
}
