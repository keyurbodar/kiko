import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Machine } from "../../types"

export interface EnvComputer {
  readonly name: string
  readonly dir: string
  readonly desktop?: boolean
  readonly restartAfterMs?: number
}

interface EnvTopology {
  readonly computers: readonly EnvComputer[]
}

const TOPOLOGY_FILE = ".bench-env.json"

const topologyPath = (workdir: string): string => join(workdir, TOPOLOGY_FILE)

export async function writeTopology(m: Machine, topology: EnvTopology): Promise<void> {
  await writeFile(topologyPath(m.workdir), JSON.stringify(topology, null, 2), "utf8")
}

export async function readTopology(m: Machine): Promise<EnvTopology | null> {
  try {
    const raw = JSON.parse(await readFile(topologyPath(m.workdir), "utf8")) as EnvTopology
    return Array.isArray(raw.computers) && raw.computers.length > 0 ? raw : null
  } catch {
    return null
  }
}

export async function computerDir(parent: string, name: string): Promise<string> {
  const dir = join(parent, `pc-${name}`)
  await mkdir(dir, { recursive: true })
  return dir
}
