// Rewrites kat.css section 4e, Kiko's palette a fresh browser paints before any module
// loads, from `tokensFor` in src/palette.ts. A theme test fails when the two differ.
//
//   bun packages/theme/scripts/gen-palette.ts

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tokensFor } from "../src/palette"

export const KAT = join(import.meta.dir, "../../ui/src/styles/kat.css")
const START = "/* palette:start */"
const END = "/* palette:end */"

const rule = (selector: string, mode: "light" | "dark") =>
  `${selector} {\n${Object.entries(tokensFor(mode))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`

export function paletteBlock(): string {
  return `${START}\n${rule(":root", "dark")}\n\n${rule(':root[data-appearance="light"]', "light")}\n${END}`
}

export function withPalette(css: string): string {
  const a = css.indexOf(START)
  const b = css.indexOf(END)
  if (a < 0 || b < a) throw new Error("kat.css has no palette markers")
  return css.slice(0, a) + paletteBlock() + css.slice(b + END.length)
}

if (import.meta.main) writeFileSync(KAT, withPalette(readFileSync(KAT, "utf8")))
