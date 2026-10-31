import type { Task } from "../../types"
import { check, LIMITS, mulberry32, pick, readText, run, verdict, writeJson, writeText } from "../helpers"

const TITLES = ["Release checklist", "Incident review", "Roadmap notes", "Weekly sync"]
const AUTHORS = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya"]
const NOTES = ["keep the draft short", "revisit after launch", "ask the owner first", "fold into the summary"]
const STATUSES = ["review", "published", "archived", "active"]

const notes = (seed: number): { readonly text: string; readonly status: string } => {
  const rng = mulberry32(seed)
  const lines = [
    `Title: ${pick(rng, TITLES)}`,
    `Author: ${pick(rng, AUTHORS)}`,
    "STATUS=draft",
    `Note: ${pick(rng, NOTES)}`,
  ]
  return { text: `${lines.join("\n")}\n`, status: pick(rng, STATUSES) }
}

const expectedText = (seed: number): string => {
  const { text, status } = notes(seed)
  return text.replace("STATUS=draft", `STATUS=${status}`)
}

export const vimEdit: Task = {
  id: "terminal-009-vim-edit",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: true,
  prompt:
    "Open notes.txt in the terminal editor, change the value on the STATUS line to the one in request.json, and save the file. Leave everything else untouched.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { text, status } = notes(seed)
    await writeJson(m, "request.json", { status })
    await writeText(m, "notes.txt", text)
  },
  oracle: async (m, seed) => {
    const { status } = notes(seed)
    const command = `%s/^STATUS=.*/STATUS=${status}/`
    const result = await run(m, ["vim", "-es", "-c", command, "-c", "wq", "notes.txt"])
    if (result.code !== 0) await run(m, ["vi", "-es", "-c", command, "-c", "wq", "notes.txt"])
  },
  check: async (m, seed) => {
    const expected = expectedText(seed)
    const actual = await readText(m, "notes.txt")
    return verdict([check("notes match", actual === expected, `notes.txt was ${JSON.stringify(actual)}`)])
  },
}
