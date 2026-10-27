import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8")
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ""

function paint(stored: Record<string, string>) {
  const vars = new Map<string, string>()
  const classes = new Set<string>()
  const root = {
    classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
    style: {
      setProperty: (name: string, value: string) => vars.set(name, value),
      colorScheme: "",
      backgroundColor: "",
    },
  }
  const run = new Function("document", "localStorage", "matchMedia", script)
  run({ documentElement: root, querySelectorAll: () => [] }, { getItem: (key: string) => stored[key] ?? null }, () => ({
    matches: false,
  }))
  return { vars, classes }
}

describe("index.html boot script", () => {
  it("paints the Kiko dark palette before the app loads", () => {
    const { vars, classes } = paint({})
    expect(classes.has("dark")).toBe(true)
    expect(vars.get("--bg")).toBe("#151515")
    expect(vars.get("--fg")).toBe("#ededed")
    expect(vars.get("--type-ui")).toBe("14px")
  })

  it("keeps a saved light mode for a signed-in owner", () => {
    const look = JSON.stringify({ version: 5, kind: "look", mode: "light", darkTheme: "kiko" })
    const { vars, classes } = paint({ "kiko:auth": "{}", "kiko:look": JSON.stringify({ v: 6, text: look }) })
    expect(classes.has("dark")).toBe(false)
    expect(vars.get("--bg")).toBe("#f9f9f7")
  })
})
