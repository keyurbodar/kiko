import { join } from "node:path"
import { check, verdict } from "../helpers"
import type { Task } from "../../types"
import { computerDir, readTopology, writeTopology } from "./topology"

const FILE = "notes.txt"

export const envCopyBetweenComputers: Task = {
  id: "env-001-copy-between-computers",
  track: "environment",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  contenders: ["kiko-remote"],
  prompt:
    "There is a file called notes.txt in alpha's home folder. Copy it to the same place on beta, then reply DONE.",
  limits: { turns: 20, seconds: 240 },
  async setup(m, seed) {
    const alpha = await computerDir(m.workdir, "alpha")
    const beta = await computerDir(m.workdir, "beta")
    await writeTopology(m, {
      computers: [
        { name: "alpha", dir: alpha },
        { name: "beta", dir: beta },
      ],
    })
    await m.writeText(join(alpha, FILE), `release notes for build ${seed + 40}\n`)
  },
  async oracle(m) {
    const topology = await readTopology(m)
    const [alpha, beta] = topology?.computers ?? []
    if (!alpha || !beta) return
    const text = await m.readText(join(alpha.dir, FILE))
    if (text !== undefined) await m.writeText(join(beta.dir, FILE), text)
  },
  async check(m) {
    const topology = await readTopology(m)
    const [alpha, beta] = topology?.computers ?? []
    const source = alpha ? await m.readText(join(alpha.dir, FILE)) : undefined
    const copied = beta ? await m.readText(join(beta.dir, FILE)) : undefined
    return verdict([
      check("source kept", source !== undefined, `${FILE} on alpha was ${JSON.stringify(source)}`),
      check(
        "copied",
        copied !== undefined && copied.trim() === source?.trim(),
        `${FILE} on beta was ${JSON.stringify(copied)}`,
      ),
    ])
  },
}
