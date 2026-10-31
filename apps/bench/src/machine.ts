import { execFile, spawnSync, spawn as spawnProcess } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Exec, Machine, Os } from "./types"

const DEFAULT_TIMEOUT_MS = 120_000

const GIT_HOOK_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
]

export function clearGitHookEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of GIT_HOOK_ENV) delete env[key]
}

function commandEnv(extra?: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...extra }
  for (const key of GIT_HOOK_ENV) delete env[key]
  return env
}

export function localOs(platform: string = process.platform): Os {
  if (platform === "darwin") return "macos"
  if (platform === "win32") return "windows"
  return "linux"
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" })
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

function run(
  file: string,
  args: readonly string[],
  opts: { cwd: string; env: Record<string, string | undefined>; timeoutMs: number },
): Promise<Exec> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })
}

class LocalMachine implements Machine {
  readonly os: Os
  readonly id: string
  readonly workdir: string

  constructor(id: string, workdir: string) {
    this.os = localOs()
    this.id = id
    this.workdir = workdir
  }

  exec(
    cmd: readonly string[],
    opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<Exec> {
    return run(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts.cwd ?? this.workdir,
      env: commandEnv(opts.env),
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
  }

  async spawn(
    cmd: readonly string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<{ pid: number; stop(): Promise<void> }> {
    const child = spawnProcess(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts.cwd ?? this.workdir,
      env: commandEnv(opts.env),
      stdio: "ignore",
      detached: process.platform !== "win32",
    })
    const pid = child.pid
    if (pid === undefined) throw new Error(`could not start ${cmd[0] ?? "the command"}`)
    return {
      pid,
      stop: async () => {
        killTree(pid)
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
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, "utf8")
  }
}

export async function createMachine(id = `local-${localOs()}`): Promise<Machine> {
  const workdir = await mkdtemp(join(tmpdir(), "kiko-bench-"))
  return new LocalMachine(id, workdir)
}

export async function removeMachine(m: Machine): Promise<void> {
  await rm(m.workdir, { recursive: true, force: true })
}
