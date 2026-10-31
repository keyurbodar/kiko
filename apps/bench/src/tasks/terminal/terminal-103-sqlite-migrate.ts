import { createHash } from "node:crypto"
import type { Task } from "../../types"
import { bun, check, int, LIMITS, mulberry32, pick, run, verdict, writeJson, writeText } from "../helpers"

const KINDS = ["upload", "download", "sync", "login", "export"]
const ROWS = 500

interface Event {
  readonly id: number
  readonly payload: string
  readonly status: "ok" | "failed"
}

const plan = (seed: number): Event[] => {
  const rng = mulberry32(seed)
  return Array.from({ length: ROWS }, (_, index) => {
    const ok = rng() > 0.35
    const payload = JSON.stringify({ kind: pick(rng, KINDS), ok, size: int(rng, 1, 9999) })
    return { id: index + 1, payload, status: ok ? "ok" : "failed" }
  })
}

const setupCode = (rows: readonly Event[]): string => `import { Database } from "bun:sqlite"
const db = new Database("app.db")
db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
const insert = db.prepare("INSERT INTO events (id, payload) VALUES (?, ?)")
db.transaction(() => {
  for (const row of ${JSON.stringify(rows.map((row) => [row.id, row.payload]))}) insert.run(row[0], row[1])
})()
db.close()
`

const APP = `import { Database } from "bun:sqlite"
const db = new Database("app.db")
const rows = db.query("SELECT status, count(*) AS n FROM events GROUP BY status ORDER BY status").all()
console.log(JSON.stringify(rows))
`

const MIGRATE = `import { Database } from "bun:sqlite"
const db = new Database("app.db")
db.exec("ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'")
db.exec("UPDATE events SET status = 'failed' WHERE json_extract(payload, '$.ok') = 0")
db.close()
`

const hashCode = `import { createHash } from "node:crypto"
import { Database } from "bun:sqlite"
const db = new Database("app.db")
const rows = db.query("SELECT payload FROM events ORDER BY id").all()
const hash = createHash("sha256").update(rows.map((row) => row.payload).join("\\n")).digest("hex")
console.log(JSON.stringify({ hash, count: rows.length }))
`

export const sqliteMigrate: Task = {
  id: "terminal-103-sqlite-migrate",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "The report app here fails with `no such column: status`. Migrate app.db so the app works: an event is failed when its payload says ok is false, and ok otherwise. Keep every event and do not change any payload.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const rows = plan(seed)
    await writeJson(m, "request.json", { table: "events" })
    await writeText(m, "app.ts", APP)
    await bun(m, setupCode(rows))
  },
  oracle: async (m) => {
    const result = await bun(m, MIGRATE)
    if (result.code !== 0) throw new Error(`migration failed: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const rows = plan(seed)
    const expected = {
      failed: rows.filter((row) => row.status === "failed").length,
      ok: rows.filter((row) => row.status === "ok").length,
    }
    const app = await run(m, ["bun", "app.ts"])
    let counts: Record<string, number> = {}
    try {
      const parsed = JSON.parse(app.stdout.trim()) as Array<{ status: string; n: number }>
      counts = Object.fromEntries(parsed.map((row) => [row.status, row.n]))
    } catch {}
    const integrity = await bun(m, hashCode)
    let actual = { hash: "", count: 0 }
    try {
      actual = JSON.parse(integrity.stdout.trim()) as { hash: string; count: number }
    } catch {}
    const expectedHash = createHash("sha256")
      .update(rows.map((row) => row.payload).join("\n"))
      .digest("hex")
    return verdict([
      check("app runs", app.code === 0, `bun app.ts exited ${app.code}: ${app.stderr.slice(-300)}`),
      check(
        "statuses",
        counts.failed === expected.failed && counts.ok === expected.ok,
        `counts were ${JSON.stringify(counts)}, expected ${JSON.stringify(expected)}`,
      ),
      check("all events kept", actual.count === ROWS, `app.db has ${actual.count} events`),
      check(
        "payloads unchanged",
        actual.hash === expectedHash,
        `payload hash was ${actual.hash}, expected ${expectedHash}`,
      ),
    ])
  },
}
