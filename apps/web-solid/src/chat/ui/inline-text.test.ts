import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/*
 * A bubble's text, its emoji and its mention chips are inline boxes in one span. When a
 * stylesheet elsewhere made that span a flex column (the sidebar's `.chat-text`), every
 * run became its own flex item: "kiko's here" and its emoji, or "@piko" and "thanks",
 * landed on separate lines. This guards the class names the bubble text uses against any
 * rule in the app that turns them into a flex or grid box.
 */

const src = join(import.meta.dir, "..", "..")

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return stylesheets(path)
    return name.endsWith(".css") ? [path] : []
  })
}

/** Every class a rule styles as a flex or grid container. */
function boxClasses(css: string): Set<string> {
  const out = new Set<string>()
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/display:\s*(inline-)?(flex|grid)/.test(body!)) continue
    for (const [, name] of selector!.matchAll(/\.([\w-]+)/g)) out.add(name!)
  }
  return out
}

/** The literal class names in the bubble text renderer's markup. */
function textClasses(): string[] {
  const tsx = readFileSync(join(import.meta.dir, "RichText.tsx"), "utf8")
  return [...tsx.matchAll(/class(?:=|: )"([^"]+)"/g), ...tsx.matchAll(/cn\("([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/))
}

describe("bubble text stays inline", () => {
  test("no stylesheet makes the bubble text span a flex or grid box", () => {
    const boxes = new Set(stylesheets(src).flatMap((path) => [...boxClasses(readFileSync(path, "utf8"))]))
    const clashes = textClasses().filter((name) => boxes.has(name))
    expect(clashes).toEqual([])
  })

  test("the guard sees the sidebar's flex column, so a rename back would fail", () => {
    expect(boxClasses(readFileSync(join(src, "sidebar", "sidebar.css"), "utf8")).has("chat-text")).toBe(true)
    expect(textClasses()).toContain("bubble-text")
  })
})
