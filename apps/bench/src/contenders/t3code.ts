import type { Condition, Contender, Machine, ToolResult, ToolSpec, Track } from "../types"
import { startT3Session, type T3Session } from "./t3code/session"
import { assertSchemaSnapshot } from "./t3code/snapshot"
import { agentTools, bashToolSpec, execText, toToolResult } from "./t3code/tools"

const TRACKS: readonly Track[] = ["terminal", "browser"]
const BASH_TIMEOUT_MS = 120_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const createT3CodeContender = (): Contender => {
  let machine: Machine | undefined
  let session: T3Session | undefined
  let tools: readonly ToolSpec[] = []

  const requireSession = (): T3Session => {
    if (session === undefined) throw new Error("t3code contender has not started")
    return session
  }

  const runBash = async (m: Machine, args: unknown, signal: AbortSignal): Promise<ToolResult> => {
    if (signal.aborted) return { text: "the call was cancelled", images: [], isError: true }
    const command = isRecord(args) && typeof args.command === "string" ? args.command : undefined
    if (command === undefined) {
      return { text: "bash needs a string command.", images: [], isError: true }
    }
    const result =
      m.os === "windows"
        ? await m.exec(["powershell", "-NoProfile", "-Command", command], {
            cwd: m.workdir,
            timeoutMs: BASH_TIMEOUT_MS,
          })
        : await m.exec(["/bin/sh", "-lc", command], { cwd: m.workdir, timeoutMs: BASH_TIMEOUT_MS })
    return { text: execText(result.code, result.stdout, result.stderr), images: [], isError: result.code !== 0 }
  }

  return {
    name: "t3code",
    get version() {
      return session?.version ?? "not-started"
    },
    tracks: TRACKS,
    start: async (m, _condition: Condition) => {
      machine = m
      const started = await startT3Session({ machine: m })
      const drift = assertSchemaSnapshot(started.tools)
      if (drift.length > 0) {
        await started.stop()
        throw new Error(`t3 ${started.version} tool schemas drifted: ${drift.join("; ")}`)
      }
      session = started
      tools = [bashToolSpec(m.os), ...agentTools(started.tools)]
    },
    tools: () => tools,
    call: async (name, args, signal) => {
      const active = requireSession()
      const target = machine
      if (target === undefined) throw new Error("t3code contender has not started")
      if (name === "bash") return runBash(target, args, signal)
      if (!tools.some((tool) => tool.name === name)) {
        return { text: `${name} is not a t3code tool`, images: [], isError: true }
      }
      const result = await active.callTool(name, args, signal)
      return toToolResult(result)
    },
    stop: async () => {
      const active = session
      session = undefined
      tools = []
      await active?.stop()
    },
  }
}
