import { existsSync, readFileSync } from "node:fs"
import type { Condition, Os, Task, Track } from "./types"

interface ContenderConfig {
  readonly name: string
  readonly models: readonly string[]
}

interface TrackConfig {
  readonly track: Track
  readonly os: readonly Os[]
  readonly runner?: string
  readonly machine?: string
  readonly maxTrialsPerJob?: number
  readonly contenders: readonly ContenderConfig[]
}

export interface RunnerSpec {
  readonly runner: string
  readonly machine: string
}

export interface BenchConfig {
  readonly reps: number
  readonly seed: number
  readonly conditions: readonly Condition[]
  readonly pattern: string
  readonly maxTrialsPerJob: number
  readonly validateRuns: number
  readonly runners: Readonly<Record<Os, RunnerSpec>>
  readonly tracks: readonly TrackConfig[]
}

export interface Job {
  readonly track: Track
  readonly os: Os
  readonly contender: string
  readonly model: string
  readonly shard: string
  readonly label: string
  readonly trials: number
  readonly runner: string
  readonly machine: string
}

const TRACKS: readonly Track[] = ["terminal", "browser", "desktop", "mixed"]
const OSES: readonly Os[] = ["linux", "macos", "windows"]
const CONDITIONS: readonly Condition[] = ["foreground", "background"]

const DEFAULT_RUNNERS: Readonly<Record<Os, RunnerSpec>> = {
  linux: { runner: "ubuntu-24.04", machine: "gha-ubuntu-24.04-x11" },
  macos: { runner: "macos-15", machine: "gha-macos-15" },
  windows: { runner: "windows-2025", machine: "gha-windows-2025" },
}

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null

const fail = (what: string): never => {
  throw new Error(`the bench config needs ${what}`)
}

const strings = (value: unknown, what: string): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") && value.length > 0
    ? [...(value as string[])]
    : fail(what)

const oneOf = <T extends string>(values: readonly string[], allowed: readonly T[], what: string): T[] =>
  values.map(
    (value) => allowed.find((candidate) => candidate === value) ?? fail(`${what} to be one of ${allowed.join(", ")}`),
  )

const number = (value: unknown, what: string, fallback: number): number =>
  value === undefined
    ? fallback
    : typeof value === "number" && value > 0
      ? value
      : fail(`${what} to be a positive number`)

function contenderOf(value: unknown, models: readonly string[]): ContenderConfig {
  if (typeof value === "string") return { name: value, models }
  if (!isBag(value) || typeof value.name !== "string")
    return fail("each contender to be a name or an object with a name")
  const own = value.models === undefined ? models : strings(value.models, `the models of ${value.name}`)
  return { name: value.name, models: own }
}

function trackOf(value: unknown, flat: { contenders: readonly string[]; models: readonly string[] }): TrackConfig {
  if (typeof value === "string")
    return {
      track: oneOf([value], TRACKS, "a track")[0] ?? fail("a track"),
      os: [...OSES],
      contenders: flat.contenders.map((name) => ({ name, models: flat.models })),
    }
  if (!isBag(value) || typeof value.track !== "string") return fail("each track to be a name or an object with a track")
  const track = oneOf([value.track], TRACKS, "a track")[0] ?? fail("a track")
  const contenders = Array.isArray(value.contenders)
    ? value.contenders.map((entry) => contenderOf(entry, flat.models))
    : flat.contenders.map((name) => ({ name, models: flat.models }))
  return {
    track,
    os: oneOf(value.os === undefined ? [...OSES] : strings(value.os, `the machines of ${track}`), OSES, "a machine"),
    ...(typeof value.runner === "string" ? { runner: value.runner } : {}),
    ...(typeof value.machine === "string" ? { machine: value.machine } : {}),
    ...(value.maxTrialsPerJob === undefined
      ? {}
      : { maxTrialsPerJob: number(value.maxTrialsPerJob, `maxTrialsPerJob of ${track}`, 1) }),
    contenders,
  }
}

function runnersOf(value: unknown): Readonly<Record<Os, RunnerSpec>> {
  if (!isBag(value)) return DEFAULT_RUNNERS
  const runners: Record<string, RunnerSpec> = { ...DEFAULT_RUNNERS }
  for (const os of OSES) {
    const entry = value[os]
    if (!isBag(entry) || typeof entry.runner !== "string" || typeof entry.machine !== "string") continue
    runners[os] = { runner: entry.runner, machine: entry.machine }
  }
  return runners as Record<Os, RunnerSpec>
}

export function readConfig(path: string): BenchConfig {
  if (!existsSync(path)) throw new Error(`there is no bench config at ${path}`)
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isBag(raw)) return fail("an object")
  const validate: Bag = isBag(raw.validate) ? raw.validate : {}
  const flat = {
    contenders: raw.contenders === undefined ? [] : strings(raw.contenders, "contenders"),
    models: raw.models === undefined ? ["beam-free"] : strings(raw.models, "models"),
  }
  const tracks = Array.isArray(raw.tracks) && raw.tracks.length > 0 ? raw.tracks : fail("at least one track")
  return {
    reps: number(raw.reps, "reps", 1),
    seed: number(raw.seed, "seed", 1),
    conditions:
      raw.conditions === undefined
        ? ["foreground"]
        : oneOf(strings(raw.conditions, "conditions"), CONDITIONS, "a condition"),
    pattern: typeof raw.pattern === "string" ? raw.pattern : "*",
    maxTrialsPerJob: number(raw.maxTrialsPerJob, "maxTrialsPerJob", 200),
    validateRuns: number(validate.runs, "validate.runs", 1),
    runners: runnersOf(raw.runners),
    tracks: tracks.map((entry) => trackOf(entry, flat)),
  }
}

const tasksFor = (tasks: readonly Task[], track: Track, os: Os): Task[] =>
  tasks.filter((task) => task.track === track && task.os.includes(os))

export function inShard(index: number, shard: string): boolean {
  const parts = shard.split("/")
  const pick = Number(parts[0])
  const count = Number(parts[1])
  if (
    parts.length !== 2 ||
    !Number.isInteger(count) ||
    !Number.isInteger(pick) ||
    count < 1 ||
    pick < 1 ||
    pick > count
  )
    throw new Error(`a shard is written 1/3, not ${JSON.stringify(shard)}`)
  return index % count === pick - 1
}

export function planJobs(config: BenchConfig, tasks: readonly Task[]): Job[] {
  const jobs: Job[] = []
  for (const track of config.tracks) {
    for (const os of track.os) {
      const runner = track.runner ?? config.runners[os].runner
      const machine = track.machine ?? config.runners[os].machine
      const count = tasksFor(tasks, track.track, os).length * config.reps
      const perJob = track.maxTrialsPerJob ?? config.maxTrialsPerJob
      const shards = Math.max(1, Math.ceil(count / perJob))
      for (const contender of track.contenders) {
        for (const model of contender.models) {
          for (let shard = 1; shard <= shards; shard += 1)
            jobs.push({
              track: track.track,
              os,
              contender: contender.name,
              model,
              shard: `${shard}/${shards}`,
              label: `${shard}of${shards}`,
              trials: Math.ceil(count / shards),
              runner,
              machine,
            })
        }
      }
    }
  }
  return jobs
}
