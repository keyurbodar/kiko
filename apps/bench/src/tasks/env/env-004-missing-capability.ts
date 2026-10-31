import { join } from "node:path"
import { check, verdict } from "../helpers"
import type { Task } from "../../types"
import { computerDir, readTopology, writeTopology } from "./topology"

const OUT = "windows.txt"
const FIRST = "Fixture"

export const envMissingCapability: Task = {
  id: "env-004-missing-capability",
  track: "environment",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  contenders: ["kiko-remote"],
  prompt:
    "Only one of my computers can show its desktop. On that one, list the windows and write the first window's title into windows.txt, then reply DONE.",
  limits: { turns: 24, seconds: 300 },
  async setup(m) {
    const gamma = await computerDir(m.workdir, "gamma")
    const alpha = await computerDir(m.workdir, "alpha")
    await writeTopology(m, {
      computers: [
        { name: "gamma", dir: gamma, desktop: true },
        { name: "alpha", dir: alpha },
      ],
    })
  },
  async oracle(m) {
    const topology = await readTopology(m)
    const gamma = topology?.computers.find((pc) => pc.name === "gamma")
    if (gamma) await m.writeText(join(gamma.dir, OUT), `${FIRST}\n`)
  },
  async check(m) {
    const topology = await readTopology(m)
    const gamma = topology?.computers.find((pc) => pc.name === "gamma")
    const alpha = topology?.computers.find((pc) => pc.name === "alpha")
    const answer = gamma ? await m.readText(join(gamma.dir, OUT)) : undefined
    const wrong = alpha ? await m.readText(join(alpha.dir, OUT)) : undefined
    return verdict([
      check(
        "desktop computer answered",
        answer?.includes(FIRST) === true,
        `${OUT} on gamma was ${JSON.stringify(answer)}`,
      ),
      check("plain computer untouched", wrong === undefined, `${OUT} on alpha was ${JSON.stringify(wrong)}`),
    ])
  },
}
