import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { setAvatarPicks } from "../avatar/picks"
import { chatFaces, chatSeed, identityLook } from "./identity"

describe("identity look", () => {
  test("the same seed gives the same look", () => {
    expect(identityLook("ada")).toEqual(identityLook("ada"))
  })

  test("the chief is Kiko and wears the theme accent", () => {
    expect(identityLook("kiko").color).toBe("var(--ring)")
  })

  test("an agent colour reads on both appearances", () => {
    expect(identityLook("scout").color).toStartWith("light-dark(")
  })

  test("a flavor the person picks sets the colour everywhere it is read", () => {
    const before = identityLook("ada").color
    setAvatarPicks({ ada: { flavour: "ichigo" } })
    expect(identityLook("ada").color).not.toBe(before)
    expect(identityLook("ada").color).toContain("light-dark(")
    setAvatarPicks({})
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
    for (const site of ["sidebar/chat-panel.tsx", "palette/palette.tsx"]) {
      expect(files.find((f) => f.path.endsWith(site))?.text).toContain("<ChatAvatar faces={useApp.chatFaces(")
    }
  })

  test("a chat's faces come from its record alone, so the open chat and its tile agree", () => {
    const store = files.find((f) => f.path.endsWith("lib/store.ts"))!.text
    const body = store.slice(store.indexOf("chatFaces(roomId: string)"), store.indexOf("roomMembers()"))
    expect(body).toContain("chatFaces(chat ?? { roomId }")
    expect(body).not.toMatch(/members\(\)|room\(\)/)
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
    ["one agent wears its own face", { roomId: "r1", agents: ["a1"] }, ["ada"]],
    ["a chat made without a pick is the default agent", { roomId: "r2" }, ["kiko"]],
    ["a group stacks its members, the built-in agent by its slug", { roomId: "r3", agents: ["kiko", "a1", "a2"] }, ["kiko", "ada", "bo"]],
    ["a group shows at most three", { roomId: "r4", agents: ["kiko", "a1", "a2", "zz"] }, ["kiko", "ada", "bo"]],
    ["a chat with one picked agent stays one-to-one", { roomId: "r7", agents: ["a2"] }, ["bo"]],
    ["a closed group shows kiko as its chief, the faces it has once open", { roomId: "r8", agents: ["a1", "a2"] }, ["kiko", "ada", "bo"]],
  ] as const)("%s", (_name, chat, want) => expect(chatFaces(chat, agents)).toEqual([...want]))
})
