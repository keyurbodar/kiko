import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { Exec, Machine, Os } from "../src/types"

const detectOs = (): Os =>
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

const collect = (child: ChildProcess): Promise<Exec> =>
  new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })

export const localMachine = (workdir: string): Machine => ({
  os: detectOs(),
  id: `local-${process.platform}-${process.arch}`,
  workdir,
  exec: async (cmd, opts) => {
    const child = spawn(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts?.cwd ?? workdir,
      env: { ...process.env, ...opts?.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const timer = opts?.timeoutMs === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs)
    try {
      return await collect(child)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  },
  spawn: async (cmd, opts) => {
    const logPath = `${workdir}/spawn.log`
    await mkdir(dirname(logPath), { recursive: true })
    const child = spawn(cmd[0] ?? "", cmd.slice(1), {
      cwd: opts?.cwd ?? workdir,
      env: { ...process.env, ...opts?.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })
    const append = (chunk: Buffer): void => {
      void writeFile(logPath, chunk, { flag: "a" }).catch(() => undefined)
    }
    child.stdout?.on("data", append)
    child.stderr?.on("data", append)
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    return {
      pid: child.pid ?? 0,
      stop: async () => {
        if (child.exitCode !== null) return
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
        } else if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGTERM")
          } catch {
            child.kill("SIGTERM")
          }
        }
        await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))])
        if (child.exitCode === null) {
          try {
            process.kill(-(child.pid ?? 0), "SIGKILL")
          } catch {
            child.kill("SIGKILL")
          }
        }
        await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 2_000))])
        child.stdout?.destroy()
        child.stderr?.destroy()
      },
    }
  },
  readText: async (path) => {
    try {
      return await readFile(path, "utf8")
    } catch {
      return undefined
    }
  },
  writeText: async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  },
})
