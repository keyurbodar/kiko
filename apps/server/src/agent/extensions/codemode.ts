import type { Context, JsonValue } from "@earendil-works/chord"
import { withAbortSignal } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import {
  type CodemodeOutputItem,
  type CodemodeResult,
  type CodemodeSandboxBase,
  type CodemodeSandboxBaseOptions,
  type CodemodeTool,
} from "@earendil-works/pi-codemode/portable"
import { parseCodemodeSource } from "@earendil-works/pi-codemode/source"
import {
  defineDoc,
  defineExtension,
  defineTool,
  type Extension,
  type JsonObject,
  type NestedToolExecutionResult,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable"
import { declareEffect } from "@kiko/agent/effects"
import { filesOf } from "../../files/room-fs"

export const CODEMODE = "codemode"

export type CodemodeSandbox = Pick<CodemodeSandboxBase, "execute" | "close">
export type MakeSandbox = (options: CodemodeSandboxBaseOptions) => Promise<CodemodeSandbox>

const MAX_OUTPUT_TOKENS = 10_000
const CHARS_PER_TOKEN = 4
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 120_000
const MEMORY_LIMIT_BYTES = 64 * 1024 * 1024

const DESCRIPTION = `Run JavaScript that calls your other tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No require, process, network, file system, or timers.
- \`await tools.<name>({ ...args })\` takes the same arguments as calling the tool directly, resolves to its text output, and rejects with an Error when the call fails. Calls still running when the script ends are cancelled.
- \`await readText(path)\` resolves to a file's whole text, without line numbers.
- \`text(value)\`, \`console.log(...)\`, and top-level \`return\` add output; \`exit()\` ends the script.
- \`store(key, value)\` and \`load(key)\` keep small JSON values between your scripts in this conversation; they are saved with the chat and survive a restart. \`load\` gives undefined for a key you never stored.
- Optional first line: \`// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\`
To run a CommonJS file and its test block:
const module = { exports: {} }
new Function("module", "exports", "require", "process", await readText("/home/a.js"))(module, module.exports, () => ({}), { argv: ["node", "a.js", "test"], exit() {}, exitCode: 0 })`

const CodemodeStore = defineDoc<{ values: JsonObject }>({
  kind: "kiko.codemode-store",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ values: {} }),
})

const nestedText = (out: NestedToolExecutionResult): string => {
  const value = out.structuredOutput
  const own = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)
  return [own, ...out.diagnostics.map((d) => d.message)].filter(Boolean).join("\n")
}

const valueText = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))

function errorText(result: Extract<CodemodeResult, { ok: false }>): string {
  const { error } = result
  const head =
    error.kind === "script"
      ? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
      : error.kind === "timeout"
        ? `Script timed out: ${error.message}`
        : error.kind === "aborted"
          ? `Script aborted: ${error.message}`
          : `Script sandbox failed: ${error.message}`
  const made = result.calls.map((c) => `${c.name} (${c.status})`).join(", ")
  return `${head}\n\n${made ? `Tool calls made before the failure (they are not undone): ${made}` : "No tool calls were made."}`
}

function budgeted(items: readonly CodemodeOutputItem[], maxTokens: number): string {
  const text = items.flatMap((i) => (i.type === "text" ? [i.text] : [])).join("\n")
  const limit = maxTokens * CHARS_PER_TOKEN
  if (text.length <= limit) return text
  const head = text.slice(0, Math.floor(limit / 2))
  const tail = text.slice(-(limit - head.length))
  return `Output cut: about ${Math.ceil(text.length / CHARS_PER_TOKEN)} tokens, ${text.split("\n").length} lines. Filter in the script and return less.\n\n${head}\n…\n${tail}`
}

export function codemodeExtension(makeSandbox: MakeSandbox): Extension {
  const codemode = defineTool({
    name: CODEMODE,
    description: DESCRIPTION,
    parameters: Type.Object({ code: Type.String({ description: "Raw JavaScript source." }) }),
    callers: ["model"],
    replay: "unsafe",
    execute: async (args, api: ToolExecutionApi, context: Context) => {
      const started = performance.now()
      const { code, options } = parseCodemodeSource(args.code)
      const agent = await api.agent(context)
      let next = 0
      const tools: CodemodeTool[] = agent.callable
        .filter((tool) => tool.name !== CODEMODE)
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters as Record<string, unknown>,
          outputSchema: { type: "string" },
          execute: async (input, { signal }) => {
            const out = await api.executeTool(
              tool.name,
              (input ?? {}) as JsonObject,
              withAbortSignal(signal, context),
              { key: `${++next}` },
            )
            const text = nestedText(out)
            if (out.isError) throw new Error(text || `${tool.name} failed`)
            return text
          },
        }))
      const readText: CodemodeTool = {
        name: "readText",
        spread: true,
        execute: async (input) => {
          const [path] = input as [unknown]
          if (typeof path !== "string") throw new Error("readText() takes a path")
          const read = await filesOf(api).readTextFile(path)
          if (!read.ok) throw new Error(read.error.message)
          return read.value
        },
      }
      const sandbox = await makeSandbox({
        tools,
        globals: [readText],
        timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
        memoryLimitBytes: MEMORY_LIMIT_BYTES,
      })
      const stored = await api.snapshot(CodemodeStore, api.conversationId, context)
      const store: Record<string, unknown> = { ...stored?.values }
      let result: CodemodeResult
      try {
        result = await sandbox.execute(code, {
          ...(context.abortSignal ? { signal: context.abortSignal } : {}),
          store,
        })
      } finally {
        await sandbox.close()
      }
      const items = [...result.output]
      if (result.ok) {
        const writes = result.storeWrites
        if (Object.keys(writes.set).length || writes.delete.length) {
          await api.commit(async (tx) => {
            const doc = await tx.doc(CodemodeStore, api.conversationId)
            for (const key of Object.keys(writes.set)) doc.values[key] = writes.set[key] as JsonValue
            for (const key of writes.delete) delete doc.values[key]
          }, context)
        }
        if (result.value !== undefined) items.push({ type: "text", text: valueText(result.value) })
      } else items.push({ type: "text", text: `Script error:\n${errorText(result)}` })
      const seconds = ((performance.now() - started) / 1000).toFixed(1)
      const header = `${result.ok ? "Script completed" : "Script failed"} in ${seconds} seconds. Output:`
      const body = budgeted(items, options.maxOutputTokens ?? MAX_OUTPUT_TOKENS)
      return {
        output: [{ type: "text" as const, text: `${header}\n${body || "(none)"}` }],
        ...(result.ok ? {} : { isError: true }),
      }
    },
  })

  return defineExtension({ name: CODEMODE, tools: [declareEffect("write", codemode)] })
}
