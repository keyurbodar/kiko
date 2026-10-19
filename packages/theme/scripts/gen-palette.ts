
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { THEME_IDS, tokensFor } from "../src/palette"

export const KAT = join(import.meta.dir, "../../../apps/web-solid/src/index.css")
const START = "/* palette:start */"
const END = "/* palette:end */"

const rule = (selector: string, mode: "light" | "dark") =>
  `${selector} {\n${Object.entries(tokensFor(mode))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`

export function paletteBlock(): string {
  return `${START}\n${rule(":root", "dark")}\n\n${rule(':root:not(.dark)', "light")}\n${END}`
}

export function withPalette(css: string): string {
  const a = css.indexOf(START)
  const b = css.indexOf(END)
  if (a < 0 || b < a) throw new Error("index.css has no palette markers")
  return css.slice(0, a) + paletteBlock() + css.slice(b + END.length)
}

if (import.meta.main) writeFileSync(KAT, withPalette(readFileSync(KAT, "utf8")))

export function withBootPalettes(html: string): string {
  const data = Object.fromEntries(THEME_IDS.map((id) => [id, tokensFor(id === "snow" ? "light" : "dark", id === "snow" ? "glacier" : id)]))
  return html.replace(/\/\* boot-palettes:start \*\/[\s\S]*?\/\* boot-palettes:end \*\//, `/* boot-palettes:start */\n        var palettes = ${JSON.stringify(data)};\n        /* boot-palettes:end */`)
}
if (import.meta.main) {
  const html = join(import.meta.dir, "../../../apps/web-solid/index.html")
  writeFileSync(html, withBootPalettes(readFileSync(html, "utf8")))
}
