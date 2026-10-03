import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { seedBird, SPECIES } from "../mascot/birds"
import { chatFaces, chatSeed, identityLook } from "./identity"

describe("identity look", () => {
  test("the same seed gives the same look", () => {
    expect(identityLook("ada")).toEqual(identityLook("ada"))
  })

  test("the kiko agent is the kiko bird and wears the theme accent", () => {
    expect(seedBird("kiko").species).toBe("kiko")
    expect(identityLook("kiko").color).toBe("var(--accent)")
  })

  test("other seeds spread over the flock and never draw the kiko bird", () => {
    const species = new Set(Array.from({ length: 80 }, (_, i) => seedBird(`agent-${i}`).species))
    expect(species.has("kiko")).toBe(false)
    expect(species.size).toBeGreaterThanOrEqual(10)
    expect([...species].every((s) => s in SPECIES)).toBe(true)
  })

  test("an agent colour reads on both appearances", () => {
    expect(identityLook("scout").color).toStartWith("light-dark(")
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

  test("nothing imports the blobatar any more", () => {
    expect(files.filter((f) => /from "(@blobatar\/solid|blobatar)"/.test(f.text)).map((f) => f.path)).toEqual([])
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
    ["a chat with one picked agent stays one-to-one", { roomId: "r7", agents: ["a2"] }, undefined, ["bo"]],
    ["a closed group shows kiko as its chief, the faces it has once open", { roomId: "r8", agents: ["a1", "a2"] }, undefined, ["kiko", "ada", "bo"]],
    ["opening that group changes nothing", { roomId: "r8", agents: ["a1", "a2"] }, ["kiko", "ada", "bo"], ["kiko", "ada", "bo"]],
    ["the open room's live members win", { roomId: "r5", agents: ["a1", "a2"] }, ["bo", "cy"], ["bo", "cy"]],
    ["a group that lost all but one wears that one's face", { roomId: "r6", agents: ["a1", "a2"] }, ["bo"], ["bo"]],
  ] as const)("%s", (_name, chat, members, want) =>
    expect(chatFaces(chat, agents, members as readonly string[] | undefined)).toEqual([...want]),
  )
})
