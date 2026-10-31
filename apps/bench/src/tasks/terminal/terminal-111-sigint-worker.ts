import type { Machine, Task } from "../../types"
import {
  bun,
  check,
  LIMITS,
  readJson,
  readText,
  spawnTracked,
  verdict,
  waitForFile,
  writeJson,
  writeText,
} from "../helpers"

const WORDS = ["harbor", "copper", "signal", "garden", "meadow", "anchor"]

const token = (seed: number, salt: number): string => `${WORDS[(seed + salt) % WORDS.length]}-${seed * 31 + salt}`

const WORKER = `const fs = require("node:fs")
const token = process.argv[2]
const listen = Number(process.argv[3])
process.on("SIGINT", () => {})
fs.writeFileSync("pid", String(process.pid))
Bun.serve({ hostname: "127.0.0.1", port: listen, fetch: () => new Response(token) })
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

const alive = async (m: Machine, pid: number): Promise<boolean> => {
  if (!Number.isFinite(pid) || pid <= 0) return false
  const result = await bun(m, "try { process.kill(" + pid + ", 0); process.exit(1) } catch { process.exit(0) }")
  return result.code !== 0
}

const readPid = async (m: Machine, rel: string): Promise<number> => Number((await readText(m, rel))?.trim())

const serves = async (port: number): Promise<boolean> => {
  if (!Number.isFinite(port) || port <= 0) return false
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
}

export const sigintWorker: Task = {
  id: "terminal-111-sigint-worker",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt:
    "A worker is stuck on the port in port.txt and ignores Ctrl-C. Stop that worker. A second worker with the same script name belongs to another project and has to keep running, so do not kill by name.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const targetPort = await freePort(m)
    const otherPort = await freePort(m)
    await writeJson(m, "request.json", { worker: "worker.ts" })
    await writeText(m, "target/worker.ts", WORKER)
    await writeText(m, "other/worker.ts", WORKER)
    await writeText(m, "port.txt", `${targetPort}\n`)
    await writeText(m, "other-port.txt", `${otherPort}\n`)
    await spawnTracked(m, ["bun", "worker.ts", token(seed, 1), String(targetPort)], { cwd: `${m.workdir}/target` })
    await spawnTracked(m, ["bun", "worker.ts", token(seed, 5), String(otherPort)], { cwd: `${m.workdir}/other` })
    await waitForFile(m, "target/pid")
    await waitForFile(m, "other/pid")
  },
  oracle: async (m) => {
    const pid = await readPid(m, "target/pid")
    const code = `try { process.kill(${pid}, "SIGTERM") } catch {}
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { process.kill(${pid}, 0) } catch { process.exit(0) }
  await Bun.sleep(50)
}
process.exit(1)`
    const result = await bun(m, code)
    if (result.code !== 0) throw new Error(`the target worker did not stop: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const targetPort = Number((await readText(m, "port.txt"))?.trim())
    const otherPort = Number((await readText(m, "other-port.txt"))?.trim())
    const targetPid = await readPid(m, "target/pid")
    const otherPid = await readPid(m, "other/pid")
    const request = await readJson<{ worker?: string }>(m, "request.json")
    return verdict([
      check("target stopped", !(await alive(m, targetPid)), `target pid ${targetPid} is still running`),
      check("other worker alive", await alive(m, otherPid), `other pid ${otherPid} stopped`),
      check("other still serves", await serves(otherPort), `other worker on port ${otherPort} did not answer`),
      check("target port free", !(await serves(targetPort)), `port ${targetPort} still answers`),
      check("request untouched", request?.worker === "worker.ts", "request.json changed"),
    ])
  },
}
