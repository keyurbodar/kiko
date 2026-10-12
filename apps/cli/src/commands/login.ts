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

export async function login(ctx: Context): Promise<void> {
  // A deployed Worker has the access code and no dev route. A local one has the dev route.
  const code = process.env.YUKI_ACCESS_CODE
  if (!ctx.dev && !code) throw new CliError("set YUKI_ACCESS_CODE to sign in to a deployed server, or pass --dev for a local one")
  const url = endpoint(ctx, ctx.dev ? "api/auth/dev/session" : "api/auth/access-code")
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ctx.dev ? { name: ctx.name } : { code }),
  })
  if (res.status === 404) throw new CliError(`login failed: ${url.origin} has no such sign-in route`)
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

export async function whoami(ctx: Context): Promise<void> {
  const cookie = await sessionCookie(ctx.url)
  if (!cookie) throw new CliError(`not signed in to ${new URL(ctx.url).origin}. run yuki login`)
  const url = endpoint(ctx, "api/me")
  const res = await request(url, { headers: { cookie } })
  if (res.status === 401) throw new CliError("the stored session is not valid. run yuki login --dev")
  if (!res.ok) throw new CliError(`whoami failed: ${url} returned ${res.status}`)
  const { user } = (await res.json()) as { user: { id: string; name: string } }
  console.log(ctx.json ? JSON.stringify(user) : user.id)
}
