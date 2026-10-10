import { describe, expect, test } from "bun:test"
import hn from "./fixtures/hn.json"
import { choices } from "../src/plan/candidates"
import { jevRanker, lexicalRanker, passages } from "../src/plan/rank"
import { summarize } from "../src/plan/summary"
import { BROWSER } from "../src/config"
import type { PageView } from "../src/page/types"
import { live, page } from "./site"

const hnPage = hn as PageView

describe("candidates", () => {
  test("keeps the comments link of the 3rd story among 104 controls", () => {
    const cs = choices(hnPage, "open the comments of the 3rd story", {})
    expect(cs.find((c) => c.key === "k31")?.text).toEndWith('link "' + hnPage.controls[30].label + '" (story 3, comments)')
    expect(cs.filter((c) => c.key.startsWith("k")).length).toBeLessThanOrEqual(BROWSER.candidates)
  })

  test("a spelled-out ordinal keeps the same control", () => {
    const keys = choices(hnPage, "comments on the third story", {}).map((c) => c.key)
    expect(keys).toContain("k31")
  })

  test("keeps the top nav and the newest link for 'newest submissions'", () => {
    const keys = choices(hnPage, "see the newest submissions", {}).map((c) => c.key)
    expect(keys).toContain("k3")
    expect(keys.filter((k) => /^k([1-9]|10)$/.test(k)).length).toBe(BROWSER.navKept)
  })

  test("'log in' reaches the login link", () => {
    expect(choices(hnPage, "log in", {}).map((c) => c.key)).toContain("k10")
  })

  test("with no word match it keeps the first controls in reading order", () => {
    const p = page("fr", Array.from({ length: 80 }, (_, i) => ({ role: "button", label: `bouton ${i}` })))
    const keys = choices(p, "zzz qqq", {}).map((c) => c.key)
    expect(keys.slice(0, BROWSER.candidates)).toEqual(Array.from({ length: BROWSER.candidates }, (_, i) => `k${i + 1}`))
  })

  test("type options exist only for provided value names, and carry the value", () => {
    const p = page("s", [{ role: "searchbox", label: "Search" }, { role: "link", label: "Home" }])
    const none = choices(p, "search for kernel", {})
    expect(none.some((c) => c.step.op === "type" && c.step.text !== "")).toBe(false)
    const some = choices(p, "search for kernel", { query: "kernel pricing", city: "Oslo" })
    const typed = some.filter((c) => c.step.op === "type")
    expect(typed.map((c) => (c.step.op === "type" ? c.step.text : ""))).toEqual(["kernel pricing", "Oslo"])
    expect(typed[0].text).toBe('1 type query into searchbox "Search"')
    for (const k of ["sd", "done", "stuck"]) expect(some.map((c) => c.key)).toContain(k)
  })

  test("a field with no values offers one needs-value option, marked by empty text", () => {
    const p = page("s", [{ role: "textbox", label: "Email" }])
    const t = choices(p, "sign up", {}).filter((c) => c.step.op === "type")
    expect(t).toHaveLength(1)
    expect(t[0].step).toMatchObject({ op: "type", text: "" })
  })

  test("select options come from provided values", () => {
    const p = page("s", [{ role: "select", label: "Color" }])
    const s = choices(p, "pick a color", { color: "Red" }).find((c) => c.step.op === "select")
    expect(s?.step).toEqual({ op: "select", id: 1, option: "Red" })
  })
})

describe("summary and passages", () => {
  test("a summary caps controls and text, and prefers controls that match find", () => {
    const s = summarize({ ...hnPage, text: "x".repeat(5000) })
    const lines = s.split("\n")
    expect(lines.filter((l) => /^\d+ link/.test(l)).length).toBe(BROWSER.summaryControls)
    expect(s.length).toBeLessThan(BROWSER.summaryText + BROWSER.summaryControls * 90 + 200)
    expect(summarize(hnPage, "3rd story comments")).toContain(' link "')
    expect(summarize(hnPage, "3rd story comments").split("\n")).toContain(`31 link "${hnPage.controls[30].label}"`)
  })

  test("passages returns the relevant paragraph under the limit", () => {
    const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} talks about weather and gardens in spring.`).join("\n")
    const text = `${filler}\nPricing for the kernel browser starts at twenty dollars a month.\n${filler}`
    const out = passages(text, "kernel browser pricing", 2)
    expect(out).toContain("Pricing for the kernel browser")
    expect(out.length).toBeLessThanOrEqual(BROWSER.summaryText)
  })

  test("jevRanker asks one yes-or-no question per passage in one request, and falls back without noul", async () => {
    let requests = 0
    const ranker = jevRanker({
      choose: async () => ({ key: "", probabilities: {}, confidence: 1 }),
      noul: async (req) => {
        requests++
        return Object.fromEntries(req.questions.map((q) => [q.key, q.instructions.includes("needle") ? 0.9 : 0.1]))
      },
    })
    expect(await ranker.rank("find", ["hay", "a needle", "hay"], live())).toEqual([0.1, 0.9, 0.1])
    expect(requests).toBe(1)
    const lex = jevRanker({ choose: async () => ({ key: "", probabilities: {}, confidence: 1 }) })
    const scores = await lex.rank("needle", ["hay", "a needle"], live())
    expect(scores[1]).toBeGreaterThan(scores[0])
    expect(await lexicalRanker.rank("needle", ["needle"], live())).toHaveLength(1)
  })
})
