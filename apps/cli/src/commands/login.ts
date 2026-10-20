import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { CliError, type Context } from "../main"

type Sessions = Record<string, string>

export function sessionFile(): string {
  return process.env.KIKO_SESSION_FILE ?? join(homedir(), ".config", "kiko", "cli-session.json")
}

async function readSessions(): Promise<Sessions> {
  try {
    return JSON.parse(await readFile(sessionFile(), "utf8")) as Sessions
  } catch {
    return {}
  }
}

export async function sessionToken(url: string): Promise<string | null> {
  return (await readSessions())[new URL(url).origin] ?? null
}

async function saveToken(url: string, token: string): Promise<void> {
  const sessions = await readSessions()
  sessions[new URL(url).origin] = token
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
  const code = process.env.KIKO_ACCESS_CODE
  if (!ctx.dev && !code) throw new CliError("set KIKO_ACCESS_CODE to sign in to a deployed server, or pass --dev for a local one")
  const url = endpoint(ctx, ctx.dev ? "api/auth/dev/session" : "api/auth/access-code")
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ctx.dev ? { name: ctx.name } : { code }),
  })
  if (res.status === 404) throw new CliError(`login failed: ${url.origin} has no such sign-in route`)
  if (!res.ok) throw new CliError(`login failed: ${url} returned ${res.status} ${await res.text()}`)
  const { user, token } = (await res.json()) as { user: { id: string }; token: string }
  await saveToken(ctx.url, token)
  console.log(ctx.json ? JSON.stringify({ id: user.id }) : user.id)
}

export async function whoami(ctx: Context): Promise<void> {
  const token = await sessionToken(ctx.url)
  if (!token) throw new CliError(`not signed in to ${new URL(ctx.url).origin}. run kiko login`)
  const url = endpoint(ctx, "api/me")
  const res = await request(url, { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new CliError("the stored session is not valid. run kiko login --dev")
  if (!res.ok) throw new CliError(`whoami failed: ${url} returned ${res.status}`)
  const { user } = (await res.json()) as { user: { id: string; name: string } }
  console.log(ctx.json ? JSON.stringify(user) : user.id)
}
