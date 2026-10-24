import { basename, dirname } from "node:path"
import { failureMessage, type Logger } from "./log"
import { LABEL } from "./service"

const FIRST_BACKOFF_MS = 15 * 60_000
const MAX_BACKOFF_MS = 12 * 60 * 60_000
const FETCH_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 10 * 60_000

export type Attempts = {
  tried: ReadonlySet<string>
  installed: string | null
  failures: number
  retryAt: number
}

export const NO_ATTEMPTS: Attempts = { tried: new Set(), installed: null, failures: 0, retryAt: 0 }

export type UpdateStep =
  | { kind: "stay" }
  | { kind: "idle" }
  | { kind: "wait"; until: number }
  | { kind: "install"; version: string }
  | { kind: "restart"; version: string }

export function nextStep(
  attempts: Attempts,
  input: { served: string | undefined; running: string; busy: boolean; now: number },
): UpdateStep {
  if (attempts.installed) return input.busy ? { kind: "idle" } : { kind: "restart", version: attempts.installed }
  const { served } = input
  if (!served || served === input.running || attempts.tried.has(served)) return { kind: "stay" }
  if (input.now < attempts.retryAt) return { kind: "wait", until: attempts.retryAt }
  return input.busy ? { kind: "idle" } : { kind: "install", version: served }
}

export function started(attempts: Attempts, version: string): Attempts {
  return { ...attempts, tried: new Set([...attempts.tried, version]) }
}

export function installed(attempts: Attempts, version: string): Attempts {
  return { ...attempts, installed: version }
}

export function failed(attempts: Attempts, now: number): Attempts {
  const failures = attempts.failures + 1
  return {
    ...attempts,
    tried: new Set(),
    failures,
    retryAt: now + Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** (failures - 1)),
  }
}

type Target = { home: string } | { skip: string }

export function updateTarget(execPath: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Target {
  if (platform === "win32")
    return {
      skip: "Windows starts kiko-computer from a Run key with nothing to restart it; run the install.ps1 command again",
    }
  if (basename(execPath) !== "kiko-computer" || basename(dirname(execPath)) !== "bin")
    return { skip: `this daemon runs from ${execPath}, not an installed bin/kiko-computer` }
  const supervised = platform === "darwin" ? env.XPC_SERVICE_NAME === LABEL : Boolean(env.INVOCATION_ID)
  if (!supervised) return { skip: "it was not started by kiko-computer service install, so nothing would restart it" }
  return { home: dirname(dirname(execPath)) }
}

export type Updater = { offer(version: string | undefined): void; idle(): void }

type UpdaterDeps = {
  log: Logger
  origin: string
  running: string
  target: Target
  busy(): boolean
  restart(): void
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const { log, running } = deps
  let attempts = NO_ATTEMPTS
  let served: string | undefined
  let installing = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const install = async (version: string, home: string) => {
    installing = true
    attempts = started(attempts, version)
    log.info(`update: the worker serves ${version} and this daemon is ${running}; running its install.sh`)
    try {
      await runInstallScript(deps.origin, home, log)
      attempts = installed(attempts, version)
      log.info(`update: installed ${version}`)
    } catch (error) {
      attempts = failed(attempts, Date.now())
      log.error(`update: ${version} failed, still running ${running}: ${failureMessage(error)}`)
    } finally {
      installing = false
    }
  }

  const check = () => {
    if (installing) return
    const step = nextStep(attempts, { served, running, busy: deps.busy(), now: Date.now() })
    if (step.kind === "idle") return log.info("update: waiting for running calls to finish")
    if (step.kind === "wait") {
      clearTimeout(timer)
      timer = setTimeout(check, step.until - Date.now())
      return log.info(`update: retrying after ${new Date(step.until).toISOString()}`)
    }
    if (step.kind === "restart") {
      log.info(`update: exiting so the service starts ${step.version}`)
      return deps.restart()
    }
    if (step.kind !== "install") return
    if ("skip" in deps.target) {
      attempts = started(attempts, step.version)
      return log.warn(`update: the worker serves ${step.version} and this daemon is ${running}; ${deps.target.skip}`)
    }
    void install(step.version, deps.target.home).then(check)
  }

  return {
    offer(version) {
      if (version !== undefined) served = version
      check()
    },
    idle: check,
  }
}

async function runInstallScript(origin: string, home: string, log: Logger): Promise<void> {
  const url = new URL("pc/install.sh", `${origin}/`)
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const script = await response.text()
  const proc = Bun.spawn(["sh", "-s"], {
    stdin: new TextEncoder().encode(script),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, KIKO_COMPUTER_HOME: home },
    timeout: INSTALL_TIMEOUT_MS,
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  for (const line of `${out}\n${err}`.split("\n").filter(Boolean)) log.info(`update: ${line}`)
  if (code !== 0) throw new Error(`install.sh exited with ${code}`)
}
