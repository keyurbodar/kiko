import { type RoomHandle, type Session, VerifyError } from "./client"
import { messages, poll } from "./kit"


export type Routine = { id: string; name: string | null; status: string; createdBy: string; target: string; fails: number; dueUtc: number; trigger: { on: string } | null; roomId: string }
export type Run = { routineId: string; occurrence: string; status: string; seq: number | null; startedAt: number }

export async function api<T>(url: string, s: Session, path: string, body?: unknown, method?: string): Promise<{ status: number; json: T }> {
  const res = await fetch(new URL(`api/${path}`, url), {
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

export const waitRuns = (url: string, s: Session, id: string, what: string, test: (runs: Run[]) => boolean, ms?: number) =>
  poll(what, async () => {
    const runs = await runsOf(url, s, id)
    return test(runs) && runs
  }, ms, 300)

export const waitRoutine = (url: string, s: Session, test: (r: Routine[]) => Routine | undefined, what: string, ms?: number) =>
  poll(what, async () => test((await routines(url, s)).routines), ms, 300)

export const systemTexts = (room: RoomHandle) => messages(room).filter((m) => m.from.kind === "system").map((m) => m.text)

export const inSeconds = (n: number) => new Date(Date.now() + n * 1000).toISOString()

export const toolLine = (name: string, args: unknown) => `[tool ${name} ${JSON.stringify(args)}]`
