import * as Schema from "effect/Schema"
import type { Extension, ToolRegistration } from "@earendil-works/pi-durable"

export class EffectDeclarationError extends Schema.TaggedError<EffectDeclarationError>()("EffectDeclarationError", {
  tool: Schema.String,
  reason: Schema.Literals(["unknown", "undeclared", "conflict"]),
  message: Schema.String,
}) {}

export type Effect = "read" | "write" | "message" | "external"

export const EFFECTS: readonly Effect[] = ["read", "write", "message", "external"]

const DECLARED = Symbol.for("kiko.effect")

type Declaration = { effect: Effect; stoppable: boolean }

type Declared = { [DECLARED]?: Declaration }

export function declareEffect<T extends ToolRegistration>(
  effect: Effect,
  tool: T,
  options: { stoppable?: boolean } = {},
): T {
  if (!EFFECTS.includes(effect))
    throw new EffectDeclarationError({
      tool: tool.name,
      reason: "unknown",
      message: `tool ${tool.name}: unknown effect ${String(effect)}`,
    })
  return Object.assign({ ...tool }, { [DECLARED]: { effect, stoppable: options.stoppable ?? false } }) as T
}

function effectOf(tool: ToolRegistration): Effect | undefined {
  return (tool as Declared)[DECLARED]?.effect
}

export function stoppable(tool: ToolRegistration): boolean {
  const declared = (tool as Declared)[DECLARED]
  return declared?.effect === "read" || declared?.stoppable === true
}

export function effectTable(extensions: readonly Extension[]): ReadonlyMap<string, Effect> {
  const table = new Map<string, Effect>()
  for (const extension of extensions) {
    for (const tool of extension.tools ?? []) {
      const declared = effectOf(tool)
      if (!declared)
        throw new EffectDeclarationError({
          tool: tool.name,
          reason: "undeclared",
          message: `tool ${tool.name} in extension ${extension.name} declares no effect`,
        })
      const before = table.get(tool.name)
      if (before && before !== declared)
        throw new EffectDeclarationError({
          tool: tool.name,
          reason: "conflict",
          message: `tool ${tool.name} is declared twice with different effects`,
        })
      table.set(tool.name, declared)
    }
  }
  return table
}
