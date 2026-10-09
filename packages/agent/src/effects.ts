import type { Extension, ToolRegistration } from "@earendil-works/pi-durable"

export type Effect = "read" | "write" | "message" | "external"

export const EFFECTS: readonly Effect[] = ["read", "write", "message", "external"]

export type EffectDeclaration = {
  effect: Effect
  outside?: string
}

const DECLARED = Symbol.for("yuki.effect")

type Declared = { [DECLARED]?: EffectDeclaration }

export function declareEffect<T extends ToolRegistration>(effect: Effect, tool: T, options: { outside?: string } = {}): T {
  if (!EFFECTS.includes(effect)) throw new Error(`tool ${tool.name}: unknown effect ${String(effect)}`)
  const declaration: EffectDeclaration = options.outside ? { effect, outside: options.outside } : { effect }
  return Object.assign({ ...tool }, { [DECLARED]: declaration }) as T
}

export function effectOf(tool: ToolRegistration): EffectDeclaration | undefined {
  return (tool as Declared)[DECLARED]
}

export function effectTable(extensions: readonly Extension[]): ReadonlyMap<string, EffectDeclaration> {
  const table = new Map<string, EffectDeclaration>()
  for (const extension of extensions) {
    for (const tool of extension.tools ?? []) {
      const declared = effectOf(tool)
      if (!declared) throw new Error(`tool ${tool.name} in extension ${extension.name} declares no effect`)
      const before = table.get(tool.name)
      if (before && (before.effect !== declared.effect || before.outside !== declared.outside)) {
        throw new Error(`tool ${tool.name} is declared twice with different effects`)
      }
      table.set(tool.name, declared)
    }
  }
  return table
}
