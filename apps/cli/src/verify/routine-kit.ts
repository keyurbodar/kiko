import type { Message, RoomToClient } from "@kiko/protocol"
import { type RoomHandle, type Session, VerifyError } from "./client"

// Shared by the routine suites (architecture section 25): the human's HTTP calls, the dev routes, and
// what the room's socket saw.

export type Routine = { id: string; name: string | null; status: string; createdBy: string; target: string; grant: string[]; fails: number; dueUtc: number; trigger: { on: string } | null; roomId: string; tainted: boolean }
export type Run = { routineId: string; occurrence: string; status: string; seq: number | null; startedAt: number }

const base = (url: string) => (url.endsWith("/") ? url : `${url}/`)

export async function api<T>(url: string, s: Session, path: string, body?: unknown, method?: string): Promise<{ status: number; json: T }> {
  const res = await fetch(new URL(`api/${path}`, base(url)), {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { cookie: s.cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: res.status, json: json as T }
}

export async function ok<T>(url: string, s: Session, path: string, body?: unknown): Promise<T> {
  const out = await api<T>(url, s, path, body)
  if (out.status >= 400) throw new VerifyError(`${path} answered ${out.status}: ${JSON.stringify(out.json)}`)
  return out.json
}

export const dev = (url: string, s: Session, action: string, body: unknown) => ok<unknown>(url, s, `dev/agent/${action}`, body)

export async function routines(url: string, s: Session): Promise<{ routines: Routine[]; runs: Run[] }> {
  return ok(url, s, "routines")
}

export async function runsOf(url: string, s: Session, id: string): Promise<Run[]> {
  return (await routines(url, s)).runs.filter((r) => r.routineId === id)
}

/** Polls until `test` holds for the routine's runs. Returns them. */
export async function waitRuns(url: string, s: Session, id: string, what: string, test: (runs: Run[]) => boolean, ms = 30_000): Promise<Run[]> {
  const end = Date.now() + ms
  for (;;) {
    const runs = await runsOf(url, s, id)
    if (test(runs)) return runs
    if (Date.now() > end) throw new VerifyError(`timed out waiting for ${what}. runs: ${JSON.stringify(runs)}`)
    await Bun.sleep(300)
  }
}

export async function waitRoutine(url: string, s: Session, test: (r: Routine[]) => Routine | undefined, what: string, ms = 30_000): Promise<Routine> {
  const end = Date.now() + ms
  for (;;) {
    const found = test((await routines(url, s)).routines)
    if (found) return found
    if (Date.now() > end) throw new VerifyError(`timed out waiting for ${what}`)
    await Bun.sleep(300)
  }
}

/** Every message the room socket saw, any sender, oldest first. */
export function messages(room: RoomHandle): Message[] {
  const out = new Map<string, Message>()
  for (const entry of room.raw.log) {
    if (entry.dir !== "in") continue
    const f = entry.frame as RoomToClient
    if (f.t !== "events") continue
    for (const e of f.events) if (e.t === "message") out.set(e.id, e)
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq)
}

export const agentTexts = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "agent").map((m) => m.text)
export const systemTexts = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "system").map((m) => m.text)

export async function eventually(what: string, test: () => boolean | Promise<boolean>, ms = 30_000): Promise<void> {
  const end = Date.now() + ms
  while (!(await test())) {
    if (Date.now() > end) throw new VerifyError(`timed out waiting for ${what}`)
    await Bun.sleep(200)
  }
}

export const inSeconds = (n: number) => new Date(Date.now() + n * 1000).toISOString()

/** A tool call the fake agent makes when it reads this line (dev-fake.ts `[tool name {json}]`). */
export const toolLine = (name: string, args: unknown) => `[tool ${name} ${JSON.stringify(args)}]`
