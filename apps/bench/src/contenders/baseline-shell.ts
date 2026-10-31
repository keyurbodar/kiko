import type { Contender, Machine, ToolResult, ToolSpec } from "../types"

const MAX_OUTPUT_CHARS = 12_000
const TIMEOUT_MS = 120_000

const DESCRIPTION =
  "run one command line on the machine and return its exit code and the end of its output. it runs /bin/sh -lc, so write the command for that shell. it starts in the working directory."

const TOOLS: readonly ToolSpec[] = [
  {
    name: "shell",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "the whole command line" },
      },
      required: ["command"],
    },
  },
]

const tail = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value

export function baselineShell(): Contender {
  let machine: Machine | undefined

  return {
    name: "baseline-shell",
    version: "1",
    tracks: ["terminal", "mixed"],
    async start(m: Machine): Promise<void> {
      machine = m
    },
    tools(): readonly ToolSpec[] {
      return TOOLS
    },
    async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
      if (name !== "shell") return { text: `there is no tool called ${name}`, images: [], isError: true }
      if (!machine) return { text: "the contender has not started", images: [], isError: true }
      const command = typeof args === "object" && args !== null ? (args as Record<string, unknown>).command : undefined
      if (typeof command !== "string" || command.length === 0)
        return { text: "shell needs a command", images: [], isError: true }
      if (signal.aborted) return { text: "the call was cancelled", images: [], isError: true }
      const out = await machine.exec(["/bin/sh", "-lc", command], {
        cwd: machine.workdir,
        timeoutMs: TIMEOUT_MS,
      })
      const body = [out.stdout.trim(), out.stderr.trim()].filter(Boolean).join("\n")
      return {
        text: `exit code ${out.code}\n\n${body ? tail(body) : "(no output)"}`,
        images: [],
        isError: out.code !== 0,
      }
    },
    async stop(): Promise<void> {
      machine = undefined
    },
  }
}
