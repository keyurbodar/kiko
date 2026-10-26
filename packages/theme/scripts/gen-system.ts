import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { systemCss } from "../src/system"

const CSS = join(import.meta.dir, "../../../apps/web-solid/src/index.css")
const START = "/* system:start */"
const END = "/* system:end */"

const css = readFileSync(CSS, "utf8")
const a = css.indexOf(START)
const b = css.indexOf(END)
if (a < 0 || b < a) throw new Error("index.css has no system markers")
writeFileSync(CSS, css.slice(0, a) + systemCss() + css.slice(b + END.length))
