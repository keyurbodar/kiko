import { expect, test } from "bun:test"
import { applyOps, candidates, captureWithJudge, DEFAULT_POLICY, mergePolicy, parseCapture } from "@yuki/memory/capture"
import type { Answer, Judge, Question } from "@yuki/memory/judge"
import { CARD_MAX, Life } from "@yuki/memory/life"
import { TYPESAFE_REFUSED, TYPESAFE_URL, typesafeJudge } from "../src/user/jev"
import { sqlStorage } from "./sql-shim"

function life(sql = sqlStorage()) {
  const settings = new Map<string, string>()
  return new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
}

test("an old life table gains ref, superseded_by, and card, and its rows stay live", () => {
  const sql = sqlStorage()
  sql.exec("CREATE TABLE life (pos INTEGER PRIMARY KEY, at INTEGER NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', norm TEXT NOT NULL, tainted INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, redacted INTEGER NOT NULL DEFAULT 0)")
  sql.exec("CREATE VIRTUAL TABLE life_fts USING fts5(text)")
  sql.exec("INSERT INTO life (pos, at, text, source, norm) VALUES (0, 1, 'sister is sam', '@ada', 'sister sam')")
  sql.exec("INSERT INTO life_fts (rowid, text) VALUES (0, 'sister is sam')")
  const l = life(sql)
  const columns = sql.exec<{ name: string }>("PRAGMA table_info(life)").toArray().map((c) => c.name)
  expect(columns).toEqual(expect.arrayContaining(["ref", "superseded_by", "card"]))
  expect(l.recall("sister").map((x) => x.text)).toEqual(["sister is sam"])
  expect(l.append("works as a nurse", "you", false, 2, { ref: "room:r:msg:m1", card: "IDENTITY" })).toEqual({ ok: true, pos: 1 })
  expect(l.view(Date.now()).split("\n")[0]).toBe("card: works as a nurse")
  life(sql)
})

test("a superseded line leaves recall and the card, shows as replaced in the tree, and hands over its pin", () => {
  const l = life()
  l.append("lives in lisbon", "you", false, 1, { card: "IDENTITY" })
  for (let i = 0; i < 20; i++) l.append(`filler fact ${i}`, "@ada", false)
  l.pin(0, true)
  const next = l.append("lives in porto since october", "you", false, 3)
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
  expect(l.append("Lives in Lisbon", "you", false).ok && l.count()).toBe(next.pos + 2)
})

test("the card is pins first, then card lines newest first, at most twelve, and recall skips only what it shows", () => {
  const l = life()
  for (let i = 0; i < 16; i++) l.append(`card fact ${i}`, "you", false, i, { card: "ATTRIBUTE" })
  l.append("plain fact", "you", false)
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
  l.append("lives in lisbon", "you", false, 1, { ref: "room:r:msg:a" })
  l.append("moved to porto", "you", false, 2, { ref: "room:r:msg:b" })
  l.append("works at a bakery in porto", "you", false, 2, { ref: "room:r:msg:b" })
  l.append("has a dog named rex", "you", false, 3, { ref: "room:r2:msg:b" })
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
  l.append("a week of trip planning", "chat trip", false, 1, { ref: "room:r:turns:0-128" })
  l.append("a week of work", "chat work", false, 1, { ref: "room:r2:turns:0-128" })
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
  l.append("the human lives in lisbon", "you", false, 1)
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
  expect(mergePolicy('{"batch": 3, "worthMin": "high", "capture": false}')).toEqual({ ...DEFAULT_POLICY, batch: 3, capture: false })
  expect(mergePolicy("not json")).toEqual(DEFAULT_POLICY)
})

function jevDeps(key: string | null, fetcher: typeof fetch) {
  const settings = new Map<string, string>()
  const usage: Record<string, number> = {}
  return {
    settings,
    usage,
    deps: {
      key: async () => key,
      setting: (k: string) => settings.get(k) ?? null,
      putSetting: (k: string, v: string | null) => void (v === null ? settings.delete(k) : settings.set(k, v)),
      count: (k: string, n = 1) => void (usage[k] = (usage[k] ?? 0) + n),
      fetch: fetcher,
    },
  }
}

const ONE: Record<string, Question> = { worth: { type: "noul", instructions: "Is it worth it?" } }

test("a refused TypeSafe key is marked by its last four and not sent again until the key changes", async () => {
  let calls = 0
  const refuse = (async () => {
    calls++
    return new Response("{}", { status: 401 })
  }) as unknown as typeof fetch
  const a = jevDeps("ts-key-abcd", refuse)
  expect(await typesafeJudge(a.deps, 1000)("state", ONE)).toBeNull()
  expect(a.settings.get(TYPESAFE_REFUSED)).toBe("abcd")
  expect(a.usage.jev_refused).toBe(1)
  expect(await typesafeJudge(a.deps, 1000)("state", ONE)).toBeNull()
  expect(calls).toBe(1)
  const ok = (async () => Response.json({ model: "jev-1", answers: { worth: { type: "noul", noul: 0.8 } }, usage: { input_tokens: 10, output_tokens: 2 } })) as unknown as typeof fetch
  const b = jevDeps("ts-key-wxyz", ok)
  b.settings.set(TYPESAFE_REFUSED, "abcd")
  expect(await typesafeJudge(b.deps, 1000)("state", ONE)).toEqual({ worth: { type: "noul", noul: 0.8 } })
  expect(b.settings.has(TYPESAFE_REFUSED)).toBe(false)
  expect(await typesafeJudge(jevDeps(null, ok).deps, 1000)("state", ONE)).toBeNull()
})

test("a slow TypeSafe answer times out to null", async () => {
  const hang = ((_: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch
  const { deps, usage } = jevDeps("ts-key-abcd", hang)
  const started = Date.now()
  expect(await typesafeJudge(deps, 50)("state", ONE)).toBeNull()
  expect(Date.now() - started).toBeLessThan(1000)
  expect(usage.jev_errors).toBe(1)
})

test("a TypeSafe success maps answers, sends the documented body, and rejects answers of the wrong shape", async () => {
  let sent: { url: string; auth: string | null; body: Record<string, unknown> } | null = null
  const questions: Record<string, Question> = { ...ONE, kind: { type: "choice", instructions: "Which?", criteria: { a: null, b: null } } }
  const reply = (answers: unknown) =>
    (async (url: string, init: RequestInit) => {
      sent = { url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(init.body as string) }
      return Response.json({ model: "jev-1", answers, usage: { input_tokens: 300, output_tokens: 20 } })
    }) as unknown as typeof fetch
  const good = jevDeps("ts-key-abcd", reply({ worth: { type: "noul", noul: 0.2 }, kind: { type: "choice", choice: "b", confidence: 0.9, probabilities: { a: 0.05, b: 0.95 } } }))
  expect(await typesafeJudge(good.deps, 1000)({ message: "hi" }, questions)).toEqual({
    worth: { type: "noul", noul: 0.2 },
    kind: { type: "choice", choice: "b", confidence: 0.9, probabilities: { a: 0.05, b: 0.95 } },
  })
  expect(sent!.url).toBe(TYPESAFE_URL)
  expect(sent!.auth).toBe("Bearer ts-key-abcd")
  expect(sent!.body).toEqual({ state: { message: "hi" }, model: "jev-latest", questions })
  expect(good.usage).toEqual({ jev_input: 300, jev_output: 20 })
  const bad = jevDeps("ts-key-abcd", reply({ worth: { type: "choice", choice: "x" } }))
  expect(await typesafeJudge(bad.deps, 1000)("s", questions)).toBeNull()
  expect(bad.usage.jev_errors).toBe(1)
})

type Verdict = { worth: number; standing?: number; private?: number; same?: number[]; replaces?: number[]; card?: string; cardP?: number }

function fakeJudge(verdicts: Record<string, Verdict>, seen: Question[][] = []): Judge {
  return (async (_state: unknown, questions: Record<string, Question>) => {
    seen.push(Object.values(questions))
    const out: Record<string, Answer> = {}
    for (const [key, q] of Object.entries(questions)) {
      const v = verdicts[(q.instructions as { candidate: string }).candidate]!
      const kind = key.slice(key.indexOf("_") + 1)
      const about = Number(kind.split("_")[1])
      if (kind === "worth") out[key] = { type: "noul", noul: v.worth }
      else if (kind === "private") out[key] = { type: "noul", noul: v.private ?? 0 }
      else if (kind === "standing") out[key] = { type: "noul", noul: v.standing ?? 0 }
      else if (kind.startsWith("same_")) out[key] = { type: "noul", noul: v.same?.includes(about) ? 0.9 : 0.05 }
      else if (kind.startsWith("replaces_")) out[key] = { type: "noul", noul: v.replaces?.includes(about) ? 0.9 : 0.05 }
      else out[key] = { type: "choice", choice: v.card ?? "not_card", confidence: 0.9, probabilities: { [v.card ?? "not_card"]: v.cardP ?? 0.9 } }
    }
    return out
  }) as Judge
}

test("the judged path keeps only worthy, non-private facts, and a replacement supersedes every copy it corrects", async () => {
  const l = life()
  l.append("I live in Lisbon.", "you", false, 1)
  l.append("Human lives in Lisbon", "@yuki", false, 2)
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
  const count = await captureWithJudge(l, judge, { messageId: "m1", text, at: 10 }, "room:r:msg:m1", DEFAULT_POLICY)
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
  expect(await captureWithJudge(l, none, { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, "room:r:msg:m1", DEFAULT_POLICY)).toBeNull()
  const judge = fakeJudge({ "My sister Sam is a nurse.": { worth: 0.9 } })
  expect(await captureWithJudge(l, judge, { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, "room:r:msg:m1", DEFAULT_POLICY, () => false)).toEqual({ added: 0, replaced: 0, same: 0, private: 0 })
  expect(l.count()).toBe(0)
  expect((await captureWithJudge(l, judge, { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, "room:r:msg:m1", DEFAULT_POLICY))!.added).toBe(1)
  expect((await captureWithJudge(l, judge, { messageId: "m1", text: "My sister Sam is a nurse.", at: 1 }, "room:r:msg:m1", DEFAULT_POLICY))!.same).toBe(1)
  expect(l.count()).toBe(1)
})

test("nearest offers a correction the facts it shares no word with", () => {
  const l = life()
  l.append("Human lives in Bangalore.", "@yuki", false, 1)
  l.append("the human likes green tea", "you", false, 2)
  expect(l.nearest("btw i moved to pune last month", 8).map((x) => x.text)).toContain("Human lives in Bangalore.")
  expect(l.nearest("tea", 1).map((x) => x.text)).toEqual(["the human likes green tea"])
})
