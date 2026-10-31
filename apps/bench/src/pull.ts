import { existsSync } from "node:fs"
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { readRows } from "./ledger"

export const INDEX_HEADER = ["run_id", "gh_run", "machine", "commit", "rows"].join("\t")

async function filesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

async function indexLines(plans: string): Promise<string[]> {
  const path = join(plans, "index.tsv")
  if (!existsSync(path)) return []
  return (await readFile(path, "utf8")).split("\n").slice(1).filter(Boolean)
}

async function seenKeys(plans: string): Promise<Set<string>> {
  const lines = await indexLines(plans)
  return new Set(
    lines.flatMap((line) => {
      const [runId, , machine] = line.split("\t")
      return runId && machine ? [`${runId}\t${machine}`] : []
    }),
  )
}

export async function harvestArtifacts(staging: string, plans: string, ghRun: string): Promise<string[]> {
  const seen = await seenKeys(plans)
  const appended: string[] = []
  await mkdir(plans, { recursive: true })
  for (const artifact of await filesIn(staging)) {
    const base = join(staging, artifact)
    const root = existsSync(join(base, "results")) ? join(base, "results") : base
    for (const name of await filesIn(root)) {
      if (!name.endsWith(".tsv") || name.startsWith("validate-")) continue
      const source = join(root, name)
      const rows = await readRows(source)
      const first = rows[0]
      if (!first) continue
      const id = String(first.run_id)
      const machine = String(first.machine)
      const key = `${id}\t${machine}`
      await cp(source, join(plans, name), { force: true })
      const trials = join(root, id)
      if (existsSync(trials)) await cp(trials, join(plans, id), { recursive: true, force: true })
      if (seen.has(key)) continue
      seen.add(key)
      appended.push([id, ghRun, machine, String(first.commit), String(rows.length)].join("\t"))
    }
  }
  return appended
}

export async function appendIndex(plans: string, lines: readonly string[]): Promise<void> {
  const existing = await indexLines(plans)
  await writeFile(join(plans, "index.tsv"), [INDEX_HEADER, ...existing, ...lines].join("\n") + "\n", "utf8")
}
