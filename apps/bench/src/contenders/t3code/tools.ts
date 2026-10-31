import type { Image, Os, ToolResult, ToolSpec } from "../../types"
import { AGENT_TOOL_NAMES } from "./constants"
import type { McpCallResult, McpTool } from "./mcp"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const bashToolSpec = (os: Os): ToolSpec => ({
  name: "bash",
  description:
    os === "windows"
      ? "Run a PowerShell command in the workspace and return its exit code and output."
      : "Run a shell command in the workspace and return its exit code and output.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command line to run." },
    },
    required: ["command"],
    additionalProperties: false,
  },
})

export const agentTools = (live: readonly McpTool[]): readonly ToolSpec[] =>
  live
    .filter((tool) => AGENT_TOOL_NAMES.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }))

const textParts = (content: readonly unknown[]): readonly string[] =>
  content.flatMap((part) =>
    isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
  )

const imageParts = (content: readonly unknown[]): readonly Image[] =>
  content.flatMap((part) => {
    if (!isRecord(part) || part.type !== "image") return []
    if (typeof part.data !== "string") return []
    if (part.mimeType !== "image/png" && part.mimeType !== "image/jpeg") return []
    return [{ mime: part.mimeType, base64: part.data }]
  })

export const toToolResult = (result: McpCallResult): ToolResult => {
  const texts = textParts(result.content)
  const text =
    texts.length > 0
      ? texts.join("\n")
      : result.structuredContent === undefined
        ? ""
        : JSON.stringify(result.structuredContent)
  return { text, images: imageParts(result.content), isError: result.isError }
}

const MAX_OUTPUT_CHARS = 12_000

const tail = (value: string): string =>
  value.length > MAX_OUTPUT_CHARS ? `…${value.slice(value.length - MAX_OUTPUT_CHARS + 1)}` : value

export const execText = (exitCode: number, stdout: string, stderr: string): string => {
  const body = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n")
  return `exit code ${exitCode}\n\n${body ? tail(body) : "(no output)"}`
}
