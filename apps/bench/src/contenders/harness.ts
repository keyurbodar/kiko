import { isAbsolute, relative, resolve } from "node:path"
import type { Contender, Machine, ToolResult, ToolSpec } from "../types"

const MAX_READ_CHARS = 12_000
const MAX_LIST_ENTRIES = 200
const HARNESS_NAMES: ReadonlySet<string> = new Set(["read_file", "list_files"])

export const HARNESS_TOOLS: readonly ToolSpec[] = [
  {
    name: "read_file",
    description:
      "read a text file from the task's working directory. it takes the path the task named, such as url.txt or request.json, and returns the whole file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "the file to read, relative to the working directory" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_files",
    description: "list the names in the task's working directory, or in a directory inside it.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "a directory inside the working directory; it defaults to the whole thing",
        },
      },
    },
  },
]

const failure = (text: string): ToolResult => ({ text, images: [], isError: true })

const cut = (value: string): string =>
  value.length > MAX_READ_CHARS ? `${value.slice(0, MAX_READ_CHARS - 1)}…` : value

function inside(workdir: string, path: string): string {
  const full = resolve(workdir, path)
  const rel = relative(workdir, full)
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${path} is outside the working directory`)
  return full
}

function pathOf(args: unknown): string {
  const bag = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {}
  const path = bag.path
  return typeof path === "string" && path.length > 0 ? path : "."
}

async function readFileTool(machine: Machine, path: string): Promise<ToolResult> {
  const full = inside(machine.workdir, path)
  const text = await machine.readText(full)
  if (text === undefined) return failure(`${path} is not in the working directory`)
  return { text: cut(text), images: [], isError: false }
}

async function listFilesTool(machine: Machine, path: string): Promise<ToolResult> {
  const full = inside(machine.workdir, path)
  const listed = await machine.exec(["ls", "-1a", full])
  if (listed.code !== 0) return failure(`${path} is not in the working directory`)
  const names = listed.stdout.split("\n").filter((name) => name !== "" && name !== "." && name !== "..")
  if (names.length === 0) return { text: `${path} is empty`, images: [], isError: false }
  const shown = names.slice(0, MAX_LIST_ENTRIES)
  const more = names.length > shown.length ? `\n…and ${names.length - shown.length} more` : ""
  return { text: `${shown.join("\n")}${more}`, images: [], isError: false }
}

async function harnessCall(machine: Machine, name: string, args: unknown): Promise<ToolResult> {
  const path = pathOf(args)
  try {
    return name === "read_file" ? await readFileTool(machine, path) : await listFilesTool(machine, path)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export function withHarness(inner: Contender): Contender {
  let machine: Machine | undefined
  const harness = (): readonly ToolSpec[] => {
    const taken = new Set(inner.tools().map((tool) => tool.name))
    return HARNESS_TOOLS.filter((tool) => !taken.has(tool.name))
  }
  return {
    name: inner.name,
    get version(): string {
      return inner.version
    },
    tracks: inner.tracks,
    async start(m: Machine, condition): Promise<void> {
      machine = m
      await inner.start(m, condition)
    },
    tools(): readonly ToolSpec[] {
      return [...inner.tools(), ...harness()]
    },
    async call(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
      if (!HARNESS_NAMES.has(name)) return inner.call(name, args, signal)
      if (!machine) return failure("the contender has not started")
      if (signal.aborted) return failure("the call was cancelled")
      return harnessCall(machine, name, args)
    },
    async stop(): Promise<void> {
      await inner.stop()
      machine = undefined
    },
  }
}
