import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"
import type { Background, Exec, Machine, Os } from "../types"
import { movePointer, startSentinel } from "./index"
import { parseEvents, witness, type Witness } from "./witness"

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(SOURCE_DIR, "..", "..", "fixtures", "sentinel")

interface Options {
  readonly cwd?: string
  readonly env?: Record<string, string>
  readonly timeoutMs?: number
}

class LocalMachine implements Machine {
  readonly os: Os
  readonly id: string
  readonly workdir: string

  constructor(workdir: string) {
    this.workdir = workdir
    this.os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
    this.id = `ci-${this.os}`
  }

  exec(cmd: readonly string[], options: Options = {}): Promise<Exec> {
    return new Promise((resolve) => {
      execFile(
        cmd[0] ?? "",
        cmd.slice(1),
        {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          timeout: options.timeoutMs ?? 120_000,
          maxBuffer: 8 << 20,
        },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1
          resolve({ code, stdout, stderr })
        },
      )
    })
  }

  async spawn(cmd: readonly string[], options: Options = {}): Promise<{ pid: number; stop(): Promise<void> }> {
    const child = Bun.spawn([cmd[0] ?? "", ...cmd.slice(1)], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return {
      pid: child.pid,
      stop: async () => {
        child.kill()
        await child.exited
      },
    }
  }

  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8")
    } catch {
      return undefined
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await writeFile(path, text)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function otherWindowBinary(m: Machine): Promise<string> {
  const fromEnv = process.env.KIKO_OTHER_WINDOW_BIN
  if (fromEnv) return fromEnv
  const out = join(m.workdir, "OtherWindow")
  const build = await m.exec(["swiftc", "-O", join(FIXTURES, "macos", "OtherWindow.swift"), "-o", out], {
    timeoutMs: 300_000,
  })
  if (build.code !== 0) throw new Error(`other window build failed: ${build.stderr}`)
  return out
}

type Cleanup = () => Promise<void>

async function noop(): Promise<void> {}

async function stealFocus(m: Machine): Promise<Cleanup> {
  switch (m.os) {
    case "macos": {
      const binary = await otherWindowBinary(m)
      const other = await m.spawn([binary, "--seconds", "12"], { cwd: m.workdir })
      await delay(2000)
      return () => other.stop()
    }
    case "windows": {
      const script = join(FIXTURES, "windows", "OtherWindow.ps1")
      const other = await m.spawn(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Seconds", "12"],
        { cwd: m.workdir },
      )
      await delay(2500)
      return () => other.stop()
    }
    case "linux": {
      const other = await m.spawn(["xmessage", "-buttons", "OK:0", "-center", "other window"], {
        cwd: m.workdir,
      })
      await delay(800)
      const activated = await m.exec([
        "xdotool",
        "search",
        "--sync",
        "--name",
        "other window",
        "windowactivate",
        "--sync",
      ])
      if (activated.code !== 0) throw new Error(`xdotool failed: ${activated.stderr}`)
      await delay(1200)
      return () => other.stop()
    }
    default: {
      const exhaustive: never = m.os
      throw new Error(`no focus steal for ${exhaustive}`)
    }
  }
}

async function writeFileElsewhere(m: Machine): Promise<Cleanup> {
  const target = join(m.workdir, "background.txt")
  const cmd =
    m.os === "windows"
      ? ["powershell.exe", "-NoProfile", "-Command", `Set-Content -Path '${target}' -Value background`]
      : ["sh", "-c", `printf background > '${target}'`]
  const run = await m.exec(cmd)
  if (run.code !== 0) throw new Error(`background write failed: ${run.stderr}`)
  return noop
}

type CaseName = "idle" | "steal" | "pointer" | "file"

interface CaseResult {
  readonly case: CaseName
  readonly pass: boolean
  readonly failures: readonly string[]
  readonly background: Background
  readonly keysSent: number
  readonly keysReceived: number
  readonly samples: number
}

function allZero(background: Background): boolean {
  return (
    background.focusSteals === 0 &&
    background.pointerMoves === 0 &&
    background.keysSwallowed === 0 &&
    background.windowsRaised === 0
  )
}

function judge(name: CaseName, result: Witness, seconds: number): string[] {
  const failures: string[] = []
  const background = result.background
  if (name === "idle" || name === "file") {
    if (!allZero(background)) failures.push(`counters not zero: ${JSON.stringify(background)}`)
    if (result.keysSent < seconds - 2) failures.push(`only ${result.keysSent} keys sent`)
    if (result.keysReceived !== result.keysSent) {
      failures.push(`${result.keysSent - result.keysReceived} keys not received`)
    }
  }
  if (name === "steal" && background.focusSteals < 1) {
    failures.push("focus steal was not witnessed")
  }
  if (name === "pointer" && background.pointerMoves < 1) {
    failures.push("pointer move was not witnessed")
  }
  if (!result.ready) failures.push("sentinel never reported ready")
  return failures
}

async function runCase(
  name: CaseName,
  idleSeconds: number,
  caseSeconds: number,
  logs: string,
  action: (m: Machine) => Promise<Cleanup>,
): Promise<CaseResult> {
  const workdir = await mkdtemp(join(tmpdir(), "kiko-sentinel-"))
  try {
    const m = new LocalMachine(workdir)
    const seconds = name === "idle" ? idleSeconds : caseSeconds
    const sentinel = await startSentinel(m)
    let cleanup: Cleanup = noop
    try {
      cleanup = await action(m)
      await delay(seconds * 1000)
    } finally {
      await sentinel.stop()
      await cleanup()
    }
    const raw = (await m.readText(join(workdir, "sentinel.jsonl"))) ?? ""
    await writeFile(join(logs, `${name}.jsonl`), raw)
    const events = parseEvents(raw)
    const result = witness(events)
    const failures = judge(name, result, seconds)
    return {
      case: name,
      pass: failures.length === 0,
      failures,
      background: result.background,
      keysSent: result.keysSent,
      keysReceived: result.keysReceived,
      samples: result.samples,
    }
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: "sentinel.json" },
      "idle-seconds": { type: "string", default: "30" },
      "case-seconds": { type: "string", default: "4" },
      logs: { type: "string", default: "sentinel-logs" },
    },
  })
  const idleSeconds = Number(values["idle-seconds"])
  const caseSeconds = Number(values["case-seconds"])
  const logs = values.logs
  await mkdir(logs, { recursive: true })
  const os: Os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
  const cases: CaseResult[] = []
  cases.push(await runCase("idle", idleSeconds, caseSeconds, logs, async () => noop))
  cases.push(await runCase("steal", idleSeconds, caseSeconds, logs, stealFocus))
  cases.push(
    await runCase("pointer", idleSeconds, caseSeconds, logs, async (m) => {
      await movePointer(m, 160, 120)
      return noop
    }),
  )
  cases.push(await runCase("file", idleSeconds, caseSeconds, logs, writeFileElsewhere))
  const pass = cases.every((entry) => entry.pass)
  const report = { os, machine: `ci-${os}`, idleSeconds, pass, cases }
  const text = JSON.stringify(report, null, 2)
  await writeFile(values.out, text)
  process.stdout.write(`${text}\n`)
  process.exitCode = pass ? 0 : 1
}

await main()
