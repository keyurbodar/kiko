import { describe, expect, it } from "vitest"
import { findTrigger } from "./prompt-input/machine"
import { fileRefToken, shownName } from "./rich/file-ref"
import { markdownToDoc, docToMarkdown } from "./rich/markdown"
import { skillNames, tokenGroups, type Token, type TokenPool } from "./tokens"

const agent = (slug: string, title: string): Token => ({
  kind: "agent",
  id: `agent:${slug}`,
  slug,
  title,
  hint: "Agent",
})

const pool: TokenPool = {
  agents: () => [agent("alpha", "Alpha"), agent("beta", "Beta")],
  files: () => [{ kind: "file", id: "file:a", path: "budget.xlsx", title: "budget.xlsx", hint: "Tokyo trip" }],
  apps: () => [{ kind: "app", id: "app:gmail", slug: "gmail", title: "Gmail", hint: "Connected" }],
  skills: () => [{ kind: "skill", id: "skill:summarize", name: "summarize", title: "Summarize", hint: "" }],
  recipes: () => [
    { kind: "recipe", id: "recipe:weekly", name: "weekly-money-check", title: "Weekly money check", hint: "" },
  ],
  commands: () => [{ kind: "command", id: "slash-remind", trigger: "remind", title: "Remind me", hint: "/remind" }],
}

describe("token groups", () => {
  it("puts agents, files and apps under @ and filters as you type", () => {
    expect(tokenGroups(pool, "@", "", false).map((g) => g.label)).toEqual(["Agents", "Files", "Apps"])
    const typed = tokenGroups(pool, "@", "be", false)
    expect(typed.map((g) => g.label)).toEqual(["Agents", "Files"])
    expect(typed[0]!.items.map((t) => t.title)).toEqual(["Beta"])
  })

  it("offers commands under / only at the start of the message", () => {
    expect(tokenGroups(pool, "/", "", true).map((g) => g.label)).toEqual(["Skills", "Recipes", "Commands"])
    expect(tokenGroups(pool, "/", "", false).map((g) => g.label)).toEqual(["Skills", "Recipes"])
    expect(tokenGroups(pool, "/", "money", false)[0]!.items[0]!.title).toBe("Weekly money check")
  })

  it("reads room skills from their SKILL.md paths", () => {
    expect(skillNames(["skills/summarize/SKILL.md", "skills/summarize/notes.md", "notes/SKILL.md"])).toEqual([
      "summarize",
    ])
  })
})

describe("triggers", () => {
  it("opens on @ or / after a space and not inside a path or address", () => {
    expect(findTrigger("Ask @al", 7)).toMatchObject({ trigger: "@", query: "al", start: 4, atStart: false })
    expect(findTrigger("/rem", 4)).toMatchObject({ trigger: "/", query: "rem", atStart: true })
    expect(findTrigger("see src/app", 11)).toBeNull()
    expect(findTrigger("mail me@home", 12)).toBeNull()
  })
})

describe("slash tokens in the draft", () => {
  it("parses a known skill into a chip and writes it back as plain /name", () => {
    const doc = markdownToDoc("then run /summarize and /unknown", { isSlash: (name) => name === "summarize" })
    const inline = doc.content?.[0]?.content ?? []
    expect(inline.map((node) => node.type)).toEqual(["text", "slash", "text"])
    expect(docToMarkdown(doc)).toBe("then run /summarize and /unknown")
  })
})

describe("file names", () => {
  it("drops the upload stamp from attachment names and keeps the real path in the draft", () => {
    expect(shownName("attachments/mvmm766u-budget.csv")).toBe("budget.csv")
    expect(shownName("notes/mvmm766u-budget.csv")).toBe("mvmm766u-budget.csv")
    expect(fileRefToken("attachments/mvmm766u-budget.csv")).toBe("[budget.csv](/attachments/mvmm766u-budget.csv)")
  })
})
