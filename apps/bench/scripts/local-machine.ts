import { execFile, spawn, spawnSync, type ChildProcess, type ExecException } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Exec, Machine, Os } from "../src/types"

const STOP_GRACE_MS = 5_000

export function currentOs(): Os {
  if (process.platform === "darwin") return "macos"
  if (process.platform === "win32") return "windows"
  return "linux"
}

function exitCodeOf(error: ExecException | null): number {
  if (!error) return 0
  return typeof error.code === "number" ? error.code : -1
}

function stopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve()
    }, STOP_GRACE_MS)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function terminate(child: ChildProcess): Promise<void> {
  if (process.platform === "win32" && child.pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
    return stopped(child)
  }
  child.kill("SIGTERM")
  return stopped(child)
}

export class LocalMachine implements Machine {
  readonly os: Os
  readonly id: string
  readonly workdir: string
  readonly children = new Set<ChildProcess>()

  private constructor(os: Os, id: string, workdir: string) {
    this.os = os
    this.id = id
    this.workdir = workdir
  }

  static async create(id: string): Promise<LocalMachine> {
    const workdir = await mkdtemp(join(tmpdir(), "kiko-bench-"))
    return new LocalMachine(currentOs(), id, workdir)
  }

  exec(
    cmd: readonly string[],
    opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<Exec> {
    return new Promise((resolve) => {
      execFile(
        cmd[0] ?? "",
        cmd.slice(1),
        {
          cwd: opts.cwd ?? this.workdir,
          env: { ...process.env, ...opts.env },
          timeout: opts.timeoutMs ?? 120_000,
          maxBuffer: 64 << 20,
          encoding: "utf8",
        },
        (error, stdout, stderr) => resolve({ code: exitCodeOf(error), stdout, stderr }),
      )
    })
  }

  async spawn(
    cmd: readonly string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<{ pid: number; stop(): Promise<void> }> {
    const child = spawn(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts.cwd ?? this.workdir,
      env: { ...process.env, ...opts.env },
      stdio: "ignore",
    })
    this.children.add(child)
    child.once("exit", () => this.children.delete(child))
    return {
      pid: child.pid ?? -1,
      stop: async () => {
        await terminate(child)
        this.children.delete(child)
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

  async cleanup(): Promise<void> {
    await Promise.all([...this.children].map((child) => terminate(child)))
    this.children.clear()
    await rm(this.workdir, { recursive: true, force: true })
  }
}
