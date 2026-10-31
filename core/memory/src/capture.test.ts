import type { JsonObject } from "@earendil-works/pi-ai"
import { describe, expect, it } from "vitest"
import { captureWithJudge } from "./capture"
import type { Answer, Judge, Question } from "./judge"
import type { Life, LifeLine } from "./life"

type Call = { candidates: string[]; questions: Record<string, Question> }

const judgeOf = (calls: Call[]): Judge =>
  (async (state: JsonObject, questions: Record<string, Question>) => {
    calls.push({ candidates: (state.candidates as unknown as { text: string }[]).map((c) => c.text), questions })
    return Object.fromEntries(
      Object.entries(questions).map(([key, question]) => [
        key,
        question.type === "bool"
          ? { type: "bool", probability: 0 }
          : { type: "choice", choice: "not_card", probabilities: { not_card: 0 }, confidence: 0 },
      ]),
    ) as unknown as Record<string, Answer>
  }) as unknown as Judge

const lifeOf = (facts: { pos: number; text: string }[]) => {
  const line = (fact: { pos: number; text: string }): LifeLine => ({
    ...fact,
    at: 0,
    source: "",
    pinned: false,
    redacted: false,
    supersededBy: null,
  })
  const appended: string[] = []
  const life = {
    nearest: (_text: string, limit: number) => facts.slice(0, limit).map(line),
    captureAllowed: () => true,
    append: (text: string) => {
      appended.push(text)
      return { ok: true as const, pos: appended.length - 1 }
    },
    supersede: () => false,
  }
  return { life: life as unknown as Life, appended }
}

const sentence = (n: number) => `the team shipped feature number ${n} to production today`
const heard = (base: number) => ({
  messageId: `m${base}`,
  text: `${Array.from({ length: 6 }, (_, i) => sentence(base + i)).join(". ")}.`,
  at: 1_000,
})

describe("capture questions", () => {
  it("asks about at most three known facts, all sharing a keyword", async () => {
    const facts = [
      { pos: 1, text: "maya lives in lisbon" },
      { pos: 2, text: "maya works at acme" },
      { pos: 3, text: "lisbon is rainy in winter" },
      { pos: 4, text: "maya likes tea" },
      { pos: 5, text: "maya drives a renault" },
      { pos: 6, text: "maya reads poetry" },
    ]
    const { life } = lifeOf(facts)
    const calls: Call[] = []
    await captureWithJudge(life, judgeOf(calls), [
      { heard: { messageId: "m1", text: "my sister maya lives in lisbon now", at: 1_000 }, ref: "m1" },
    ])
    const keys = Object.keys(calls[0]!.questions)
    expect(keys).toHaveLength(10)
    expect(keys.filter((key) => key.startsWith("c0_same_"))).toEqual(["c0_same_1", "c0_same_2", "c0_same_3"])
    expect(keys.filter((key) => key.startsWith("c0_replaces_"))).toEqual([
      "c0_replaces_1",
      "c0_replaces_2",
      "c0_replaces_3",
    ])
  })

  it("drops the same and replaces questions for known facts with no shared keyword", async () => {
    const { life } = lifeOf([{ pos: 7, text: "loves jazz music" }])
    const calls: Call[] = []
    await captureWithJudge(life, judgeOf(calls), [
      { heard: { messageId: "m1", text: "my sister maya lives in lisbon now", at: 1_000 }, ref: "m1" },
    ])
    expect(Object.keys(calls[0]!.questions)).toHaveLength(4)
    expect(Object.keys(calls[0]!.questions).some((key) => key.includes("_same_") || key.includes("_replaces_"))).toBe(
      false,
    )
  })

  it("splits candidates across judge calls of at most eight", async () => {
    const { life } = lifeOf([])
    const calls: Call[] = []
    const count = await captureWithJudge(life, judgeOf(calls), [
      { heard: heard(1), ref: "m1" },
      { heard: heard(11), ref: "m2" },
    ])
    expect(calls.map((call) => call.candidates.length)).toEqual([8, 4])
    expect(count).toEqual({ added: 0, replaced: 0, same: 0, private: 0 })
  })
})
