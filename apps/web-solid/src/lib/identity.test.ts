import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ACCENTS, identityLook } from "./identity"

describe("identity look", () => {
  test("the same seed gives the same look", () => {
    expect(identityLook("ada")).toEqual(identityLook("ada"))
  })

  test("the accent is always from the fixed palette", () => {
    for (const seed of ["a", "b", "01J0ROOM", "ada", ""]) expect(ACCENTS).toContain(identityLook(seed).accent)
  })

  test("different seeds spread over the palette", () => {
    const used = new Set(Array.from({ length: 60 }, (_, i) => identityLook(`room-${i}`).accent))
    expect(used.size).toBeGreaterThanOrEqual(4)
  })
})

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(tsx|ts)$/.test(name) && !name.includes(".test.") ? [path] : []
  })
}

describe("render sites", () => {
  const root = join(import.meta.dir, "..")
  const files = sources(root).map((path) => ({ path, text: readFileSync(path, "utf8") }))

  test("only IdentityAvatar imports the blobatar", () => {
    const users = files.filter((f) => f.text.includes("@blobatar/solid")).map((f) => f.path.slice(root.length + 1))
    expect(users).toEqual(["lib/IdentityAvatar.tsx"])
  })

  test("every chat render site uses IdentityAvatar", () => {
    for (const site of ["sidebar/chat-panel.tsx", "app/tab-strip.tsx", "chat/ui/EmptyState.tsx", "palette/palette.tsx"]) {
      expect(files.find((f) => f.path.endsWith(site))?.text).toContain("IdentityAvatar")
    }
  })

  test("no other file derives an avatar colour", () => {
    for (const f of files) {
      if (f.path.endsWith("lib/identity.ts")) continue
      expect(f.text).not.toMatch(/glyphHue|oklch\(0\.72 0\.12 \$\{/)
    }
  })
})
