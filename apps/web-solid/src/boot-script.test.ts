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

const saved = (look: Record<string, unknown>) => ({
  "kiko:auth": "{}",
  "kiko:look": JSON.stringify({ v: 6, text: JSON.stringify({ kind: "look", ...look }) }),
})

describe("index.html boot script", () => {
  it("paints the Cursor dark palette before the app loads", () => {
    const { vars, classes } = paint({})
    expect(classes.has("dark")).toBe(true)
    expect(vars.get("--bg-chrome")).toBe("#141414")
    expect(vars.get("--bg-sidebar")).toBe("#181818")
    expect(vars.get("--text-primary")).toBe("#f0f0f0")
    expect(vars.get("--font-size-base")).toBe("13px")
    expect(vars.get("--font-size-3xl")).toBe("22px")
  })

  it("keeps a saved light mode for a signed-in owner", () => {
    const { vars, classes } = paint(saved({ version: 6, mode: "light", lightTheme: "light" }))
    expect(classes.has("dark")).toBe(false)
    expect(vars.get("--bg-chrome")).toBe("#f5f5f5")
    expect(vars.get("--text-primary")).toBe("#1c1c1c")
  })

  it("paints the saved light theme, not the default one", () => {
    const { vars } = paint(saved({ version: 6, mode: "light", lightTheme: "light-high-contrast" }))
    expect(vars.get("--bg-chrome")).toBe("#fcfcfc")
  })

  it("falls back to the default dark theme for a look saved with a retired theme", () => {
    const { vars } = paint(saved({ version: 5, mode: "dark", darkTheme: "kiko" }))
    expect(vars.get("--bg-chrome")).toBe("#141414")
  })
})
