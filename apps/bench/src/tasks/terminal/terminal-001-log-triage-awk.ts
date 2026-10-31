import type { Task } from "../../types"
import { check, int, LIMITS, mulberry32, readText, run, sample, verdict, writeJson, writeText } from "../helpers"

const ENDPOINTS = [
  "users",
  "orders",
  "sessions",
  "search",
  "billing",
  "webhooks",
  "uploads",
  "reports",
  "auth",
  "health",
]
const ERROR_COUNTS = [0, 2, 5, 9, 14, 21]
const BAD = [500, 502, 503]
const GOOD = [200, 201, 204, 404]

type Entry = { readonly endpoint: string; readonly status: number }

const plan = (seed: number): { readonly lines: string[]; readonly report: string } => {
  const rng = mulberry32(seed)
  const endpoints = sample(rng, ENDPOINTS, 6)
  const counts = sample(rng, ERROR_COUNTS, ERROR_COUNTS.length)
  const entries: Entry[] = []
  endpoints.forEach((endpoint, index) => {
    const count = counts[index] ?? 0
    for (let line = 0; line < count; line += 1) {
      entries.push({ endpoint, status: BAD[int(rng, 0, BAD.length - 1)] ?? 500 })
    }
  })
  while (entries.length < 400) {
    entries.push({
      endpoint: endpoints[int(rng, 0, endpoints.length - 1)] ?? "users",
      status: GOOD[int(rng, 0, GOOD.length - 1)] ?? 200,
    })
  }
  const lines = sample(rng, entries, entries.length).map((entry, index) => {
    const minutes = String(Math.floor(index / 60)).padStart(2, "0")
    const seconds = String(index % 60).padStart(2, "0")
    return `2026-10-31T12:${minutes}:${seconds}Z GET /api/${entry.endpoint} ${entry.status} ${int(rng, 1, 900)}ms`
  })
  const report = endpoints
    .map((endpoint, index) => ({ endpoint, count: counts[index] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.endpoint.localeCompare(right.endpoint))
    .map((entry) => `${entry.count} /api/${entry.endpoint}`)
    .join("\n")
  return { lines, report }
}

export const logTriage: Task = {
  id: "terminal-001-log-triage-awk",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  prompt:
    "Something is returning server errors in app.log. Write report.txt with one line per endpoint that returned a 5xx: the number of errors, a space, then the endpoint, most errors first. Endpoints with no errors do not belong in the file.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { lines } = plan(seed)
    await writeJson(m, "request.json", {})
    await writeText(m, "app.log", `${lines.join("\n")}\n`)
  },
  oracle: async (m) => {
    await run(m, [
      "bash",
      "-c",
      "awk '$4 ~ /^5/ { count[$3]++ } END { for (endpoint in count) print count[endpoint], endpoint }' app.log | sort -k1,1nr -k2,2 > report.txt",
    ])
  },
  check: async (m, seed) => {
    const { report } = plan(seed)
    const actual = await readText(m, "report.txt")
    return verdict([check("report matches", actual?.trim() === report, `report.txt was ${JSON.stringify(actual)}`)])
  },
}
