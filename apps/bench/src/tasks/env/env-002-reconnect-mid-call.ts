import { join } from "node:path"
import { check, verdict } from "../helpers"
import type { Task } from "../../types"
import { computerDir, readTopology, writeTopology } from "./topology"

const OUT = "out.txt"
const RESTART_MS = 1_000

export const envReconnectMidCall: Task = {
  id: "env-002-reconnect-mid-call",
  track: "environment",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  contenders: ["kiko-remote"],
  prompt: "On beta, run `sleep 4; printf survived > out.txt` and tell me when it has finished.",
  limits: { turns: 20, seconds: 240 },
  async setup(m) {
    const beta = await computerDir(m.workdir, "beta")
    await writeTopology(m, { computers: [{ name: "beta", dir: beta, restartAfterMs: RESTART_MS }] })
  },
  async oracle(m) {
    const topology = await readTopology(m)
    const beta = topology?.computers[0]
    if (beta) await m.writeText(join(beta.dir, OUT), "survived")
  },
  async check(m) {
    const topology = await readTopology(m)
    const beta = topology?.computers[0]
    const out = beta ? await m.readText(join(beta.dir, OUT)) : undefined
    return verdict([check("command finished", out?.trim() === "survived", `${OUT} was ${JSON.stringify(out)}`)])
  },
}
