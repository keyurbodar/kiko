import { watch, type FSWatcher } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createServer } from "node:net"

import type { Machine } from "../../types"
import { PROVIDER_INSTANCE_ID, PROVIDER_MODEL, T3_SOURCE_SHA, T3_VERSION } from "./constants"
import { installT3 } from "./install"
import { connectMcp, type McpCallResult, type McpSession, type McpTool } from "./mcp"
import { startRelay, type RelayServer } from "./relay"
import { settingsJson } from "./settings"

export interface T3Session {
  readonly bin: string
  readonly version: string
  readonly baseDir: string
  readonly workspace: string
  readonly threadId: string
  readonly tools: readonly McpTool[]
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallResult>
  stop(): Promise<void>
}

export interface T3SessionOptions {
  readonly machine: Machine
  readonly workspace?: string
  readonly cacheDir?: string
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 240_000

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const settleWithin = async (promise: Promise<unknown>, ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    promise.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    }),
  ])
  if (timer !== undefined) clearTimeout(timer)
}

const freePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === "string") throw new Error("could not reserve a port")
  return address.port
}

const readIfPresent = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

const waitForFile = async (directory: string, fileName: string, timeoutMs: number): Promise<string> => {
  const target = join(directory, fileName)
  const existing = await readIfPresent(target)
  if (existing !== undefined) return existing
  return new Promise<string>((resolve, reject) => {
    let watcher: FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (contents: string): void => {
      if (timer !== undefined) clearTimeout(timer)
      watcher?.close()
      resolve(contents)
    }
    const fail = (error: Error): void => {
      if (timer !== undefined) clearTimeout(timer)
      watcher?.close()
      reject(error)
    }
    const check = async (): Promise<void> => {
      const contents = await readIfPresent(target)
      if (contents !== undefined) done(contents)
    }
    timer = setTimeout(() => fail(new Error(`waiting for ${fileName} timed out after ${timeoutMs}ms`)), timeoutMs)
    watcher = watch(directory, (_event, changed) => {
      if (changed === null || changed === fileName) void check()
    })
    watcher.on("error", fail)
    void check()
  })
}

const run = async (m: Machine, cmd: readonly string[], timeoutMs: number): Promise<string> => {
  const result = await m.exec(cmd, { timeoutMs })
  if (result.code !== 0) {
    throw new Error(`${cmd.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseThreadId = (stdout: string): string => {
  for (const line of stdout.trim().split("\n").toReversed()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (isRecord(parsed) && typeof parsed.threadId === "string") return parsed.threadId
  }
  throw new Error(`t3 thread start printed no thread id: ${stdout.slice(0, 400)}`)
}

export const startT3Session = async (options: T3SessionOptions): Promise<T3Session> => {
  if (process.versions.bun === undefined) {
    throw new Error("the t3code contender runs its ACP shim with bun; start the bench with bun")
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const machine = options.machine
  const installed = await installT3(machine, options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir })
  const workspace = options.workspace ?? join(machine.workdir, "workspace")
  const baseDir = join(machine.workdir, "t3home")
  const stateDir = join(baseDir, "userdata")
  await run(machine, ["mkdir", "-p", stateDir, workspace], timeoutMs)
  await run(machine, ["git", "init", "-q", workspace], timeoutMs)

  const relay: RelayServer = await startRelay()
  const shimPath = join(import.meta.dir, "shim.ts")
  await machine.writeText(
    join(stateDir, "settings.json"),
    settingsJson({
      shimCommand: process.execPath,
      shimArgs: [shimPath],
      environment: [
        { name: "KIKO_BENCH_RELAY", value: relay.address },
        { name: "KIKO_BENCH_RELAY_TOKEN", value: relay.token },
      ],
    }),
  )
  await run(machine, [installed.bin, "project", "add", workspace, "--base-dir", baseDir], timeoutMs)

  const port = await freePort()
  const server = await machine.spawn(
    [installed.bin, "serve", "--base-dir", baseDir, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    { cwd: workspace },
  )

  let mcp: McpSession | undefined
  try {
    await waitForFile(stateDir, "server-runtime.json", timeoutMs)
    const threadOutput = await run(
      machine,
      [
        installed.bin,
        "thread",
        "start",
        workspace,
        "t3code contender handshake",
        "--provider",
        PROVIDER_INSTANCE_ID,
        "--model",
        PROVIDER_MODEL,
        "--base-dir",
        baseDir,
        "--json",
      ],
      timeoutMs,
    )
    const threadId = parseThreadId(threadOutput)
    const credential = await withTimeout(relay.credential, timeoutMs, "t3code MCP credential")
    mcp = await connectMcp({
      endpoint: credential.endpoint,
      authorization: credential.authorization,
      clientName: "kiko-bench",
    })
    const tools = await mcp.listTools()
    const session: T3Session = {
      bin: installed.bin,
      version: `t3-${T3_VERSION}+sha256:${installed.sha256.slice(0, 12)}+src:${T3_SOURCE_SHA.slice(0, 8)}`,
      baseDir,
      workspace,
      threadId,
      tools,
      callTool: (name, args, signal) => {
        if (mcp === undefined) throw new Error("t3code session is closed")
        return mcp.callTool(name, args, signal)
      },
      stop: async () => {
        await mcp?.close().catch(() => undefined)
        mcp = undefined
        await relay.close()
        await settleWithin(server.stop(), 20_000)
      },
    }
    return session
  } catch (error) {
    await mcp?.close().catch(() => undefined)
    await relay.close().catch(() => undefined)
    await settleWithin(server.stop(), 20_000)
    throw error
  }
}
