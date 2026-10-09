import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { createVerifier, type Verifier, VerifyError } from "./client"

/** A suite is one file in `suites/` that default-exports this. */
export interface Suite {
  name: string
  /** True when the suite calls a model. `verify --no-model` skips it. */
  model?: boolean
  /** True when a person must act, such as signing in to a third party. Runs only when named. */
  human?: boolean
  run(v: Verifier): Promise<void>
}

export const suitesDir = join(import.meta.dir, "suites")

/** Loads every `suites/*.ts` file, so a new suite needs no registration. */
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
  /** Lets suites use the fake provider of a development server. */
  fake?: boolean
  names: string[]
  dir?: string
  log?: (line: string) => void
}

/** Runs the chosen suites. Returns the names that failed. */
export async function runSuites(opts: RunOptions): Promise<string[]> {
  const log = opts.log ?? console.log
  const all = await loadSuites(opts.dir)
  for (const n of opts.names) {
    if (!all.some((s) => s.name === n)) throw new VerifyError(`no suite named ${n}. run yuki verify --list`)
  }
  const chosen = all.filter((s) => !opts.names.length || opts.names.includes(s.name))
  const failed: string[] = []
  for (const s of chosen) {
    if (s.model && opts.noModel) {
      log(`skip ${s.name} (needs a model)`)
      continue
    }
    if (s.human && !opts.names.includes(s.name)) {
      log(`skip ${s.name} (needs a person; run it by name)`)
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
