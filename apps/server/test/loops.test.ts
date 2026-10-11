import { expect, test } from "bun:test"
import { type Loop, loopOps, Loops, parseNapLoops, sentencesOf } from "@yuki/memory/loops"
import { sqlStorage } from "./sql-shim"

const store = () => new Loops(sqlStorage(), (fn) => fn())
const base = { kind: "intention" as const, owner: "human", source: "tool" as const }

test("a repeat merges into one loop, firms a tentative one up, and never softens an explicit one", () => {
  const loops = store()
  const first = loops.open({ ...base, certainty: "tentative", text: "Start running again" })
  if (!first.ok) throw new Error("open failed")
  expect(loops.open({ ...base, certainty: "tentative", text: "start running again!" })).toEqual({ ok: true, id: first.id, merged: true })
  expect(loops.open({ ...base, certainty: "explicit", text: "run three times a week", due: "2026-10-17" }, first.id)).toEqual({ ok: true, id: first.id, merged: true })
  expect(loops.open({ ...base, certainty: "tentative", text: "maybe run" }, first.id).ok).toBe(true)
  const [only] = loops.list()
  expect(loops.list().length).toBe(1)
  expect(only).toMatchObject({ certainty: "explicit", text: "Start running again", due: "2026-10-17", mentions: 4 })
  expect(loops.open({ ...base, owner: "@ada", certainty: "explicit", text: "start running again" })).toMatchObject({ merged: false })
  expect(loops.open({ ...base, owner: "ada", certainty: "explicit", text: "bring a running plan" }, first.id)).toMatchObject({ merged: false })
})

test("a closed loop leaves the live list and search, and is not closed twice", () => {
  const loops = store()
  const grant = loops.open({ ...base, certainty: "explicit", text: "submit the grant report by friday", ref: "room:r:msg:m1" })
  const lease = loops.open({ ...base, kind: "waiting", certainty: "explicit", text: "waiting on the landlord about the lease" })
  if (!grant.ok || !lease.ok) throw new Error("open failed")
  expect(loops.similar("the grant report").map((l) => l.id)).toEqual([grant.id])
  expect(loops.close(grant.id, "done")).toBe(true)
  expect(loops.close(grant.id, "done")).toBe(false)
  expect(loops.similar("the grant report")).toEqual([])
  expect(loops.list().map((l) => l.id)).toEqual([lease.id])
  expect(loops.get(grant.id)?.status).toBe("done")
  expect(loops.open({ ...base, certainty: "explicit", text: "submit the grant report by friday" })).toMatchObject({ merged: false })
  expect(loops.redactRefs(["room:r:msg:m1"])).toBe(1)
  expect(loops.get(grant.id)).toBeNull()
})

test("Jev's answers open, merge, and close by majority only", () => {
  const near = { id: 7, text: "submit the grant report" } as Loop
  const check = { sentences: [{ text: "finally sent the grant report", from: 0 }, { text: "maybe I'll start running again", from: 0 }, { text: "it rained today", from: 0 }], near: [{ sentence: 0, loop: near }] }
  const choice = (choice: string, p: number) => ({ type: "choice" as const, choice, probabilities: { [choice]: p }, confidence: p })
  const ops = loopOps(check, {
    s0_l7: choice("done", 0.9),
    s0_kind: choice("intention", 0.8),
    s1_kind: choice("goal", 0.7),
    s1_certain: { type: "bool", probability: 0.2 },
    s2_kind: choice("project", 0.4),
  })
  expect(ops).toEqual([
    { op: "close", sentence: 0, id: 7, status: "done" },
    { op: "open", sentence: 1, kind: "goal", certainty: "tentative", owner: "human" },
  ])
})

test("a sentence Jev found the same as a loop merges into it; any other answer leaves it to the store", () => {
  const near = { id: 7, text: "submit the grant report" } as Loop
  const check = { sentences: [{ text: "book the flights to Lisbon", from: 0 }], near: [{ sentence: 0, loop: near }] }
  const choice = (choice: string, p: number) => ({ type: "choice" as const, choice, probabilities: { [choice]: p }, confidence: p })
  const open = (rel: string, p: number) => loopOps(check, { s0_l7: choice(rel, p), s0_kind: choice("intention", 0.9), s0_certain: { type: "bool", probability: 0.9 } })
  expect(open("same", 0.9)).toEqual([{ op: "open", sentence: 0, kind: "intention", certainty: "explicit", owner: "human", same: 7 }])
  expect(open("other", 0.9)).toEqual([{ op: "open", sentence: 0, kind: "intention", certainty: "explicit", owner: "human" }])
  expect(open("same", 0.4)).toEqual([{ op: "open", sentence: 0, kind: "intention", certainty: "explicit", owner: "human" }])
})

test("a plan whose probability splits between kinds is still a loop, of the likeliest kind", () => {
  const check = { sentences: [{ text: "maybe I'll start running again", from: 0 }], near: [] }
  const kind = (probabilities: Record<string, number>) => loopOps(check, { s0_kind: { type: "choice", choice: "none", probabilities, confidence: 0.4 } })
  expect(kind({ none: 0.4, goal: 0.35, intention: 0.25 })).toEqual([{ op: "open", sentence: 0, kind: "goal", certainty: "tentative", owner: "human" }])
  expect(kind({ none: 0.6, goal: 0.3, intention: 0.1 })).toEqual([])
})

test("an agent's promise merges into its newest open one unless Jev is sure it is another", () => {
  const owed = { id: 4, text: "send a passport checklist tomorrow", owner: "ada" } as Loop
  const check = { sentences: [{ text: "Done. I will post it here tomorrow at 9am.", from: 0, by: "ada" }], near: [{ sentence: 0, loop: owed }] }
  const choice = (choice: string, p: number) => ({ type: "choice" as const, choice, probabilities: { [choice]: p }, confidence: p })
  const promise = { type: "bool" as const, probability: 0.9 }
  const open = { op: "open", sentence: 0, kind: "commitment", certainty: "explicit", owner: "ada" }
  expect(loopOps(check, { s0_promise: promise, s0_l4: choice("other", 0.4) })).toEqual([{ ...open, same: 4 }])
  expect(loopOps(check, { s0_promise: promise, s0_l4: choice("other", 0.8) })).toEqual([open])
})

test("a long answer never crowds the human's sentences out, and only its last two are read", () => {
  const answer = "That is tight. I can help you get it done. What grant is it? Send me the rules. I will check back tomorrow."
  const got = sentencesOf([{ text: "I have to submit the grant report by Friday." }, { text: answer, by: "yuki" }, { text: "Maybe I'll start running again." }])
  expect(got).toEqual([
    { text: "I have to submit the grant report by Friday.", from: 0 },
    { text: "Send me the rules. I will check back tomorrow.", from: 1, by: "yuki" },
    { text: "Maybe I'll start running again.", from: 2 },
  ])
})

test("an agent's promise in its answer is its commitment; an offer or a kept promise is not", () => {
  const owed = { id: 4, text: "send a beginner running plan tomorrow", owner: "ada" } as Loop
  const choice = (choice: string, p: number) => ({ type: "choice" as const, choice, probabilities: { [choice]: p }, confidence: p })
  const check = {
    sentences: [
      { text: "I'll put together a running plan and send it tomorrow.", from: 0, by: "ada" },
      { text: "Want me to check the flights too?", from: 0, by: "ada" },
      { text: "Here is the running plan I promised.", from: 1, by: "ada" },
    ],
    near: [{ sentence: 0, loop: owed }, { sentence: 2, loop: owed }],
  }
  const ops = loopOps(check, {
    s0_promise: { type: "bool", probability: 0.9 },
    s0_l4: choice("same", 0.8),
    s1_promise: { type: "bool", probability: 0.2 },
    s2_promise: { type: "bool", probability: 0.1 },
    s2_l4: choice("done", 0.9),
    s1_kind: choice("intention", 0.9),
  })
  expect(ops).toEqual([
    { op: "open", sentence: 0, kind: "commitment", certainty: "explicit", owner: "ada", same: 4 },
    { op: "close", sentence: 2, id: 4, status: "done" },
  ])
})

test("the summary pass keeps its line first and drops loop lines it cannot trust", () => {
  const answer = ["ana plans the grant report; @ada will check flights", "loop + intention explicit human 2026-10-17 submits the grant report", "loop + commitment explicit @ada - ada sends lisbon flight options", "loop done 3", "loop done 99", "loop + chore explicit human - bad kind"].join("\n")
  expect(parseNapLoops(answer, new Set([3]))).toEqual({
    summary: "ana plans the grant report; @ada will check flights",
    ops: [
      { op: "open", kind: "intention", certainty: "explicit", owner: "human", due: "2026-10-17", text: "submits the grant report" },
      { op: "open", kind: "commitment", certainty: "explicit", owner: "ada", due: null, text: "ada sends lisbon flight options" },
      { op: "close", id: 3, status: "done" },
    ],
  })
})

test("a pass over an agent's message cannot open its promise again after the promise closed", () => {
  const loops = store()
  const ref = "room:r:msg:m9"
  const agent = { ...base, owner: "ada", kind: "commitment" as const, certainty: "explicit" as const, source: "jev" as const, ref }
  const first = loops.open({ ...agent, text: "come back with options tomorrow" })
  if (!first.ok) throw new Error("open failed")
  expect(loops.close(first.id, "done")).toBe(true)
  expect(loops.open({ ...agent, text: "I'll bring options tomorrow" })).toEqual({ ok: true, id: first.id, merged: true })
  expect(loops.list()).toEqual([])
  expect(loops.open({ ...agent, ref: "room:r:msg:m10", text: "check prices again friday" })).toMatchObject({ merged: false })
  const h = { ...base, certainty: "explicit" as const, source: "jev" as const, ref: "room:r:msg:h1" }
  expect(loops.open({ ...h, text: "run more" })).toMatchObject({ merged: false })
  expect(loops.open({ ...h, text: "learn guitar" })).toMatchObject({ merged: false })
})
