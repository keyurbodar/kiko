import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { createVerifier, type Verifier, VerifyError } from "./client"

export interface Suite {
  name: string
  model?: boolean
  human?: boolean
  /** A load test: it sends thousands of writes, so it runs only against a local server, never a deployed one. */
  load?: boolean
  run(v: Verifier): Promise<void>
}

export const suitesDir = join(import.meta.dir, "suites")

export async function loadSuites(dir = suitesDir): Promise<Suite[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts")).sort()
  const suites: Suite[] = []
  for (const file of files) {
    const mod = (await import(join(dir, file))) as { default?: Suite }
    const s = mod.default
    if (!s || typeof s.name !== "string" || typeof s.run !== "function") {
      throw new VerifyError(`suites/${file} must default-export { name, run }`)
    }
    suites.push(s)
  }
  return suites
}

export interface RunOptions {
  url: string
  noModel: boolean
  fake?: boolean
  names: string[]
  dir?: string
  log?: (line: string) => void
}

export const isLocal = (url: string): boolean => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)

/** Why this suite will not run, or null when it will. */
function skipReason(s: Suite, opts: RunOptions): string | null {
  if (s.model && opts.noModel) return "needs a model"
  if (s.human && !opts.names.includes(s.name)) return "needs a person; run it by name"
  if (s.load && !isLocal(opts.url)) return "a load test; it runs only against a local server"
  return null
}

export async function runSuites(opts: RunOptions): Promise<string[]> {
  const log = opts.log ?? console.log
  const all = await loadSuites(opts.dir)
  for (const n of opts.names) {
    if (!all.some((s) => s.name === n)) throw new VerifyError(`no suite named ${n}. run kiko verify --list`)
  }
  const matched = all.filter((s) => !opts.names.length || opts.names.includes(s.name))
  const failed: string[] = []
  for (const s of matched) {
    const skip = skipReason(s, opts)
    if (skip) {
      log(`skip ${s.name} (${skip})`)
      continue
    }
    const v = createVerifier(opts.url, { fake: opts.fake ?? false })
    const t = Date.now()
    try {
      await s.run(v)
      log(`pass ${s.name} (${Date.now() - t}ms)`)
    } catch (e) {
      failed.push(s.name)
      log(`fail ${s.name}\n${e instanceof Error ? e.message : String(e)}`)
    } finally {
      v.closeAll()
    }
  }
  return failed
}
