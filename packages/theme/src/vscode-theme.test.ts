import { describe, expect, test } from "bun:test"
import { wcagContrast } from "culori"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { THEMES } from "./palette"
import { packagePath, parseJsonc, readVsCodeTheme, themeFromVsCode, type VsCodeTheme } from "./vscode-theme"

const FIXTURES = join(import.meta.dir, "../test/fixtures/vscode")
const meta = { id: "test", name: "Test", source: "test.test" }
const fixture = (file: string) => parseJsonc(readFileSync(join(FIXTURES, file), "utf8")) as VsCodeTheme
const load = (file: string) => readVsCodeTheme(`extension/themes/${file}`, async (path) => fixture(path.split("/").pop()!))
const inline = (colors: Record<string, string>, type?: string): VsCodeTheme => ({ type, colors })

describe("VS Code theme mapping", () => {
  test("a dark theme with an include maps to a dark palette from its merged colors", async () => {
    const theme = themeFromVsCode(await load("dark_plus.json"), meta)
    expect(theme.appearance).toBe("dark")
    expect(theme.palette.canvas).toBe("#1e1e1e")
    expect(theme.palette.text).toBe("#d4d4d4")
  })

  test("a light theme with an include maps to a light palette", async () => {
    const theme = themeFromVsCode(await load("light_plus.json"), meta)
    expect(theme.appearance).toBe("light")
    expect(theme.palette.canvas).toBe("#ffffff")
    expect(theme.palette.text).toBe("#000000")
  })

  test("a theme with its own description and link colors uses them", async () => {
    const theme = themeFromVsCode(await load("dark_modern.json"), meta)
    expect(theme.palette.canvas).toBe("#1f1f1f")
    expect(theme.palette.muted).toBe("#9d9d9d")
    expect(theme.palette.action).toBe("#0078d4")
    expect(theme.accent).toBe("#0078d4")
  })

  test.each(["dark_plus.json", "light_plus.json", "dark_modern.json"])("%s keeps every text role readable on its canvas", async (file) => {
    const theme = themeFromVsCode(await load(file), meta)
    const { canvas, text, muted, danger, gold, onAction, actionHover, action } = theme.palette
    for (const role of [text, muted, danger, gold]) expect(wcagContrast(role, canvas)).toBeGreaterThanOrEqual(4.5)
    expect(wcagContrast(onAction, action)).toBeGreaterThanOrEqual(4.5)
    expect(actionHover).not.toBe(action)
  })

  test("an unreadable foreground falls back to a readable one", () => {
    const theme = themeFromVsCode(inline({ "editor.background": "#101010", "editor.foreground": "#121212" }, "dark"), meta)
    expect(wcagContrast(theme.palette.text, "#101010")).toBeGreaterThanOrEqual(4.5)
  })

  test("an accent that does not stand apart from the canvas falls back to the default accent", () => {
    const theme = themeFromVsCode(inline({ "editor.background": "#1e1e1e", focusBorder: "#1f1f1f" }, "dark"), meta)
    expect(theme.accent).toBe(THEMES.glacier.accent)
  })

  test("an alpha overlay is flattened over black before it is read", () => {
    const theme = themeFromVsCode(inline({ "editor.background": "#ffffff80" }), meta)
    expect(theme.palette.canvas).toBe("#808080")
  })

  test("a theme with no editor background is refused", () => {
    expect(() => themeFromVsCode(inline({ "editor.foreground": "#000000" }), meta)).toThrow("no editor background")
  })

  test("the include chain stops at the depth limit", async () => {
    const loop = async () => ({ include: "./loop.json", colors: {} })
    await expect(readVsCodeTheme("extension/themes/loop.json", loop)).rejects.toThrow("nested too deeply")
  })
})

describe("JSONC and package paths", () => {
  test("comments and trailing commas are read, and string contents are kept", () => {
    expect(parseJsonc('{ // note\n "a": "http://x", /* b */ "b": [1, 2, ], }')).toEqual({ a: "http://x", b: [1, 2] })
  })

  test("a relative path resolves inside its folder", () => {
    expect(packagePath("extension/themes/a.json", "./b.json")).toBe("extension/themes/b.json")
  })

  test("a path that leaves the package is refused", () => {
    expect(() => packagePath("extension/themes/a.json", "../../../x.json")).toThrow("leaves the extension package")
  })
})
