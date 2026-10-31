import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import type { Condition, Contender, Exec, Image, Machine, ToolResult, ToolSpec, Track } from "../types"

const BINARY_ENV = "KIKO_BENCH_AGENT_DESKTOP"
let sessions = 0

type Args = Record<string, unknown>

function str(args: Args, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`agent-desktop: ${key} must be a non-empty string`)
  return value
}

function optStr(args: Args, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function optNum(args: Args, key: string): number | undefined {
  const value = args[key]
  return typeof value === "number" ? value : undefined
}

function withValue(flag: string, value: string | number | undefined): string[] {
  return value === undefined ? [] : [flag, String(value)]
}

function withFlag(flag: string, enabled: boolean | undefined): string[] {
  return enabled ? [flag] : []
}

const COMMANDS: Record<string, (args: Args) => string[]> = {
  list_apps: () => ["list-apps"],
  list_windows: (args) => ["list-windows", ...withValue("--app", optStr(args, "app"))],
  launch: (args) => [
    "launch",
    str(args, "app"),
    ...withFlag("--activate", args.activate === true),
    ...withValue("--wait-for", optStr(args, "wait_for")),
    ...withValue("--arg", optStr(args, "arg")),
  ],
  snapshot: (args) => [
    "snapshot",
    ...withValue("--app", optStr(args, "app")),
    ...withValue("--window-id", optStr(args, "window_id")),
    ...withValue("--max-depth", optNum(args, "max_depth")),
    ...withFlag("--interactive-only", args.interactive !== false),
    ...withValue("--timeout-ms", optNum(args, "timeout_ms")),
  ],
  find: (args) => [
    "find",
    ...withValue("--app", optStr(args, "app")),
    ...withValue("--role", optStr(args, "role")),
    ...withValue("--name", optStr(args, "name")),
    ...withValue("--text", optStr(args, "text")),
  ],
  get: (args) => ["get", str(args, "ref"), "--property", optStr(args, "property") ?? "text"],
  click: (args) => ["click", str(args, "ref")],
  type: (args) => ["type", str(args, "ref"), str(args, "text")],
  set_value: (args) => ["set-value", str(args, "ref"), str(args, "value")],
  press: (args) => ["press", str(args, "key"), ...withValue("--app", optStr(args, "app"))],
  close_app: (args) => ["close-app", str(args, "app")],
  screenshot: (args) => [
    "screenshot",
    ...withValue("--app", optStr(args, "app")),
    ...withValue("--window-id", optStr(args, "window_id")),
    ...(optStr(args, "path") ? [str(args, "path")] : []),
  ],
}

function schema(properties: Record<string, unknown>, required: readonly string[]): unknown {
  return { type: "object", additionalProperties: false, properties, required }
}

const TOOLS: readonly ToolSpec[] = [
  {
    name: "list_apps",
    description: "List running GUI applications.",
    parameters: schema({}, []),
  },
  {
    name: "list_windows",
    description: "List visible windows, optionally filtered by application name.",
    parameters: schema({ app: { type: "string" } }, []),
  },
  {
    name: "launch",
    description: "Launch an application, optionally waiting for its window.",
    parameters: schema(
      {
        app: { type: "string" },
        activate: { type: "boolean" },
        wait_for: { type: "string" },
        arg: { type: "string" },
      },
      ["app"],
    ),
  },
  {
    name: "snapshot",
    description: "Capture an application window accessibility tree with element refs.",
    parameters: schema(
      {
        app: { type: "string" },
        window_id: { type: "string" },
        interactive: { type: "boolean" },
        max_depth: { type: "number" },
        timeout_ms: { type: "number" },
      },
      [],
    ),
  },
  {
    name: "find",
    description: "Find elements by role, name or text.",
    parameters: schema(
      { app: { type: "string" }, role: { type: "string" }, name: { type: "string" }, text: { type: "string" } },
      [],
    ),
  },
  {
    name: "get",
    description: "Read an element property: text, value, title, bounds, role or states.",
    parameters: schema({ ref: { type: "string" }, property: { type: "string" } }, ["ref"]),
  },
  {
    name: "click",
    description: "Click an element by ref.",
    parameters: schema({ ref: { type: "string" } }, ["ref"]),
  },
  {
    name: "type",
    description: "Insert text into an element by ref.",
    parameters: schema({ ref: { type: "string" }, text: { type: "string" } }, ["ref", "text"]),
  },
  {
    name: "set_value",
    description: "Set an element value directly.",
    parameters: schema({ ref: { type: "string" }, value: { type: "string" } }, ["ref", "value"]),
  },
  {
    name: "press",
    description: "Send a key combination to an application.",
    parameters: schema({ key: { type: "string" }, app: { type: "string" } }, ["key"]),
  },
  {
    name: "close_app",
    description: "Quit an application.",
    parameters: schema({ app: { type: "string" } }, ["app"]),
  },
  {
    name: "screenshot",
    description: "Capture an application window as a PNG.",
    parameters: schema({ app: { type: "string" }, window_id: { type: "string" }, path: { type: "string" } }, []),
  },
]

function run(binary: string, argv: readonly string[], signal: AbortSignal): Promise<Exec> {
  return new Promise((resolve) => {
    execFile(binary, [...argv], { signal, maxBuffer: 64 << 20, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : -1) : 0
      resolve({ code, stdout, stderr })
    })
  })
}

function lastJsonLine(stdout: string): unknown {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index] ?? "")
    } catch {
      continue
    }
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function mapResult(stdout: string): ToolResult {
  const envelope = asRecord(lastJsonLine(stdout))
  if (envelope.ok === false) {
    return { text: JSON.stringify(envelope.error ?? envelope), images: [], isError: true }
  }
  const data = envelope.data ?? envelope
  return { text: JSON.stringify(data), images: [], isError: false }
}

async function imageAt(path: string | undefined, data: Record<string, unknown>): Promise<readonly Image[]> {
  if (path) {
    try {
      const bytes = await readFile(path)
      return [{ mime: "image/png", base64: bytes.toString("base64") }]
    } catch {
      return []
    }
  }
  return typeof data.base64 === "string" ? [{ mime: "image/png", base64: data.base64 }] : []
}

export class AgentDesktopContender implements Contender {
  readonly name = "agent-desktop"
  readonly tracks: readonly Track[] = ["desktop", "mixed"]
  #version = ""
  #binary = process.env[BINARY_ENV] ?? "agent-desktop"
  #session = ""

  get version(): string {
    return this.#version
  }

  async start(_m: Machine, _condition: Condition): Promise<void> {
    sessions += 1
    this.#session = `kiko-bench-${process.pid}-${sessions}`
    const result = await run(this.#binary, ["version"], new AbortController().signal)
    const data = asRecord(asRecord(lastJsonLine(result.stdout)).data)
    this.#version = typeof data.version === "string" ? data.version : result.stdout.trim()
  }

  tools(): readonly ToolSpec[] {
    return TOOLS
  }

  async stop(): Promise<void> {}

  async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
    const build = COMMANDS[name]
    if (!build) throw new Error(`agent-desktop has no command ${name}`)
    const parsed = asRecord(args)
    const result = await run(this.#binary, [...build(parsed), "--session", this.#session], signal)
    const mapped = mapResult(result.stdout)
    if (name !== "screenshot" || mapped.isError) return mapped
    const images = await imageAt(optStr(parsed, "path"), asRecord(asRecord(lastJsonLine(result.stdout)).data))
    return { text: mapped.text, images, isError: false }
  }
}
