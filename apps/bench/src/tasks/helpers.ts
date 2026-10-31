import { unwatchFile, watchFile } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Check, Exec, Machine, Verdict } from "../types"

export const LIMITS = { turns: 30, seconds: 300 } as const

export const at = (m: Machine, ...parts: string[]): string => join(m.workdir, ...parts)

export const readText = async (m: Machine, rel: string): Promise<string | undefined> => m.readText(at(m, rel))

export const writeText = async (m: Machine, rel: string, text: string): Promise<void> => m.writeText(at(m, rel), text)

export const readJson = async <T>(m: Machine, rel: string): Promise<T | undefined> => {
  const text = await readText(m, rel)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export const writeJson = async (m: Machine, rel: string, value: unknown): Promise<void> =>
  writeText(m, rel, `${JSON.stringify(value, null, 2)}\n`)

export const run = (
  m: Machine,
  cmd: readonly string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Exec> => m.exec(cmd, { cwd: m.workdir, ...opts })

export const bun = (m: Machine, code: string, opts: Parameters<Machine["exec"]>[1] = {}): Promise<Exec> =>
  run(m, ["bun", "-e", code], opts)

export const git = (m: Machine, args: readonly string[], opts: Parameters<Machine["exec"]>[1] = {}): Promise<Exec> =>
  run(m, ["git", ...args], opts)

export const python = (_m: Machine): string => "python3"

export const fixture = (rel: string): string => fileURLToPath(new URL(`../../fixtures/${rel}`, import.meta.url))

export const check = (name: string, pass: boolean, detail: string): Check => ({ name, pass, detail })

export const verdict = (checks: readonly Check[]): Verdict => ({
  pass: checks.every((entry) => entry.pass),
  checks,
})

export const matchesFile = async (m: Machine, name: string, rel: string, expected: string): Promise<Check> => {
  const actual = await readText(m, rel)
  return check(name, actual?.trim() === expected.trim(), `${rel} was ${JSON.stringify(actual)}`)
}

export const waitForFile = async (m: Machine, rel: string, timeoutMs = 20_000): Promise<void> => {
  const target = at(m, rel)
  if ((await m.readText(target)) !== undefined) return
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const stop = (): void => {
      clearTimeout(timer)
      unwatchFile(target)
    }
    timer = setTimeout(() => {
      stop()
      reject(new Error(`waiting for ${rel} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    watchFile(target, { interval: 25 }, (current) => {
      if (!current.isFile()) return
      stop()
      resolve()
    })
  })
}

export const waitForSpawn = async (m: Machine, rel: string, timeoutMs = 20_000): Promise<void> => {
  try {
    await waitForFile(m, rel, timeoutMs)
  } catch (error) {
    const log = (await m.readText(at(m, ".spawn.log")))?.slice(-4000) ?? ""
    const listing = await bun(m, `console.log(require("node:fs").readdirSync(process.cwd()).join(" "))`)
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${log}\nfiles: ${listing.stdout}\n${listing.stderr}`,
      { cause: error },
    )
  }
}

export const spawnTracked = async (
  m: Machine,
  cmd: readonly string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ pid: number; stop(): Promise<void> }> => {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await m.spawn(cmd, opts)
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

export const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!

export const sample = <T>(rng: () => number, items: readonly T[], count: number): T[] => {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1))
    const value = copy[index]!
    copy[index] = copy[other]!
    copy[other] = value
  }
  return copy.slice(0, Math.min(count, copy.length))
}

export const int = (rng: () => number, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1))
