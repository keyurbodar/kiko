import snapshotJson from "./schema-snapshot.json"
import { AGENT_TOOL_NAMES } from "./constants"
import type { McpTool } from "./mcp"

export interface ToolSnapshot {
  readonly description: string
  readonly inputSchema: unknown
}

export interface SchemaSnapshot {
  readonly t3Version: string
  readonly sourceSha: string
  readonly tools: Readonly<Record<string, ToolSnapshot>>
}

export const recordSnapshot = (
  tools: readonly McpTool[],
  source: { readonly t3Version: string; readonly sourceSha: string },
): SchemaSnapshot => ({
  t3Version: source.t3Version,
  sourceSha: source.sourceSha,
  tools: Object.fromEntries(
    tools
      .filter((tool) => AGENT_TOOL_NAMES.includes(tool.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => [tool.name, { description: tool.description, inputSchema: tool.inputSchema }]),
  ),
})

export const diffSnapshot = (expected: SchemaSnapshot, live: readonly McpTool[]): readonly string[] => {
  const actual = recordSnapshot(live, {
    t3Version: expected.t3Version,
    sourceSha: expected.sourceSha,
  })
  const names = new Set([
    ...Object.keys(expected.tools),
    ...live.filter((tool) => AGENT_TOOL_NAMES.includes(tool.name)).map((tool) => tool.name),
  ])
  const differences: string[] = []
  for (const name of [...names].sort()) {
    const before = expected.tools[name]
    const after = actual.tools[name]
    if (before === undefined) {
      differences.push(`${name}: new tool in t3 ${actual.t3Version}`)
      continue
    }
    if (after === undefined) {
      differences.push(`${name}: gone from t3 ${actual.t3Version}`)
      continue
    }
    if (before.description !== after.description) {
      differences.push(`${name}: description changed`)
    }
    if (JSON.stringify(before.inputSchema) !== JSON.stringify(after.inputSchema)) {
      differences.push(`${name}: inputSchema changed`)
    }
  }
  return differences
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isToolSnapshot = (value: unknown): value is ToolSnapshot =>
  isRecord(value) && typeof value.description === "string" && "inputSchema" in value

const isSchemaSnapshot = (value: unknown): value is SchemaSnapshot =>
  isRecord(value) &&
  typeof value.t3Version === "string" &&
  typeof value.sourceSha === "string" &&
  isRecord(value.tools) &&
  Object.values(value.tools).every(isToolSnapshot)

export const expectedSnapshot = (value: unknown = snapshotJson): SchemaSnapshot => {
  if (!isSchemaSnapshot(value)) throw new Error("schema-snapshot.json does not match its schema")
  return value
}

export const assertSchemaSnapshot = (live: readonly McpTool[]): readonly string[] =>
  diffSnapshot(expectedSnapshot(), live)
