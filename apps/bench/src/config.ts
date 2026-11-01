import { existsSync, readFileSync } from "node:fs"
import type { Condition, Os, Task, Track } from "./types"

interface ContenderConfig {
  readonly name: string
  readonly models: readonly string[]
}

interface TrackConfig {
  readonly track: Track
  readonly os: readonly Os[]
  readonly envs?: readonly string[]
  readonly conditions?: readonly Condition[]
  readonly maxTrialsPerJob?: number
  readonly contenders: readonly ContenderConfig[]
}

export interface RunnerSpec {
  readonly runner: string
  readonly machine: string
}

export type EnvKind = "host" | "container" | "vm"
export type DisplayStack = "x11" | "wayland" | "aqua"

export interface EnvSpec {
  readonly id: string
  readonly os: Os
  readonly runner: string
  readonly machine: string
  readonly kind: EnvKind
  readonly display: DisplayStack
  readonly image?: string
  readonly maxTrialsPerJob?: number
}

export interface BenchConfig {
  readonly reps: number
  readonly seed: number
  readonly conditions: readonly Condition[]
  readonly pattern: string
  readonly maxTrialsPerJob: number
  readonly validateRuns: number
  readonly runners: Readonly<Partial<Record<Os, RunnerSpec>>>
  readonly envs: readonly EnvSpec[]
  readonly tracks: readonly TrackConfig[]
}

export interface Job {
  readonly track: Track
  readonly os: Os
  readonly env: string
  readonly kind: EnvKind
  readonly display: DisplayStack
  readonly image?: string
  readonly contender: string
  readonly model: string
  readonly condition: Condition
  readonly shard: string
  readonly label: string
  readonly trials: number
  readonly runner: string
  readonly machine: string
}

const TRACKS: readonly Track[] = ["terminal", "browser", "desktop", "mixed", "cross"]
const OSES: readonly Os[] = ["linux", "macos"]
const CONDITIONS: readonly Condition[] = ["foreground", "background"]
const ENV_KINDS: readonly EnvKind[] = ["host", "container", "vm"]
const DISPLAYS: readonly DisplayStack[] = ["x11", "wayland", "aqua"]

const DEFAULT_RUNNERS: Readonly<Partial<Record<Os, RunnerSpec>>> = {
  linux: { runner: "ubuntu-24.04", machine: "gha-ubuntu-24.04-x11" },
  macos: { runner: "macos-15", machine: "gha-macos-15" },
}

const DEFAULT_ENVS: readonly EnvSpec[] = [
  {
    id: "ubuntu-24.04",
    os: "linux",
    runner: "ubuntu-24.04",
    machine: "gha-ubuntu-24.04-x11",
    kind: "host",
    display: "x11",
  },
  { id: "macos-15", os: "macos", runner: "macos-15", machine: "gha-macos-15", kind: "host", display: "aqua" },
]

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
    ...(Array.isArray(value.envs) && value.envs.length > 0
      ? { envs: strings(value.envs, `the environments of ${track}`) }
      : {}),
    ...(Array.isArray(value.conditions) && value.conditions.length > 0
      ? { conditions: oneOf(strings(value.conditions, `the conditions of ${track}`), CONDITIONS, "a condition") }
      : {}),
    ...(value.maxTrialsPerJob === undefined
      ? {}
      : { maxTrialsPerJob: number(value.maxTrialsPerJob, `maxTrialsPerJob of ${track}`, 1) }),
    contenders,
  }
}

function runnersOf(value: unknown): Readonly<Partial<Record<Os, RunnerSpec>>> {
  if (!isBag(value)) return DEFAULT_RUNNERS
  const runners: Record<string, RunnerSpec> = { ...DEFAULT_RUNNERS }
  for (const os of OSES) {
    const entry = value[os]
    if (!isBag(entry) || typeof entry.runner !== "string" || typeof entry.machine !== "string") continue
    runners[os] = { runner: entry.runner, machine: entry.machine }
  }
  return runners
}

function envOf(value: unknown): EnvSpec {
  if (!isBag(value) || typeof value.id !== "string") return fail("each environment to be an object with an id")
  const os = oneOf([typeof value.os === "string" ? value.os : ""], OSES, `the os of ${value.id}`)[0] ?? fail("an os")
  if (typeof value.runner !== "string") return fail(`the runner of ${value.id}`)
  if (typeof value.machine !== "string") return fail(`the machine of ${value.id}`)
  const kind =
    oneOf([typeof value.kind === "string" ? value.kind : "host"], ENV_KINDS, `the kind of ${value.id}`)[0] ?? "host"
  const display =
    oneOf(
      [typeof value.display === "string" ? value.display : os === "macos" ? "aqua" : "x11"],
      DISPLAYS,
      `the display of ${value.id}`,
    )[0] ?? "x11"
  if (kind === "container" && typeof value.image !== "string") return fail(`the image of ${value.id}`)
  return {
    id: value.id,
    os,
    runner: value.runner,
    machine: value.machine,
    kind,
    display,
    ...(typeof value.image === "string" ? { image: value.image } : {}),
    ...(value.maxTrialsPerJob === undefined
      ? {}
      : { maxTrialsPerJob: number(value.maxTrialsPerJob, `maxTrialsPerJob of ${value.id}`, 1) }),
  }
}

function envsOf(value: unknown): readonly EnvSpec[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_ENVS
  const envs = value.map(envOf)
  const ids = new Set(envs.map((env) => env.id))
  if (ids.size !== envs.length) return fail("every environment to have a different id")
  return envs
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
    envs: envsOf(raw.envs),
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

function trialsOf(
  config: BenchConfig,
  track: TrackConfig,
  env: EnvSpec,
  tasks: readonly Task[],
): { shards: number; trials: number } {
  const count = tasksFor(tasks, track.track, env.os).length * config.reps
  const perJob = track.maxTrialsPerJob ?? env.maxTrialsPerJob ?? config.maxTrialsPerJob
  const shards = Math.max(1, Math.ceil(count / perJob))
  return { shards, trials: Math.ceil(count / shards) }
}

const runsOn = (track: TrackConfig, env: EnvSpec): boolean =>
  track.os.includes(env.os) && (!track.envs || track.envs.includes(env.id))

function envJobs(config: BenchConfig, track: TrackConfig, env: EnvSpec, tasks: readonly Task[]): Job[] {
  const { shards, trials } = trialsOf(config, track, env, tasks)
  const base = {
    track: track.track,
    os: env.os,
    env: env.id,
    kind: env.kind,
    display: env.display,
    ...(env.image ? { image: env.image } : {}),
    trials,
    runner: env.runner,
    machine: env.machine,
  }
  return (track.conditions ?? config.conditions).flatMap((condition) =>
    track.contenders.flatMap((contender) =>
      contender.models.flatMap((model) =>
        Array.from({ length: shards }, (_, index) => ({
          ...base,
          contender: contender.name,
          model,
          condition,
          shard: `${index + 1}/${shards}`,
          label: `${index + 1}of${shards}`,
        })),
      ),
    ),
  )
}

export function planJobs(config: BenchConfig, tasks: readonly Task[]): Job[] {
  return config.tracks.flatMap((track) =>
    config.envs.filter((env) => runsOn(track, env)).flatMap((env) => envJobs(config, track, env, tasks)),
  )
}
