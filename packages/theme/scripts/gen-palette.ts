
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tokensFor } from "../src/palette"

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

/** Bundle the canonical parsers and resolver into the synchronous pre-paint script. */
export async function withBootPalettes(html: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: ["kiko-boot"],
    target: "browser",
    minify: { whitespace: true, syntax: true, identifiers: false },
    plugins: [{
      name: "boot-resolver",
      setup(build) {
        build.onResolve({ filter: /^kiko-boot$/ }, () => ({ path: "kiko-boot", namespace: "boot" }))
        build.onLoad({ filter: /.*/, namespace: "boot" }, () => ({
          loader: "js",
          contents: `import { THEMES, DEFAULT_DARK_THEME, tokensFor } from ${JSON.stringify(join(import.meta.dir, "../src/palette.ts"))};
import { readDisplay, displayVars } from ${JSON.stringify(join(import.meta.dir, "../src/display.ts"))};
import { parseImported, themeFor } from ${JSON.stringify(join(import.meta.dir, "../src/imported.ts"))};
Object.assign(boot, { THEMES, DEFAULT_DARK_THEME, tokensFor, readDisplay, displayVars, parseImported, themeFor });`,
        }))
      },
    }],
  })
  if (!result.success) throw new AggregateError(result.logs, "Could not build the boot resolver")
  const code = await result.outputs[0]!.text()
  return html.replace(/\/\* boot-palettes:start \*\/[\s\S]*?\/\* boot-palettes:end \*\//, () => `/* boot-palettes:start */\n        (function () { ${code.trim()} })();\n        /* boot-palettes:end */`)
}
if (import.meta.main) {
  const html = join(import.meta.dir, "../../../apps/web-solid/index.html")
  writeFileSync(html, await withBootPalettes(readFileSync(html, "utf8")))
}
