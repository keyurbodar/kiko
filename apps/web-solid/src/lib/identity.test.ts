import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ramp, traits } from "blobatar"
import { chatFaces, chatSeed, identityLook } from "./identity"

describe("identity look", () => {
  test("the same seed gives the same look", () => {
    expect(identityLook("ada")).toEqual(identityLook("ada"))
  })

  test("the colour is the blob's own head colour, lifted to read on the dark palette", () => {
    for (const seed of ["kiko", "piko", "ada", "01J0ROOM"]) {
      const t = traits(seed, true)
      const head = ramp(t.num("hue", 0, 360), true, t("tone")).head!
      const [, l, c, h] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(identityLook(seed).color)!.map(Number)
      expect(h).toBeCloseTo(head.h, 0)
      expect(c).toBeCloseTo(head.c, 2)
      expect(l).toBeGreaterThanOrEqual(0.72)
    }
  })

  test("different seeds spread over the hue circle", () => {
    const hues = new Set(Array.from({ length: 60 }, (_, i) => Math.round(Number(/ ([\d.]+)\)$/.exec(identityLook(`room-${i}`).color)![1]) / 60)))
    expect(hues.size).toBeGreaterThanOrEqual(4)
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

  test("every chat render site draws a group's stacked faces", () => {
    for (const site of ["sidebar/chat-panel.tsx", "app/tab-strip.tsx", "chat/ui/EmptyState.tsx", "palette/palette.tsx"]) {
      expect(files.find((f) => f.path.endsWith(site))?.text).toContain("<ChatAvatar faces={useApp.chatFaces(")
    }
  })

  test("no other file derives an avatar colour", () => {
    for (const f of files) {
      if (f.path.endsWith("lib/identity.ts")) continue
      expect(f.text).not.toMatch(/glyphHue|oklch\(0\.72 0\.12 \$\{/)
    }
  })
})

describe("chatSeed", () => {
  const agents = [{ id: "a1", slug: "ada" }]
  test.each([
    ["a chat with one agent wears that agent's face", { roomId: "r1", agents: ["a1"] }, "ada"],
    ["a chat made without a pick is the default agent", { roomId: "r2" }, "kiko"],
    ["a group has a face of its own", { roomId: "r3", agents: ["a1", "a2"] }, "r3"],
    ["an agent the list does not know yet falls back to its id", { roomId: "r4", agents: ["zz"] }, "zz"],
  ])("%s", (_name, chat, want) => expect(chatSeed(chat, agents)).toBe(want))
})

describe("chatFaces", () => {
  const agents = [
    { id: "a1", slug: "ada" },
    { id: "a2", slug: "bo" },
  ]
  test.each([
    ["one agent wears its own face", { roomId: "r1", agents: ["a1"] }, undefined, ["ada"]],
    ["a chat made without a pick is the default agent", { roomId: "r2" }, undefined, ["kiko"]],
    ["a group stacks its members, the built-in agent by its slug", { roomId: "r3", agents: ["kiko", "a1", "a2"] }, undefined, ["kiko", "ada", "bo"]],
    ["a group shows at most three", { roomId: "r4", agents: ["kiko", "a1", "a2", "zz"] }, undefined, ["kiko", "ada", "bo"]],
    ["the open room's live members win", { roomId: "r5", agents: ["a1", "a2"] }, ["bo", "cy"], ["bo", "cy"]],
    ["a group that lost all but one wears that one's face", { roomId: "r6", agents: ["a1", "a2"] }, ["bo"], ["bo"]],
  ] as const)("%s", (_name, chat, members, want) =>
    expect(chatFaces(chat, agents, members as readonly string[] | undefined)).toEqual([...want]),
  )
})
