// Reads the token declarations in kat.css. Used by `gen-theme.ts` to write
// `src/theme/known-tokens.ts` and `docs/theming.md`, and by the theme tests to prove
// both files are current. Runs under bun, never in the browser.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export const ROOT = join(import.meta.dir, "../../..")
export const KAT_CSS = join(ROOT, "packages/ui/src/styles/kat.css")

export type TokenKind = "color" | "length" | "number" | "font" | "weight" | "any"

/** Motion is not themeable. The format has no motion keys, and the hatch has none. */
const MOTION = /^--(spring|ease)/

/** Every custom property the `:root` blocks and the `@theme` radius roles declare, with its default text. */
export function parseKat(css: string = readFileSync(KAT_CSS, "utf8")): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const found = new Map<string, string>()
  const read = (block: string, only?: RegExp) => {
    for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const name = m[1]!
      if (MOTION.test(name) || (only && !only.test(name)) || found.has(name)) continue
      found.set(name, m[2]!.replace(/\s+/g, " ").trim())
    }
  }
  for (const m of text.matchAll(/:root\s*\{([^{}]*)\}/g)) read(m[1]!)
  for (const m of text.matchAll(/@theme\s*\{([^{}]*)\}/g)) read(m[1]!, /^--radius-/)
  return found
}

const COLOR_START = /^(oklch|oklab|rgb|rgba|hsl|lab|lch|color-mix)\(|^#|^transparent$/

/** Works out what a token holds from its name and its default, following `var()` references. */
export function kindOf(name: string, defaults: Map<string, string>, seen = new Set<string>()): TokenKind {
  if (name.startsWith("--font-family")) return "font"
  if (name.startsWith("--font-weight")) return "weight"
  const value = defaults.get(name)
  if (value === undefined || seen.has(name)) return "any"
  seen.add(name)
  if (/^-?\d*\.?\d+$/.test(value)) return "number"
  if (/^-?\d*\.?\d+(px|rem|em)$/.test(value)) return "length"
  if (COLOR_START.test(value)) return "color"
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value)
  if (ref) return kindOf(ref[1]!, defaults, seen)
  return "any"
}

export function knownTokens(css?: string): { name: string; kind: TokenKind; default: string }[] {
  const defaults = parseKat(css)
  return [...defaults].map(([name, value]) => ({ name, kind: kindOf(name, defaults), default: value }))
}
