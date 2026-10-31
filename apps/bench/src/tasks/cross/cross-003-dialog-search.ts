import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, pick, readJson, readText, verdict, writeJson, writeText } from "../helpers"
import { crossAppState, launchCrossApp, runCrossAppOracle } from "./support"

const WORDS = ["green-harbor", "amber-river", "silver-meadow", "copper-summit", "quiet-anchor", "rapid-willow"]

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const plan = (seed: number): { code: string; key: string; log: string } => {
  const rng = mulberry32(seed)
  const code = `SYNC-${hex(rng, 8)}`
  const key = `${pick(rng, WORDS)}-${Math.floor(rng() * 90 + 10)}`
  const lines = Array.from({ length: 120 }, (_, index) => {
    const other = `SYNC-${hex(rng, 8)}`
    const otherKey = `${pick(rng, WORDS)}-${Math.floor(rng() * 90 + 10)}`
    return `2026-10-31T09:${String(index % 60).padStart(2, "0")}:00Z sync failed code=${other} key=${otherKey}`
  })
  lines[73] = `2026-10-31T10:13:00Z sync failed code=${code} key=${key}`
  return { code, key, log: `${lines.join("\n")}\n` }
}

export const dialogSearch: Task = {
  id: "cross-003-dialog-search",
  track: "cross",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  kind: "real",
  prompt:
    "The Sync Console window shows a failure code. Find the matching line in logs/sync.log, fix config.json with the key from that line, then press Retry in the window.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { code, key, log } = plan(seed)
    await writeJson(m, "request.json", { app: "Sync Console" })
    await writeText(m, "logs/sync.log", log)
    await writeJson(m, "config.json", { sync_key: "stale-value" })
    await launchCrossApp(m, "error", { code, expectedKey: key })
  },
  oracle: async (m, seed) => {
    const { key } = plan(seed)
    const state = await crossAppState(m)
    const code = String(state?.code ?? "")
    const log = (await readText(m, "logs/sync.log")) ?? ""
    const line = log.split("\n").find((entry) => entry.includes(`code=${code}`))
    if (!line) throw new Error(`no log line for ${code}`)
    const found = line.match(/key=(\S+)/)?.[1]
    if (!found) throw new Error(`no key on the log line: ${line}`)
    if (found !== key) throw new Error(`unexpected key ${found}`)
    await writeJson(m, "config.json", { sync_key: found })
    await runCrossAppOracle(m, "error")
  },
  check: async (m, seed) => {
    const { key, log } = plan(seed)
    const config = await readJson<{ sync_key?: string }>(m, "config.json")
    const state = await crossAppState(m)
    const logs = await readText(m, "logs/sync.log")
    return verdict([
      check("config fixed", config?.sync_key === key, `config.json was ${JSON.stringify(config)}`),
      check("app accepted the fix", state?.fixed === true, `app state was ${JSON.stringify(state)}`),
      check("logs untouched", logs === log, "logs/sync.log changed"),
    ])
  },
}
