import { randomBytes } from "node:crypto"
import { join } from "node:path"

export const SERVER_PORT = 8899
export const WEB_PORT = 5174

const ROOT = join(import.meta.dirname, "..", "..", "..")
const SERVER = join(ROOT, "apps", "server")
const WEB = join(ROOT, "apps", "web-solid")

export type Child = ReturnType<typeof Bun.spawn>

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function until(what: string, check: () => Promise<boolean> | boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check().catch(() => false)) return
    await wait(250)
  }
  throw new Error(`timed out waiting for ${what}`)
}

export function start(name: string, cmd: string[], cwd: string, env: Record<string, string> = {}): Child {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  for (const stream of [proc.stdout, proc.stderr])
    void (async () => {
      for await (const chunk of stream) process.stderr.write(`[${name}] ${new TextDecoder().decode(chunk)}`)
    })()
  return proc
}

export type WorkerKeys = { kek: string; secret: string }

export async function startWorker(children: Child[], dir: string): Promise<WorkerKeys> {
  const kek = randomBytes(32).toString("base64")
  const secret = randomBytes(32).toString("hex")
  children.push(
    start(
      "worker",
      [
        "bunx",
        "wrangler",
        "dev",
        "--port",
        String(SERVER_PORT),
        "--ip",
        "127.0.0.1",
        "--var",
        `CREDENTIALS_KEK:${kek}`,
        "--var",
        `SESSION_SECRET:${secret}`,
        "--persist-to",
        join(dir, "state"),
      ],
      SERVER,
      { NODE_ENV: "development" },
    ),
  )
  await until("the worker", async () => (await fetch(`http://127.0.0.1:${SERVER_PORT}/api/health`)).ok)
  return { kek, secret }
}

export async function startWeb(children: Child[]): Promise<void> {
  children.push(
    start("web", ["bunx", "vite", "--port", String(WEB_PORT), "--strictPort"], WEB, {
      KIKO_SERVER_PORT: String(SERVER_PORT),
    }),
  )
  await until("the web app", async () => {
    for (const host of ["localhost", "127.0.0.1"]) {
      const ok = await fetch(`http://${host}:${WEB_PORT}/`)
        .then((answer) => answer.ok)
        .catch(() => false)
      if (ok) return true
    }
    return false
  })
}

export async function signIn(): Promise<string> {
  const found: { token?: string } = {}
  await until(
    "the owner's session",
    async () => {
      const answer = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/auth/dev/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: `http://127.0.0.1:${SERVER_PORT}` },
        body: JSON.stringify({ name: "owner" }),
      })
      const body = await answer.text()
      if (!answer.ok) {
        process.stderr.write(`[session] ${answer.status} ${body.slice(0, 200)}\n`)
        return false
      }
      try {
        const parsed = JSON.parse(body) as { token?: unknown }
        if (typeof parsed.token === "string") found.token = parsed.token
      } catch {
        process.stderr.write(`[session] ${answer.status} not json: ${body.slice(0, 200)}\n`)
      }
      return found.token !== undefined
    },
    30_000,
  )
  return found.token ?? ""
}
