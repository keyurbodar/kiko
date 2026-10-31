import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Exec, Machine, Os } from "../types"

const os = (): Os => (process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux")

const killTree = (pid: number, signal: NodeJS.Signals): void => {
  try {
    if (process.platform === "win32") process.kill(pid, signal)
    else process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {}
  }
}

export class LocalMachine implements Machine {
  readonly os = os()
  readonly id = `local-${this.os}`
  readonly workdir: string
  private readonly children = new Set<number>()

  constructor(workdir: string) {
    this.workdir = workdir
  }

  async exec(
    cmd: readonly string[],
    opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<Exec> {
    return new Promise((resolve) => {
      const child = spawn(cmd[0] ?? "", cmd.slice(1), {
        cwd: opts.cwd ?? this.workdir,
        env: { ...process.env, ...opts.env },
        detached: process.platform !== "win32",
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk))
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk))
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            killTree(child.pid ?? 0, "SIGKILL")
          }, opts.timeoutMs)
        : undefined
      child.on("error", (error) => {
        if (timer) clearTimeout(timer)
        resolve({ code: 127, stdout: "", stderr: error.message })
      })
      child.on("close", (code) => {
        if (timer) clearTimeout(timer)
        resolve({
          code: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        })
      })
    })
  }

  async spawn(
    cmd: readonly string[],
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<{ pid: number; stop(): Promise<void> }> {
    const log = openSync(join(this.workdir, ".spawn.log"), "a")
    const child = spawn(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts.cwd ?? this.workdir,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", log, log],
      detached: process.platform !== "win32",
    })
    closeSync(log)
    const pid = child.pid ?? 0
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve())
      child.once("error", (error) => reject(new Error(`spawn ${cmd[0]} failed: ${error.message}`)))
    })
    this.children.add(pid)
    return {
      pid,
      stop: async () => {
        this.children.delete(pid)
        killTree(pid, "SIGTERM")
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
    await writeFile(path, text)
  }

  async dispose(): Promise<void> {
    for (const pid of this.children) killTree(pid, "SIGKILL")
    this.children.clear()
    await rm(this.workdir, { recursive: true, force: true })
  }
}

export const createMachine = async (): Promise<LocalMachine> => {
  const workdir = await mkdtemp(join(tmpdir(), "kiko-bench-"))
  return new LocalMachine(workdir)
}
