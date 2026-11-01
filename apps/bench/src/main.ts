import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { BACKGROUND_COUNTERS, ZERO_BACKGROUND, backgroundSafe, counterCell } from "./background"
import { CONTENDERS } from "./contenders"
import { inShard, planJobs, readConfig, type BenchConfig } from "./config"
import { appendRow, escape, readRows, writeRows, type Row } from "./ledger"
import { classifyFailure, runLoop, SYSTEM_PROMPT_SHA, type LoopResult, type Outcome, type Trajectory } from "./loop"
import { clearGitHookEnv, createMachine, localOs, removeMachine } from "./machine"
import { ModelClient } from "./model"
import { appendIndex, harvestArtifacts } from "./pull"
import { renderReport } from "./report/render"
import { startSentinel, type Sentinel } from "./sentinel"
import { TASKS } from "./tasks"
import type { Background, Condition, Contender, ModelSpec, Os, Task, Track, Verdict } from "./types"

const PLANS = join(homedir(), "kiko-plans", "computer-use-2026-10-31", "results")
const VALIDATE_HEADER = ["task", "os", "machine", "kind", "pass", "detail"].join("\t")
const UNMEASURED_BACKGROUND: Background = { ...ZERO_BACKGROUND, unmeasured: BACKGROUND_COUNTERS }

const MODELS: Readonly<Record<string, ModelSpec>> = {
  "beam-free": { id: "beam-free", vision: false },
  "iceman-contributor-free": { id: "iceman-contributor-free", vision: false },
  "muse-spark-1.3-contributor": { id: "muse-spark-1.3-contributor", vision: true },
}

const VALUE_FLAGS = new Set([
  "track",
  "os",
  "contender",
  "model",
  "reps",
  "condition",
  "seed",
  "machine",
  "env",
  "task",
  "runs",
  "out",
  "results",
  "effort",
  "config",
  "shard",
])

interface Parsed {
  readonly command: string | undefined
  readonly positionals: readonly string[]
  readonly flags: Readonly<Record<string, string | true>>
}

function parseArgs(argv: readonly string[]): Parsed {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  let index = 0
  while (index < argv.length) {
    const arg = argv[index] ?? ""
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      index++
      continue
    }
    const [name = "", inline] = arg.slice(2).split("=", 2)
    if (inline !== undefined) {
      flags[name] = inline
      index++
      continue
    }
    const next = argv[index + 1]
    if (VALUE_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
      flags[name] = next
      index += 2
      continue
    }
    flags[name] = true
    index++
  }
  return { command: positionals[0], positionals: positionals.slice(1), flags }
}

const flagString = (flags: Parsed["flags"], name: string): string | undefined => {
  const value = flags[name]
  return typeof value === "string" ? value : undefined
}

const splitFlag = (flags: Parsed["flags"], name: string, fallback: string): string[] =>
  (flagString(flags, name) ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

function readKey(): string {
  const fromEnv = process.env.OPENCODE_GO_KEY?.trim()
  if (fromEnv) return fromEnv
  const path = join(homedir(), ".config", "kiko-bench", "opencode.key")
  const text = existsSync(path) ? readFileSync(path, "utf8").trim() : ""
  if (!text) throw new Error("no model key: set OPENCODE_GO_KEY or write ~/.config/kiko-bench/opencode.key")
  return text
}

function rootPackage(): { version?: string } {
  try {
    return JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: string }
  } catch {
    return {}
  }
}

const benchVersion = (): string => rootPackage().version ?? "unknown"

function commitSha(): string {
  const out = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" })
  return out.status === 0 ? out.stdout.trim() : "unknown"
}

function newRunId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  return `${stamp}-${Math.random().toString(16).slice(2, 8)}`
}

const resultsDir = (flags: Parsed["flags"]): string =>
  resolve(flagString(flags, "results") ?? process.env.BENCH_RESULTS_DIR ?? "results")

const matches = (task: Task, pattern: string): boolean =>
  pattern === "*" || task.id === pattern || new Bun.Glob(pattern).match(task.id)

function selectTasks(pattern: string, track: string | undefined, os: Os): Task[] {
  return TASKS.filter((task) => matches(task, pattern) && task.os.includes(os) && (!track || task.track === track))
}

function needDisplay(tasks: readonly Task[]): void {
  if (process.platform !== "linux") return
  if (!tasks.some((task) => task.needs.includes("display"))) return
  if (!process.env.DISPLAY) throw new Error("these tasks need a display: run them under xvfb-run with DISPLAY set")
}

const modelSpec = (id: string): ModelSpec => MODELS[id] ?? { id, vision: false }

function list(flags: Parsed["flags"]): void {
  const track = flagString(flags, "track")
  const os = flagString(flags, "os")
  const tasks = TASKS.filter((task) => (!track || task.track === track) && (!os || task.os.includes(os as Os)))
  for (const task of tasks)
    console.log(
      `${task.id}\t${task.track}\t${task.os.join(",")}\t${task.heldOut ? "held-out" : "public"}\t${task.prompt}`,
    )
  console.log(`${tasks.length} tasks`)
}

const safe = (condition: Condition, background: Background): boolean =>
  condition === "foreground" || backgroundSafe(background)

const scored = (outcome: Outcome): boolean => outcome === "done" || outcome === "turns" || outcome === "timeout"

function emptyTrajectory(input: TrialInput, outcome: Outcome, error: string): Trajectory {
  return {
    run_id: input.runId,
    trial_id: input.trialId,
    task: input.task.id,
    track: input.task.track,
    contender: input.contender.name,
    contender_version: input.contender.version,
    model: input.model.id,
    ...(input.effort ? { effort: input.effort } : {}),
    condition: input.condition,
    seed: input.seed,
    rep: input.rep,
    system_prompt: "",
    system_prompt_sha: SYSTEM_PROMPT_SHA,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    wall_ms: 0,
    outcome,
    text_tool_calls: 0,
    requests: [],
    tools: [],
    error,
  }
}

const zeroResult = (trajectory: Trajectory): LoopResult => ({
  outcome: trajectory.outcome,
  ...(trajectory.error ? { error: trajectory.error } : {}),
  turns: 0,
  toolCalls: 0,
  toolErrors: 0,
  usage: { prompt: 0, cached: 0, completion: 0, reasoning: 0, cost: 0, listCost: 0 },
  wallMs: 0,
  modelMs: 0,
  toolMs: 0,
  toolP50Ms: 0,
  toolP95Ms: 0,
  ttftMs: 0,
  modelP50Ms: 0,
  modelP95Ms: 0,
  toolTransportMs: 0,
  toolOpMs: 0,
  toolQueueMs: 0,
  toolLatencyByName: {},
  bytesToModel: 0,
  bytesFromTool: 0,
  imagesSent: 0,
  imagesDropped: 0,
  imagesBytes: 0,
  trajectory,
})

interface TrialInput {
  readonly task: Task
  readonly contender: Contender
  readonly model: ModelSpec
  readonly client: ModelClient
  readonly condition: Condition
  readonly seed: number
  readonly rep: number
  readonly runId: string
  readonly trialId: string
  readonly resultsDir: string
  readonly machineId: string
  readonly os: Os
  readonly commit: string
  readonly benchVersion: string
  readonly effort?: string
}

interface TrialOutput {
  readonly row: Row
  readonly result: LoopResult
  readonly verdict: Verdict
}

async function runTrial(input: TrialInput): Promise<TrialOutput> {
  const machine = await createMachine(input.machineId)
  const trajectoryDir = join(input.resultsDir, input.runId)
  let witness: Sentinel | undefined
  let started = false
  let result: LoopResult | undefined
  let failure: string | undefined
  let background = input.condition === "background" ? UNMEASURED_BACKGROUND : ZERO_BACKGROUND

  try {
    await input.task.setup(machine, input.seed)
    await input.contender.start(machine, input.condition)
    started = true
    if (input.condition === "background") witness = await startSentinel(machine)
    result = await runLoop({
      task: input.task,
      contender: input.contender,
      model: input.model,
      client: input.client,
      runId: input.runId,
      trialId: input.trialId,
      trajectoryDir,
      condition: input.condition,
      seed: input.seed,
      rep: input.rep,
    })
  } catch (caught) {
    failure = caught instanceof Error ? caught.message : String(caught)
  }

  if (witness) {
    background = await witness
      .stop()
      .then((measured) => measured.background)
      .catch(() => UNMEASURED_BACKGROUND)
  }
  if (started) await input.contender.stop().catch(() => undefined)

  let verdict: Verdict
  try {
    verdict = await input.task.check(machine, input.seed)
  } catch (caught) {
    verdict = {
      pass: false,
      checks: [{ name: "checker", pass: false, detail: caught instanceof Error ? caught.message : String(caught) }],
    }
  }
  await removeMachine(machine)

  const fallback =
    result ?? zeroResult(emptyTrajectory(input, started ? "tool_crash" : "setup_error", failure ?? "unknown"))
  const passed = scored(fallback.outcome) && verdict.pass && safe(input.condition, background)
  const failClass = classifyFailure(fallback, verdict, background)
  await mkdir(trajectoryDir, { recursive: true })
  await writeFile(
    join(trajectoryDir, `${input.trialId}.json`),
    JSON.stringify({ ...fallback.trajectory, verdict }, null, 2),
    "utf8",
  )
  return { row: rowFor(input, fallback, verdict, background, passed, failClass), result: fallback, verdict }
}

function rowFor(
  input: TrialInput,
  result: LoopResult,
  verdict: Verdict,
  background: Background,
  passed: boolean,
  failClass: string,
): Row {
  return {
    run_id: input.runId,
    trial_id: input.trialId,
    ts: new Date().toISOString(),
    commit: input.commit,
    bench_version: input.benchVersion,
    task: input.task.id,
    track: input.task.track,
    held_out: input.task.heldOut ? 1 : 0,
    os: input.os,
    machine: input.machineId,
    contender: input.contender.name,
    contender_version: input.contender.version,
    model: input.model.id,
    effort: input.effort ?? "",
    condition: input.condition,
    seed: input.seed,
    rep: input.rep,
    outcome: result.trajectory.outcome,
    pass: passed ? 1 : 0,
    checks_passed: verdict.checks.filter((check) => check.pass).length,
    checks_total: verdict.checks.length,
    fail_class: failClass,
    turns: result.turns,
    tool_calls: result.toolCalls,
    tool_errors: result.toolErrors,
    tokens_in: result.usage.prompt,
    tokens_cached: result.usage.cached,
    tokens_out: result.usage.completion,
    tokens_reasoning: result.usage.reasoning,
    cost_usd: Number(result.usage.cost.toFixed(8)),
    wall_ms: result.wallMs,
    model_ms: result.modelMs,
    tool_ms: result.toolMs,
    tool_p50_ms: result.toolP50Ms,
    tool_p95_ms: result.toolP95Ms,
    bytes_to_model: result.bytesToModel,
    images_sent: result.imagesSent,
    images_dropped: result.imagesDropped,
    focus_steals: counterCell(background, "focusSteals"),
    pointer_moves: counterCell(background, "pointerMoves"),
    keys_swallowed: counterCell(background, "keysSwallowed"),
    windows_raised: counterCell(background, "windowsRaised"),
    system_prompt_sha: SYSTEM_PROMPT_SHA,
    trajectory: `${input.runId}/${input.trialId}.json`,
    ttft_ms: result.ttftMs,
    model_p50_ms: result.modelP50Ms,
    model_p95_ms: result.modelP95Ms,
    tool_transport_ms: result.toolTransportMs,
    tool_op_ms: result.toolOpMs,
    tool_queue_ms: result.toolQueueMs,
    tool_latency_by_name: JSON.stringify(result.toolLatencyByName),
    images_bytes: result.imagesBytes,
    bytes_from_tool: result.bytesFromTool,
  }
}

const configPath = (flags: Parsed["flags"]): string =>
  resolve(flagString(flags, "config") ?? join(import.meta.dirname, "..", "ci.json"))

interface CiConfig {
  readonly tracks?: readonly string[]
  readonly contenders?: readonly string[]
  readonly models?: readonly string[]
  readonly reps?: number
  readonly conditions?: readonly Condition[]
  readonly seed?: number
  readonly pattern?: string
  readonly validateRuns?: number
  readonly sentinelIdleSeconds?: number
}

const stringList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined

function readCi(flags: Parsed["flags"]): CiConfig {
  const path = configPath(flags)
  if (!existsSync(path)) throw new Error(`no CI config at ${path}`)
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  const conditions = stringList(raw.conditions)?.filter(
    (value): value is Condition => value === "foreground" || value === "background",
  )
  const validate =
    typeof raw.validate === "object" && raw.validate !== null ? (raw.validate as Record<string, unknown>) : {}
  const sentinel =
    typeof raw.sentinel === "object" && raw.sentinel !== null ? (raw.sentinel as Record<string, unknown>) : {}
  return {
    ...(stringList(raw.tracks) ? { tracks: stringList(raw.tracks) } : {}),
    ...(stringList(raw.contenders) ? { contenders: stringList(raw.contenders) } : {}),
    ...(stringList(raw.models) ? { models: stringList(raw.models) } : {}),
    ...(conditions ? { conditions } : {}),
    ...(typeof raw.reps === "number" ? { reps: raw.reps } : {}),
    ...(typeof raw.seed === "number" ? { seed: raw.seed } : {}),
    ...(typeof raw.pattern === "string" ? { pattern: raw.pattern } : {}),
    ...(typeof validate.runs === "number" ? { validateRuns: validate.runs } : {}),
    ...(typeof sentinel.idleSeconds === "number" ? { sentinelIdleSeconds: sentinel.idleSeconds } : {}),
  }
}

interface Pair {
  readonly contender: Contender
  readonly model: ModelSpec
}

interface TrackRun {
  readonly track: Track
  readonly pairs: readonly Pair[]
}

interface RunPlan {
  readonly tracks: readonly TrackRun[]
  readonly conditions: readonly Condition[]
  readonly reps: number
  readonly seed: number
  readonly pattern: string
  readonly shard: string
}

function contenderFor(name: string): Contender {
  const make = CONTENDERS[name]
  if (!make) throw new Error(`there is no contender called ${name}; known: ${Object.keys(CONTENDERS).join(", ")}`)
  return make()
}

function pairsFor(flags: Parsed["flags"], config: BenchConfig | undefined, track: Track): Pair[] {
  const names = flagString(flags, "contender") ? splitFlag(flags, "contender", "") : []
  const models = flagString(flags, "model") ? splitFlag(flags, "model", "") : []
  const configured = config?.tracks.find((entry) => entry.track === track)
  if (!configured) {
    const picked = names.length > 0 ? names : ["kiko"]
    const used = models.length > 0 ? models : ["beam-free"]
    return picked.flatMap((name) => used.map((model) => ({ contender: contenderFor(name), model: modelSpec(model) })))
  }
  const picked = names.length > 0 ? names : configured.contenders.map((entry) => entry.name)
  return picked.flatMap((name) => {
    const entry = configured.contenders.find((candidate) => candidate.name === name)
    const used = models.length > 0 ? models : entry?.models
    if (!used || used.length === 0) throw new Error(`no models are configured for ${name} on the ${track} track`)
    return used.map((model) => ({ contender: contenderFor(name), model: modelSpec(model) }))
  })
}

function buildPlan(flags: Parsed["flags"], config: BenchConfig | undefined, os: Os): RunPlan {
  const wanted = flagString(flags, "track") as Track | undefined
  const fromConfig = config?.tracks.map((entry) => entry.track) ?? []
  const candidates: Track[] = wanted ? [wanted] : fromConfig.length > 0 ? fromConfig : ["terminal"]
  const runsHere = (track: Track): boolean => {
    if (!config) return true
    return config.tracks.find((entry) => entry.track === track)?.os.includes(os) ?? false
  }
  const tracks = candidates.filter(runsHere)
  if (wanted && tracks.length === 0) throw new Error(`the ${wanted} track does not run on ${os}`)
  const condition = flagString(flags, "condition") as Condition | undefined
  return {
    tracks: tracks.map((track) => ({ track, pairs: pairsFor(flags, config, track) })),
    conditions: config && !condition ? config.conditions : [condition ?? "foreground"],
    reps: Number(flagString(flags, "reps") ?? config?.reps ?? 1),
    seed: Number(flagString(flags, "seed") ?? config?.seed ?? 1),
    pattern: flagString(flags, "task") ?? config?.pattern ?? "*",
    shard: flagString(flags, "shard") ?? "1/1",
  }
}

interface GroupInput {
  readonly tasks: readonly Task[]
  readonly track: TrackRun
  readonly plan: RunPlan
  readonly condition: Condition
  readonly dir: string
  readonly path: string
  readonly runId: string
  readonly machineId: string
  readonly os: Os
  readonly commit: string
  readonly version: string
  readonly client: ModelClient
  readonly effort?: string
}

async function runGroup(input: GroupInput): Promise<{ total: number; passed: number }> {
  let total = 0
  let passed = 0
  for (const task of input.tasks) {
    for (const { contender, model } of input.track.pairs) {
      if (task.contenders && !task.contenders.includes(contender.name)) continue
      for (let rep = 1; rep <= input.plan.reps; rep++) {
        const trialId = `${task.id}__${contender.name}__${model.id}__${input.condition}__r${rep}`
        const output = await runTrial({
          task,
          contender,
          model,
          client: input.client,
          condition: input.condition,
          seed: input.plan.seed,
          rep,
          runId: input.runId,
          trialId,
          resultsDir: input.dir,
          machineId: input.machineId,
          os: input.os,
          commit: input.commit,
          benchVersion: input.version,
          ...(input.effort ? { effort: input.effort } : {}),
        })
        await appendRow(input.path, output.row)
        total++
        if (output.row.pass === 1) passed++
        const checks = `${output.row.checks_passed}/${output.row.checks_total}`
        const label = output.row.pass === 1 ? "PASS" : "FAIL"
        console.log(`${label} ${trialId} ${output.row.outcome} ${checks} ${output.row.fail_class}`.trim())
      }
    }
  }
  return { total, passed }
}

async function run(flags: Parsed["flags"]): Promise<void> {
  const os = localOs()
  const plan = buildPlan(flags, flags.ci ? readConfig(configPath(flags)) : undefined, os)
  const dir = resultsDir(flags)
  const machineId = flagString(flags, "machine") ?? `local-${os}`
  const client = new ModelClient({ key: readKey(), version: benchVersion() })
  const runId = newRunId()
  const path = join(dir, `${runId}.tsv`)
  await writeRows(path, [])
  const commit = commitSha()
  const version = benchVersion()
  const effort = flagString(flags, "effort")
  let total = 0
  let passed = 0
  for (const track of plan.tracks) {
    const tasks = selectTasks(plan.pattern, track.track, os).filter((_, index) => inShard(index, plan.shard))
    if (tasks.length === 0) continue
    needDisplay(tasks)
    for (const condition of plan.conditions) {
      const group = await runGroup({
        tasks,
        track,
        plan,
        condition,
        dir,
        path,
        runId,
        machineId,
        os,
        commit,
        version,
        client,
        ...(effort ? { effort } : {}),
      })
      total += group.total
      passed += group.passed
    }
  }
  if (total === 0) throw new Error("no tasks match this track and machine")
  console.log(`${passed}/${total} passed`)
  console.log(path)
}

const failed = (detail: string): Verdict => ({ pass: false, checks: [{ name: "task", pass: false, detail }] })

interface Attempt {
  readonly verdict: Verdict
  readonly background: Background
}

async function attempt(
  task: Task,
  id: string,
  kind: "oracle" | "null",
  condition: Condition,
  seed: number,
): Promise<Attempt> {
  const machine = await createMachine(id)
  let witness: Sentinel | undefined
  let background = condition === "background" ? UNMEASURED_BACKGROUND : ZERO_BACKGROUND
  const release = async (): Promise<Background> => {
    if (!witness) return background
    const running = witness
    witness = undefined
    background = await running
      .stop()
      .then((measured) => measured.background)
      .catch(() => UNMEASURED_BACKGROUND)
    return background
  }
  try {
    await task.setup(machine, seed)
    if (condition === "background") witness = await startSentinel(machine)
    if (kind === "oracle") await task.oracle(machine, seed)
    background = await release()
    const verdict = await task.check(machine, seed)
    return { verdict, background }
  } catch (caught) {
    return { verdict: failed(caught instanceof Error ? caught.message : String(caught)), background: await release() }
  } finally {
    await removeMachine(machine)
  }
}

const COUNTER_COLUMNS = {
  focusSteals: "focus_steals",
  pointerMoves: "pointer_moves",
  keysSwallowed: "keys_swallowed",
  windowsRaised: "windows_raised",
} as const

const countersOf = (background: Background): string =>
  BACKGROUND_COUNTERS.map((counter) => `${COUNTER_COLUMNS[counter]}=${counterCell(background, counter)}`).join(" ")

const detailOf = (verdict: Verdict, stable: boolean, background: Background): string =>
  `${stable ? "stable" : "flaky"}: ${verdict.checks
    .map((check) => `${check.name}=${check.pass ? "pass" : "fail"} (${check.detail})`)
    .join("; ")}; ${countersOf(background)}`

const validateRow = (taskId: string, os: Os, machineId: string, kind: string, pass: boolean, detail: string): string =>
  [taskId, os, machineId, kind, pass ? "1" : "0", escape(detail)].join("\t")

const runCount = (flags: Parsed["flags"]): number => {
  const fromFlag = flagString(flags, "runs")
  return fromFlag === undefined ? readConfig(configPath(flags)).validateRuns : Number(fromFlag)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function idleGate(id: string, seconds: number): Promise<string> {
  const machine = await createMachine(id)
  try {
    const witness = await startSentinel(machine)
    await delay(seconds * 1000)
    const measured = await witness.stop()
    if (measured.keysSent === 0 || measured.keysReceived !== measured.keysSent) {
      throw new Error(
        `the sentinel received ${measured.keysReceived} of ${measured.keysSent} keys in ${seconds}s of idle, so it cannot judge the background condition`,
      )
    }
    return `${measured.keysReceived}/${measured.keysSent} keys received while idle for ${seconds}s`
  } finally {
    await removeMachine(machine)
  }
}

async function validate(flags: Parsed["flags"]): Promise<void> {
  const dir = resultsDir(flags)
  const runs = runCount(flags)
  const os = localOs()
  const machineId = flagString(flags, "machine") ?? `local-${os}`
  const condition: Condition = flagString(flags, "condition") === "background" ? "background" : "foreground"
  const seed = Number(flagString(flags, "seed") ?? 1)
  const tasks = selectTasks(flagString(flags, "task") ?? "*", flagString(flags, "track"), os)
  if (tasks.length === 0) throw new Error("no tasks match this track and machine")
  const runId = newRunId()
  const path = join(dir, `validate-${runId}.tsv`)
  const lines: string[] = []
  if (condition === "background") {
    const idleSeconds = readCi(flags).sentinelIdleSeconds ?? 30
    try {
      console.log(`OK idle: ${await idleGate(machineId, idleSeconds)}`)
    } catch (caught) {
      await mkdir(dir, { recursive: true })
      const detail = caught instanceof Error ? caught.message : String(caught)
      const row = validateRow(tasks[0]?.id ?? "*", os, machineId, "idle", false, detail)
      await writeFile(path, [VALIDATE_HEADER, row].join("\n") + "\n", "utf8")
      throw new Error(`the ${machineId} sentinel failed its idle check: ${detail}`, { cause: caught })
    }
  }
  const quarantined: string[] = []
  for (const task of tasks) {
    const oracles: Attempt[] = []
    for (let run = 0; run < Math.max(runs, 1); run++)
      oracles.push(await attempt(task, machineId, "oracle", condition, seed))
    const nothing = await attempt(task, machineId, "null", condition, seed)
    const first = oracles[0] ?? { verdict: failed("no oracle run"), background: ZERO_BACKGROUND }
    const seen = oracles.map((entry) => JSON.stringify(entry.verdict.checks.map((check) => [check.name, check.pass])))
    const stable = seen.every((value) => value === seen[0])
    const clean = oracles.every((entry) => safe(condition, entry.background))
    const good = first.verdict.pass && stable && clean && !nothing.verdict.pass
    lines.push(
      validateRow(
        task.id,
        os,
        machineId,
        "oracle",
        first.verdict.pass && stable && clean,
        detailOf(first.verdict, stable, first.background),
      ),
      validateRow(
        task.id,
        os,
        machineId,
        "null",
        !nothing.verdict.pass && safe(condition, nothing.background),
        detailOf(nothing.verdict, true, nothing.background),
      ),
    )
    if (!good) quarantined.push(task.id)
    console.log(`${good ? "OK" : "QUARANTINE"} ${task.id}`)
  }
  await mkdir(dir, { recursive: true })
  await writeFile(path, [VALIDATE_HEADER, ...lines].join("\n") + "\n", "utf8")
  console.log(`${tasks.length} tasks, ${quarantined.length} quarantined`)
  console.log(path)
  if (quarantined.length > 0) {
    console.log(`quarantined: ${quarantined.join(", ")}`)
    process.exitCode = 1
  }
}

function expand(pattern: string): string[] {
  if (!/[*?]/.test(pattern)) return [resolve(pattern)]
  return [...new Bun.Glob(pattern).scanSync({ cwd: process.cwd(), absolute: true })]
}

async function report(positionals: readonly string[], flags: Parsed["flags"]): Promise<void> {
  const patterns = positionals.length > 0 ? positionals : ["results/*.tsv"]
  const files = patterns
    .flatMap(expand)
    .filter((file) => basename(file).endsWith(".tsv") && !basename(file).startsWith("validate-"))
  if (files.length === 0) throw new Error("no result TSVs matched")
  const rows: Row[] = []
  const used: string[] = []
  for (const file of files) {
    try {
      rows.push(...(await readRows(file)))
      used.push(basename(file))
    } catch (error) {
      console.log(`skipping ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (rows.length === 0) throw new Error("no bench ledgers among the matched files")
  const out = resolve(flagString(flags, "out") ?? join("reports", `bench-${newRunId()}.html`))
  const html = renderReport(rows, {
    generatedAt: new Date().toISOString(),
    sources: used,
  })
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html, "utf8")
  console.log(`${rows.length} rows from ${used.length} files`)
  console.log(out)
}

async function pull(runId: string): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), "kiko-bench-pull-"))
  try {
    const download = spawnSync("gh", ["run", "download", runId, "-p", "bench-*", "-D", staging], { encoding: "utf8" })
    if (download.status !== 0) throw new Error(`gh run download failed: ${download.stderr.trim()}`)
    const appended = await harvestArtifacts(staging, PLANS, runId)
    await appendIndex(PLANS, appended)
    console.log(`pulled ${appended.length} result files into ${PLANS}`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function groupByKind<T extends { kind: string }>(items: readonly T[]): Record<string, T[]> {
  return {
    host: items.filter((item) => item.kind === "host"),
    container: items.filter((item) => item.kind === "container"),
    vm: items.filter((item) => item.kind === "vm"),
  }
}

function plan(flags: Parsed["flags"]): void {
  const config = readConfig(configPath(flags))
  if (flags.validate) {
    const envs = config.envs.map((env) => ({
      env: env.id,
      os: env.os,
      machine: env.machine,
      runner: env.runner,
      kind: env.kind,
      display: env.display,
      ...(env.image ? { image: env.image } : {}),
    }))
    console.log(JSON.stringify(groupByKind(envs)))
    return
  }
  const wanted = splitFlag(flags, "track", "")
  const models = splitFlag(flags, "model", "")
  const envs = splitFlag(flags, "env", "")
  const tracks = wanted.length > 0 ? config.tracks.filter((track) => wanted.includes(track.track)) : config.tracks
  const jobs = planJobs({ ...config, tracks }, TASKS).filter(
    (job) => (models.length === 0 || models.includes(job.model)) && (envs.length === 0 || envs.includes(job.env)),
  )
  console.log(JSON.stringify(groupByKind(jobs)))
}

async function main(): Promise<void> {
  clearGitHookEnv()
  const parsed = parseArgs(process.argv.slice(2))
  switch (parsed.command) {
    case "list":
      return list(parsed.flags)
    case "plan":
      return plan(parsed.flags)
    case "validate":
      return validate(parsed.flags)
    case "run":
      return run(parsed.flags)
    case "report":
      return report(parsed.positionals, parsed.flags)
    case "pull": {
      const runId = parsed.positionals[0]
      if (!runId) throw new Error("bench pull needs a gh run id")
      return pull(runId)
    }
    default:
      console.log(
        [
          "bun bench list [--track t] [--os o]",
          "bun bench plan [--config apps/bench/baseline.json]",
          "bun bench validate --task <glob> [--runs 10]",
          "bun bench run --contender kiko --model beam-free --track terminal --reps 5 --condition foreground --seed 1 --machine <id>",
          "bun bench report results/*.tsv --out reports/<name>.html",
          "bun bench pull <gh-run-id>",
        ].join("\n"),
      )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
