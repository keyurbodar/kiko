import type { Task } from "../../types"
import { check, mulberry32, pick, sample, verdict, writeJson } from "../helpers"
import { BROWSER_OS, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const HEADINGS = ["Release checklist", "Launch notes", "Weekend handover", "Incident follow-up", "Support briefing"]
const WORDS = ["urgent", "blocked", "critical", "waiting", "confirmed"]
const BULLETS = [
  "Tag the release",
  "Run the smoke tests",
  "Post the changelog",
  "Page the on-call engineer",
  "Check the billing dashboard",
  "Close the stale tickets",
  "Email the support team",
  "Update the status page",
]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  return {
    heading: pick(rng, HEADINGS),
    word: pick(rng, WORDS),
    bullets: sample(rng, BULLETS, 3),
  }
}

const strip = (value: string): string =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()

const inner = (html: string, pattern: RegExp): string[] =>
  [...html.matchAll(pattern)].map((match) => strip(match[1] ?? ""))

export const richText: Task = {
  id: "browser-111-rich-text",
  track: "browser",
  kind: "edge",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Write the note on the page in url.txt. Use the heading in request.json, put the word from request.json in bold inside a sentence, and add the three items from request.json as a bulleted list. Save the note.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", data)
    await openPage(m, "browser-111-rich-text", data, "/note")
  },
  oracle: (m) => runBrowserOracle(m, "browser-111-rich-text"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const note = (await browserState(m))?.note as { html?: string } | undefined
    const html = note?.html ?? ""
    const headings = inner(html, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)
    const bold = [...html.matchAll(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi)].map((match) =>
      strip(match[1] ?? ""),
    )
    const bullets = inner(html, /<li\b[^>]*>([\s\S]*?)<\/li>/gi)
    return verdict([
      check("note saved", Boolean(note), `note = ${JSON.stringify(note)}`),
      check("heading", headings.includes(expected.heading), `headings = ${JSON.stringify(headings)}`),
      check(
        "bold word",
        bold.some((text) => text.toLowerCase().includes(expected.word)),
        `bold = ${JSON.stringify(bold)}`,
      ),
      check(
        "bullets",
        JSON.stringify(bullets) === JSON.stringify(expected.bullets),
        `bullets = ${JSON.stringify(bullets)}`,
      ),
    ])
  },
}
