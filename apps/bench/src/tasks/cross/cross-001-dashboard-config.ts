import type { Machine, Task } from "../../types"
import {
  bun,
  check,
  LIMITS,
  mulberry32,
  pick,
  readJson,
  spawnTracked,
  verdict,
  waitForFile,
  writeJson,
  writeText,
} from "../helpers"
import { crossState, openCross, readBrowserValue } from "./support"

const REGIONS = ["eu-west", "eu-central", "eu-north", "ap-south", "us-east"]
const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const regions = (seed: number): { expected: string; current: string } => {
  const rng = mulberry32(seed)
  const expected = pick(rng, REGIONS)
  const current = REGIONS.find((region) => region !== expected) ?? "us-east"
  return { expected, current }
}

const freePort = async (m: Machine): Promise<number> => {
  const result = await bun(
    m,
    `const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") })
const chosen = probe.port
probe.stop(true)
console.log(chosen)`,
  )
  const chosen = Number(result.stdout.trim())
  if (!Number.isFinite(chosen) || chosen <= 0) throw new Error(`could not find a free port: ${result.stderr}`)
  return chosen
}

const SERVICE = `const fs = require("node:fs")
const config = JSON.parse(fs.readFileSync("config.json", "utf8"))
fs.writeFileSync("service.log", "starting region=" + config.region + "\\n")
fs.writeFileSync("ready.txt", "ok\\n")
Bun.serve({ hostname: "127.0.0.1", port: config.port, fetch: () => Response.json({ ok: true, region: config.region }) })
`

const startService = async (m: Machine): Promise<void> => {
  await bun(m, `require("node:fs").rmSync("ready.txt", { force: true })`)
  const child = await spawnTracked(m, ["bun", "service.ts"])
  await writeText(m, "service.pid", `${child.pid}\n`)
  await waitForFile(m, "ready.txt")
}

export const dashboardConfig: Task = {
  id: "cross-001-dashboard-config",
  track: "cross",
  os: ["linux", "macos"],
  needs: ["chrome"],
  heldOut: false,
  kind: "real",
  prompt:
    "The deployment dashboard at url.txt says the service is in the wrong region. Find the required region on that page, change the service configuration, and restart the service so the dashboard reports healthy.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { expected, current } = regions(seed)
    const servicePort = await freePort(m)
    await writeJson(m, "request.json", { service: pick(mulberry32(seed + 3), WORDS) })
    await writeText(m, "service.ts", SERVICE)
    await writeJson(m, "config.json", { region: current, port: servicePort })
    await startService(m)
    await openCross(
      m,
      "cross-001-dashboard-config",
      { expectedRegion: expected, currentRegion: current, servicePort },
      "/",
    )
  },
  oracle: async (m) => {
    const expected = await readBrowserValue("cross-001-dashboard-config", m.workdir)
    const config = await readJson<{ region?: string; port?: number }>(m, "config.json")
    await writeJson(m, "config.json", { ...config, region: expected })
    const pid = Number((await m.readText(`${m.workdir}/service.pid`))?.trim())
    await bun(m, "try { process.kill(" + pid + ', "SIGTERM") } catch {}')
    await startService(m)
  },
  check: async (m, seed) => {
    const { expected } = regions(seed)
    const url = (await m.readText(`${m.workdir}/url.txt`))?.trim() ?? ""
    const config = await readJson<{ region?: string; port?: number }>(m, "config.json")
    let health: { ok?: boolean; region?: string } = {}
    let status: { healthy?: boolean; region?: string } = {}
    try {
      const response = await fetch(`http://127.0.0.1:${config?.port}/health`, { signal: AbortSignal.timeout(3000) })
      health = (await response.json()) as { ok?: boolean; region?: string }
    } catch {}
    try {
      const response = await fetch(`${new URL(url).origin}/api/status`, { signal: AbortSignal.timeout(3000) })
      status = (await response.json()) as { healthy?: boolean; region?: string }
    } catch {}
    const state = await crossState(m)
    return verdict([
      check(
        "service in the required region",
        health.ok === true && health.region === expected,
        `service health was ${JSON.stringify(health)}, expected ${expected}`,
      ),
      check("dashboard healthy", status.healthy === true, `dashboard status was ${JSON.stringify(status)}`),
      check("config updated", config?.region === expected, `config.json region was ${JSON.stringify(config?.region)}`),
      check("dashboard served", state !== undefined, "the dashboard wrote no state"),
    ])
  },
}
