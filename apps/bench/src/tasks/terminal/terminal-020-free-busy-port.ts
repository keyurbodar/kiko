import type { Machine, Task } from "../../types"
import {
  bun,
  check,
  int,
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

const token = (seed: number): string => {
  const rng = mulberry32(seed)
  return "served-" + int(rng, 100000, 999999) + "-" + pick(rng, WORDS)
}

const HOLDER = String.raw`const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("busy") })
await Bun.write("port.txt", String(listener.port) + "\n")
`

const serverScript = (seed: number): string =>
  'const port = Number((await Bun.file("port.txt").text()).trim())\n' +
  "for (let attempt = 0; attempt < 200; attempt += 1) {\n" +
  "  try {\n" +
  '    const listener = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response(' +
  JSON.stringify(token(seed)) +
  ") })\n" +
  '    await Bun.write("served.txt", String(listener.port) + "\\n")\n' +
  "    break\n" +
  "  } catch {\n" +
  "    await Bun.sleep(100)\n" +
  "  }\n" +
  "}\n"

const holderAlive = async (m: Machine, pid: number): Promise<boolean> => {
  if (!Number.isFinite(pid) || pid <= 0) return false
  const result = await bun(m, "try { process.kill(" + pid + ", 0); process.exit(1) } catch { process.exit(0) }")
  return result.code !== 0
}

export const freeBusyPort: Task = {
  id: "terminal-020-free-busy-port",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  prompt:
    "Something is already listening on the port in port.txt. Stop it, then start ./server.ts so it serves the token.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", {})
    await writeText(m, "holder.ts", HOLDER)
    await writeText(m, "server.ts", serverScript(seed))
    const child = await spawnTracked(m, ["bun", "holder.ts"])
    await writeText(m, "holder.pid", String(child.pid) + "\n")
    await waitForFile(m, "port.txt")
  },
  oracle: async (m) => {
    const pid = Number((await readText(m, "holder.pid"))?.trim())
    const killed = await bun(m, "try { process.kill(" + pid + ', "SIGTERM") } catch {}')
    if (killed.code !== 0) throw new Error("could not stop the holder: " + (killed.stderr || killed.stdout))
    await spawnTracked(m, ["bun", "server.ts"])
    await waitForFile(m, "served.txt")
  },
  check: async (m, seed) => {
    const port = Number((await readText(m, "port.txt"))?.trim())
    const pid = Number((await readText(m, "holder.pid"))?.trim())
    let body = ""
    if (Number.isFinite(port) && port > 0) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/", { signal: AbortSignal.timeout(3000) })
        body = await response.text()
      } catch (error) {
        body = String(error)
      }
    }
    const alive = await holderAlive(m, pid)
    return verdict([
      check("serves token", body.trim() === token(seed), "GET / returned " + JSON.stringify(body)),
      check("holder stopped", !alive, "holder pid " + pid + (alive ? " is still running" : " is gone")),
    ])
  },
}
