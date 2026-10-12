import { expect, test } from "bun:test"
import { applyOps, candidates, captureActive, captureQuestions, captureWithJudge, DEFAULT_POLICY, mergePolicy, parseCapture } from "@yuki/memory/capture"
import type { Answer, Judge, Question } from "@yuki/memory/judge"
import { CARD_MAX, LIFE_STEPS, LIFE_TRI_STEPS, Life } from "@yuki/memory/life"
import { sqlWith } from "./sql-shim"

function life(sql = sqlWith([...LIFE_STEPS, ...LIFE_TRI_STEPS])) {
  const settings = new Map<string, string>()
  return new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
}

test("a superseded line leaves recall and the card, shows as replaced in the tree, and hands over its pin", () => {
  const l = life()
  l.append("lives in lisbon", "you", 1, { card: "IDENTITY" })
  for (let i = 0; i < 20; i++) l.append(`filler fact ${i}`, "@ada")
  l.pin(0, true)
  const next = l.append("lives in porto since october", "you", 3)
  if (!next.ok) throw new Error("append failed")
  l.settle({ lo: 0, hi: 8 }, "a summary that still mentions lisbon")
  expect(l.tree.node({ lo: 0, hi: 8 })).not.toBeNull()
  expect(l.supersede(0, next.pos)).toBe(true)
  expect(l.recall("lisbon")).toEqual([])
  expect(l.recall("lives").map((x) => x.pos)).toEqual([next.pos])
  expect(l.items(0, 1)[0]!.text).toBe(`(replaced, see #${next.pos})`)
  expect(l.tree.node({ lo: 0, hi: 8 })).toBeNull()
  expect(l.card()).toEqual([{ pos: next.pos, text: "lives in porto since october", pinned: true }])
  expect(l.supersede(0, next.pos)).toBe(false)
  expect(l.append("Lives in Lisbon", "you").ok && l.count()).toBe(next.pos + 2)
})

test("the card is pins first, then card lines newest first, at most twelve, and recall skips only what it shows", () => {
  const l = life()
  for (let i = 0; i < 16; i++) l.append(`card fact ${i}`, "you", i, { card: "ATTRIBUTE" })
  l.append("plain fact", "you")
  l.pin(5, true)
  l.pin(16, true)
  const head = l.view(Date.now()).split("\n").slice(0, CARD_MAX + 1)
  expect(head.slice(0, 2)).toEqual(["pinned: card fact 5", "pinned: plain fact"])
  expect(head.slice(2, CARD_MAX)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6].map((i) => `card: card fact ${i}`))
  expect(head[CARD_MAX]).not.toStartWith("card:")
  const skipped = l.recall("card fact", 30, { skipCard: true }).map((x) => x.pos).sort((a, b) => a - b)
  expect(skipped).toEqual([0, 1, 2, 3, 4])
  expect(l.recall("card fact", 30).length).toBe(17)
})

test("redacting by ref removes every line from that message and brings back the line it replaced", () => {
  const l = life()
  l.append("lives in lisbon", "you", 1, { ref: "room:r:msg:a" })
  l.append("moved to porto", "you", 2, { ref: "room:r:msg:b" })
  l.append("works at a bakery in porto", "you", 2, { ref: "room:r:msg:b" })
  l.append("has a dog named rex", "you", 3, { ref: "room:r2:msg:b" })
  l.supersede(0, 1)
  expect(l.redactRefs(["room:r:msg:b"]).sort()).toEqual([1, 2])
  expect(l.recall("porto")).toEqual([])
  expect(l.recall("lisbon").map((x) => x.pos)).toEqual([0])
  expect(l.recall("rex").map((x) => x.pos)).toEqual([3])
  expect(l.items(1, 2)[0]!.text).toBe("(removed by the human)")
  expect(l.redactRefs(["room:r:msg:b"])).toEqual([])
})

test("rollup refs are found by prefix", () => {
  const l = life()
  l.append("a week of trip planning", "chat trip", 1, { ref: "room:r:turns:0-128" })
  l.append("a week of work", "chat work", 1, { ref: "room:r2:turns:0-128" })
  expect(l.refsLike("room:r:turns:")).toEqual(["room:r:turns:0-128"])
})

test("the model's capture lines are read strictly, and a malformed line or an unknown fact is dropped", () => {
  const answer = [
    "+ the human's sister sam is a nurse [RELATIONSHIP]",
    "= 4",
    "~ 7 the human lives in porto [IDENTITY]",
    "~ 9 the human hates mornings",
    "= 99",
    "+",
    "sure! here is what i found:",
    "- the human likes tea",
    `+ ${"x".repeat(300)}`,
    "+ the human prefers short answers [WHATEVER]",
    "none",
  ].join("\n")
  expect(parseCapture(answer, new Set([4, 7]))).toEqual([
    { kind: "new", text: "the human's sister sam is a nurse", card: "RELATIONSHIP", from: 0 },
    { kind: "same", pos: 4 },
    { kind: "replace", pos: 7, text: "the human lives in porto", card: "IDENTITY", from: 0 },
    { kind: "new", text: "the human prefers short answers [WHATEVER]", card: null, from: 0 },
  ])
})

test("each applied fact carries the ref of the message it came from, and a replacement supersedes", () => {
  const l = life()
  l.append("the human lives in lisbon", "you", 1)
  const heard = [{ ref: "room:r:msg:m1", at: 5 }, { ref: "room:r:msg:m2", at: 6 }]
  const count = applyOps(l, parseCapture("~ 0 m2 the human lives in porto [IDENTITY]\n+ m1 the human has a cat\n+ m9 the human plays chess", new Set([0]), 2), heard)
  expect(count).toEqual({ added: 2, replaced: 1, same: 0, private: 0 })
  expect(l.recall("lives").map((x) => x.text)).toEqual(["the human lives in porto"])
  expect(l.redactRefs(["room:r:msg:m2"]).length).toBe(1)
  expect(l.recall("lives").map((x) => x.text)).toEqual(["the human lives in lisbon"])
  expect(l.recall("cat").map((x) => x.text)).toEqual(["the human has a cat"])
  expect(l.list(null, 10).find((x) => x.text === "the human lives in lisbon")?.supersededBy).toBeNull()
})

test("candidates are the sentences between 12 characters and 280 bytes, at most six", () => {
  expect(candidates("ok. My sister Sam is a nurse in Leeds! lol\nI moved to Porto last week.")).toEqual(["My sister Sam is a nurse in Leeds!", "I moved to Porto last week."])
  expect(candidates(Array.from({ length: 9 }, (_, i) => `This is sentence number ${i}.`).join(" ")).length).toBe(6)
  expect(candidates(`${"word ".repeat(80)}.`)).toEqual([])
})

test("the policy setting merges over the defaults and ignores fields of the wrong type", () => {
  expect(mergePolicy(null)).toEqual(DEFAULT_POLICY)
  expect(DEFAULT_POLICY.capture).toBe("auto")
  expect(mergePolicy('{"batch": 3, "worthMin": "high", "capture": "always"}')).toEqual({ ...DEFAULT_POLICY, batch: 3, capture: "always" })
  expect(mergePolicy('{"capture": "sometimes"}').capture).toBe("auto")
  expect(mergePolicy("not json")).toEqual(DEFAULT_POLICY)
})

test("a stored boolean capture means auto or off", () => {
  expect(mergePolicy('{"capture": true}').capture).toBe("auto")
  expect(mergePolicy('{"capture": false}').capture).toBe("off")
})

test("capture is active with always, with auto only when a judge is ready, and never when off", () => {
  const at = (capture: "auto" | "always" | "off") => ({ ...DEFAULT_POLICY, capture })
  expect(captureActive(at("auto"), false)).toBe(false)
  expect(captureActive(at("auto"), true)).toBe(true)
  expect(captureActive(at("always"), false)).toBe(true)
  expect(captureActive(at("off"), true)).toBe(false)
})

test("capture questions are pi-ai bool and choice questions that point into the state by path", () => {
  const { state, questions } = captureQuestions(["I moved to Pune. The weather is nice."], [
    { message: 0, candidate: "I moved to Pune.", known: [{ pos: 3, text: "lives in Bangalore" }, { pos: 9, text: "likes tea" }] },
    { message: 0, candidate: "The weather is nice.", known: [] },
  ])
  expect(state).toMatchObject({
    messages: ["I moved to Pune. The weather is nice."],
    candidates: [
      { text: "I moved to Pune.", message: 0 },
      { text: "The weather is nice.", message: 0 },
    ],
  })
  expect(Object.keys(questions).sort()).toEqual(
    ["c0_card", "c0_private", "c0_replaces_3", "c0_replaces_9", "c0_same_3", "c0_same_9", "c0_standing", "c0_worth", "c1_card", "c1_private", "c1_standing", "c1_worth"].sort(),
  )
  expect(questions.c0_replaces_9!.type).toBe("bool")
  expect(questions.c0_replaces_9!.instructions).toContain('Does `candidates[0].text` make this known fact: "likes tea" no longer true?')
  expect(questions.c1_worth!.instructions).toContain("`candidates[1].text`")
  for (const q of Object.values(questions)) {
    expect(typeof q.instructions).toBe("string")
    if (!/_(same|replaces)_/.test(Object.keys(questions).find((k) => questions[k] === q)!)) expect(q.instructions).not.toContain("Bangalore")
    if (q.type === "bool") expect([typeof q.criteria.true, typeof q.criteria.false]).toEqual(["string", "string"])
  }
  expect((state as { rules: { private: { false: string } } }).rules.private.false).toContain("food allergies or diets are not private")
  expect(questions.c0_card).toMatchObject({ type: "choice" })
})

type Verdict = { worth: number; standing?: number; private?: number; same?: number[]; replaces?: number[]; card?: string; cardP?: number }

type CaptureState = { candidates: { text: string; known: { pos: number; text: string }[] }[] }

function fakeJudge(verdicts: Record<string, Verdict>, seen: Question[][] = []): Judge {
  return (async (state: CaptureState, questions: Record<string, Question>) => {
    seen.push(Object.values(questions))
    const out: Record<string, Answer> = {}
    const yes = (probability: number): Answer => ({ type: "bool", probability })
    for (const key of Object.keys(questions)) {
      const [, index, kind, about] = /^c(\d+)_([a-z]+)(?:_(\d+))?$/.exec(key)!
      const v = verdicts[state.candidates[Number(index)]!.text]!
      if (kind === "worth") out[key] = yes(v.worth)
      else if (kind === "private") out[key] = yes(v.private ?? 0)
      else if (kind === "standing") out[key] = yes(v.standing ?? 0)
      else if (kind === "same") out[key] = yes(v.same?.includes(Number(about)) ? 0.9 : 0.05)
      else if (kind === "replaces") out[key] = yes(v.replaces?.includes(Number(about)) ? 0.9 : 0.05)
      else out[key] = { type: "choice", choice: v.card ?? "not_card", confidence: 0.9, probabilities: { [v.card ?? "not_card"]: v.cardP ?? 0.9 } }
    }
    return out
  }) as unknown as Judge
}

test("the judged path keeps only worthy, non-private facts, and a replacement supersedes every copy it corrects", async () => {
  const l = life()
  l.append("I live in Lisbon.", "you", 1)
  l.append("Human lives in Lisbon", "@yuki", 2)
  const text = "I live in Porto now. The weather is nice today. My passport number is X1234567. My partner Ana is a chef. Please keep answers short. Answer in one short line."
  const seen: Question[][] = []
  const judge = fakeJudge(
    {
      "I live in Porto now.": { worth: 0.9, replaces: [0, 1], card: "IDENTITY", cardP: 0.8 },
      "The weather is nice today.": { worth: 0.1 },
      "My passport number is X1234567.": { worth: 0.9, private: 0.95 },
      "My partner Ana is a chef.": { worth: 0.8, card: "RELATIONSHIP", cardP: 0.5 },
      "Please keep answers short.": { worth: 0.25, standing: 0.8, card: "INSTRUCTION", cardP: 0.86 },
      "Answer in one short line.": { worth: 0.2, standing: 0.1, card: "INSTRUCTION", cardP: 0.9 },
    },
    seen,
  )
  const count = await captureWithJudge(l, judge, [{ heard: { messageId: "m1", text, at: 10 }, ref: "room:r:msg:m1" }], DEFAULT_POLICY)
  expect(count).toEqual({ added: 2, replaced: 2, same: 0, private: 1 })
  expect(seen.length).toBe(1)
  expect(l.recall("lisbon")).toEqual([])
  expect(l.recall("passport")).toEqual([])
  expect(l.recall("weather")).toEqual([])
  expect(l.card().map((c) => c.text)).toEqual(["Please keep answers short.", "I live in Porto now."])
  expect(l.recall("ana chef").map((x) => x.text)).toEqual(["My partner Ana is a chef."])
  expect(l.redactRefs(["room:r:msg:m1"]).length).toBe(3)
})

test("an unavailable judge writes nothing, and a message changed meanwhile is not written", async () => {
  const l = life()
  const none: Judge = async () => null
  expect(await captureWithJudge(l, none, [{ heard: { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, ref: "room:r:msg:m1" }], DEFAULT_POLICY)).toBeNull()
  const judge = fakeJudge({ "My sister Sam is a nurse.": { worth: 0.9 } })
  expect(await captureWithJudge(l, judge, [{ heard: { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, ref: "room:r:msg:m1", keep: () => false }], DEFAULT_POLICY)).toEqual({ added: 0, replaced: 0, same: 0, private: 0 })
  expect(l.count()).toBe(0)
  expect((await captureWithJudge(l, judge, [{ heard: { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, ref: "room:r:msg:m1" }], DEFAULT_POLICY))!.added).toBe(1)
  expect((await captureWithJudge(l, judge, [{ heard: { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, ref: "room:r:msg:m1" }], DEFAULT_POLICY))!.same).toBe(1)
  expect(l.count()).toBe(1)
})

test("nearest offers a correction the facts it shares no word with", () => {
  const l = life()
  l.append("Human lives in Bangalore.", "@yuki", 1)
  l.append("the human likes green tea", "you", 2)
  expect(l.nearest("btw i moved to pune last month", 8).map((x) => x.text)).toContain("Human lives in Bangalore.")
  expect(l.nearest("tea", 1).map((x) => x.text)).toEqual(["the human likes green tea"])
})

test("questions and requests to the agent are never candidates", () => {
  expect(candidates("can you suggest a quick lunch idea")).toEqual([])
  expect(candidates("what's a good name for a houseplant")).toEqual([])
  expect(candidates("remind me how long to boil an egg for jammy yolks")).toEqual([])
  expect(candidates("where do i live now and what does my sister do?")).toEqual([])
  expect(candidates("oh and the dog's name is miso, she's a shiba")).toEqual(["oh and the dog's name is miso, she's a shiba"])
  expect(candidates("thanks! my sister lives in lisbon.")).toEqual(["my sister lives in lisbon."])
})

test("a queue of messages is judged in one request and each fact keeps its own message ref", async () => {
  const l = life()
  let calls = 0
  const inner = fakeJudge({ "My sister Sam is a nurse.": { worth: 0.9 }, "I work at the Porto library.": { worth: 0.9 } })
  const judge = (async (state: never, questions: never) => {
    calls++
    return inner(state, questions)
  }) as Judge
  const rows = [
    { heard: { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, ref: "room:r:msg:m1" },
    { heard: { messageId: "m2", text: "I work at the Porto library.", at: 2 }, ref: "room:r:msg:m2" },
  ]
  expect((await captureWithJudge(l, judge, rows, DEFAULT_POLICY))!.added).toBe(2)
  expect(calls).toBe(1)
  expect(l.redactRefs(["room:r:msg:m2"]).length).toBe(1)
  expect(l.recall("sam nurse").map((x) => x.text)).toEqual(["My sister Sam is a nurse."])
})

test("the criteria text is sent once in the state, not once per question", () => {
  const known = Array.from({ length: 8 }, (_, i) => ({ pos: i + 1, text: `fact ${i}` }))
  const items = Array.from({ length: 3 }, (_, i) => ({ message: 0, candidate: `candidate number ${i}`, known }))
  const { state, questions } = captureQuestions(["m"], items)
  const bytes = JSON.stringify({ state, questions }).length
  expect(Object.keys(questions).length).toBe(3 * (4 + 16))
  expect(bytes).toBeLessThan(40_000)
  expect(JSON.stringify(questions).split("different fact. A different name").length - 1).toBe(0)
})
