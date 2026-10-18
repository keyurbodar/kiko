import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { createVerifier, type Verifier, VerifyError } from "./client"
import { SUITE_SECONDS } from "./weights"

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
  /** Runs only this shard's suites, of `shards` total. Unset runs every suite. */
  shard?: number
  shards?: number
  /** Skips the load tests, which send thousands of writes to measure scale rather than behavior. */
  noLoad?: boolean
}

export const isLocal = (url: string): boolean => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)

/**
 * The suites this shard runs, or all of them when no shard is asked for. Suites are placed longest first into
 * whichever shard is lightest so far, by the recorded SUITE_SECONDS. Spread by name hashing instead, the six
 * slowest suites landed on one or two shards, and a six-way split finished no faster than a four-way one.
 *
 * The assignment is deterministic: the same suites and shard count always produce the same split, so a shard
 * never has to know what another shard ran. Every suite lands in exactly one shard.
 */
export function shardOf(suites: readonly Suite[], shard: number, shards: number): Suite[] {
  if (!Number.isInteger(shards) || shards < 1) throw new VerifyError(`bad shard count: ${shards}`)
  if (!Number.isInteger(shard) || shard < 1 || shard > shards) throw new VerifyError(`bad shard: ${shard} of ${shards}`)
  const weight = (s: Suite): number => SUITE_SECONDS[s.name] ?? 0
  const bins: Suite[][] = Array.from({ length: shards }, () => [])
  const load = new Array<number>(shards).fill(0)
  // Longest first, then by name so two equally long suites do not depend on the directory order.
  for (const s of [...suites].sort((a, b) => weight(b) - weight(a) || a.name.localeCompare(b.name))) {
    let lightest = 0
    for (let i = 1; i < shards; i++) if (load[i]! < load[lightest]!) lightest = i
    bins[lightest]!.push(s)
    load[lightest]! += weight(s)
  }
  return bins[shard - 1]!
}

/** Why this suite will not run, or null when it will. */
function skipReason(s: Suite, opts: RunOptions): string | null {
  if (s.model && opts.noModel) return "needs a model"
  if (s.human && !opts.names.includes(s.name)) return "needs a person; run it by name"
  if (s.load && opts.noLoad) return "a load test"
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
  // Only the suites that will actually run are spread across shards. Sharding the skipped ones too would
  // leave a shard that logs nothing but "skip" while another carries all the work.
  const sharded = opts.shards !== undefined && !opts.names.length
  const chosen = sharded
    ? shardOf(matched.filter((s) => skipReason(s, opts) === null), opts.shard ?? 1, opts.shards!)
    : matched
  if (sharded) log(`shard ${opts.shard ?? 1}/${opts.shards}: ${chosen.length} suites`)
  const failed: string[] = []
  for (const s of chosen) {
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
