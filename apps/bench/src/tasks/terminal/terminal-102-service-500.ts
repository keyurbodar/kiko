import type { Machine, Task } from "../../types"
import {
  bun,
  check,
  LIMITS,
  mulberry32,
  pick,
  readText,
  spawnTracked,
  verdict,
  waitForFile,
  writeJson,
  writeText,
} from "../helpers"

const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const SERVICE = String.raw`const fs = require("node:fs")
const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
)
const config = JSON.parse(fs.readFileSync("config.json", "utf8"))
const mode = env.WIDGET_MODE || config.mode
const listen = Number(env.WIDGET_PORT || config.port)
const valid = ["strict", "loose"]
if (!valid.includes(mode)) {
  fs.writeFileSync("service.log", 'error: mode "' + mode + '" is not a valid widget mode (valid: strict, loose)\n')
  Bun.serve({ hostname: "127.0.0.1", port: listen, fetch: () => new Response("upstream unavailable", { status: 500 }) })
} else {
  Bun.serve({ hostname: "127.0.0.1", port: listen, fetch: () => new Response("ok " + mode) })
  fs.writeFileSync("service.log", "ready mode=" + mode + "\n")
  fs.writeFileSync("ready.txt", "ok " + mode + "\n")
}
`

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

const expectedMode = (seed: number): string => pick(mulberry32(seed + 7), ["strict", "loose"])

export const service500: Task = {
  id: "terminal-102-service-500",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "real",
  prompt:
    "The widget service behind the address in url.txt returns 500 and I cannot see why. Its logs and config are in this folder. Fix the cause and restart it so the health check returns ok.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const listen = await freePort(m)
    const mode = expectedMode(seed)
    await writeJson(m, "request.json", { service: pick(mulberry32(seed), WORDS) })
    await writeText(m, "config.json", `${JSON.stringify({ mode, port: listen }, null, 2)}\n`)
    await writeText(m, ".env", `WIDGET_MODE=broken\nWIDGET_PORT=${listen}\n`)
    await writeText(m, "service.ts", SERVICE)
    await writeText(m, "url.txt", `http://127.0.0.1:${listen}/health\n`)
    const child = await spawnTracked(m, ["bun", "service.ts"])
    await writeText(m, "service.pid", `${child.pid}\n`)
    await waitForFile(m, "service.log")
  },
  oracle: async (m) => {
    const pid = Number((await readText(m, "service.pid"))?.trim())
    const env = (await readText(m, ".env")) ?? ""
    const mode = (await readText(m, "config.json"))?.match(/"mode":\s*"([^"]+)"/)?.[1] ?? "strict"
    await bun(m, "try { process.kill(" + pid + ', "SIGTERM") } catch {}')
    await writeText(m, ".env", env.replace(/^WIDGET_MODE=.*$/m, `WIDGET_MODE=${mode}`))
    await bun(m, `require("node:fs").rmSync("ready.txt", { force: true })`)
    const child = await spawnTracked(m, ["bun", "service.ts"])
    await writeText(m, "service.pid", `${child.pid}\n`)
    await waitForFile(m, "ready.txt")
  },
  check: async (m, seed) => {
    const url = (await readText(m, "url.txt"))?.trim() ?? ""
    let body = ""
    let status = 0
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
      status = response.status
      body = await response.text()
    } catch (error) {
      body = String(error)
    }
    const mode = expectedMode(seed)
    const config = (await readText(m, "config.json")) ?? ""
    const log = (await readText(m, "service.log")) ?? ""
    const ready = (await readText(m, "ready.txt"))?.trim() ?? ""
    return verdict([
      check(
        "health ok",
        status === 200 && body.trim() === `ok ${mode}`,
        `GET ${url} -> ${status} ${JSON.stringify(body)}`,
      ),
      check("service restarted", ready === `ok ${mode}`, `ready.txt was ${JSON.stringify(ready)}`),
      check("config intact", config.includes('"port"'), `config.json was ${JSON.stringify(config.slice(0, 200))}`),
      check("no error in log", !log.includes("not a valid widget mode"), `service.log was ${JSON.stringify(log)}`),
    ])
  },
}
