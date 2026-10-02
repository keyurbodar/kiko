import type { Extension, ToolRegistration } from "@earendil-works/pi-durable"

// Architecture section 16.3. Every kiko tool declares one effect, and the trust extension gates a
// tainted run by it. A tool declares its effect where it is defined, with `declareEffect`. The
// factory reads every selected tool's declaration through `effectTable` and refuses to build an
// agent with a tool that has none.

/** What a tool does outside the model's head. */
export type Effect = "read" | "write" | "message" | "external"

export const EFFECTS: readonly Effect[] = ["read", "write", "message", "external"]

export type EffectDeclaration = {
  effect: Effect
  /**
   * Set when the tool's result is outside content: a web page, a file, an Executor or MCP result.
   * The value names the source, such as `web`. The trust extension wraps such a result in an
   * `<untrusted>` block and taints the run.
   */
  outside?: string
}

const DECLARED = Symbol.for("kiko.effect")

type Declared = { [DECLARED]?: EffectDeclaration }

/**
 * Returns the tool with its effect attached. The declaration is a symbol property, so a wrapper that
 * spreads the tool (`{ ...tool, execute }`) keeps it.
 */
export function declareEffect<T extends ToolRegistration>(effect: Effect, tool: T, options: { outside?: string } = {}): T {
  if (!EFFECTS.includes(effect)) throw new Error(`tool ${tool.name}: unknown effect ${String(effect)}`)
  const declaration: EffectDeclaration = options.outside ? { effect, outside: options.outside } : { effect }
  return Object.assign({ ...tool }, { [DECLARED]: declaration }) as T
}

export function effectOf(tool: ToolRegistration): EffectDeclaration | undefined {
  return (tool as Declared)[DECLARED]
}

/**
 * The effect of every tool the extensions bring, by tool name. Throws for a tool without a
 * declaration, and for two tools with one name and different declarations, so such an agent is
 * never built.
 */
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
