import { join } from "node:path"
import { check, verdict } from "../helpers"
import type { Task } from "../../types"
import { computerDir, readTopology, writeTopology } from "./topology"

const VERSION = "version.txt"
const ANSWER = "answer.txt"
const RELEASE = "1.2.3"

export const envPickTheBox: Task = {
  id: "env-003-pick-the-box",
  track: "environment",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  contenders: ["kiko-remote"],
  prompt:
    "Both of my boxes have a file called version.txt. One holds the real release number and the other holds a placeholder. Copy the real release number into answer.txt on the box that has it, then reply DONE.",
  limits: { turns: 24, seconds: 300 },
  async setup(m) {
    const one = await computerDir(m.workdir, "box-1")
    const two = await computerDir(m.workdir, "box-2")
    await writeTopology(m, {
      computers: [
        { name: "box-1", dir: one },
        { name: "box-2", dir: two },
      ],
    })
    await m.writeText(join(one, VERSION), `${RELEASE}\n`)
    await m.writeText(join(two, VERSION), "placeholder\n")
  },
  async oracle(m) {
    const topology = await readTopology(m)
    const one = topology?.computers.find((pc) => pc.name === "box-1")
    if (one) await m.writeText(join(one.dir, ANSWER), `${RELEASE}\n`)
  },
  async check(m) {
    const topology = await readTopology(m)
    const one = topology?.computers.find((pc) => pc.name === "box-1")
    const two = topology?.computers.find((pc) => pc.name === "box-2")
    const answer = one ? await m.readText(join(one.dir, ANSWER)) : undefined
    const wrong = two ? await m.readText(join(two.dir, ANSWER)) : undefined
    return verdict([
      check("real box answered", answer?.trim() === RELEASE, `${ANSWER} on box-1 was ${JSON.stringify(answer)}`),
      check("placeholder box untouched", wrong === undefined, `${ANSWER} on box-2 was ${JSON.stringify(wrong)}`),
    ])
  },
}
