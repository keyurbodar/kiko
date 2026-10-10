import { expect, test } from "bun:test"
import { type Loop, loopOps, Loops, parseNapLoops } from "@yuki/memory/loops"
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
  // Another owner's same words are another loop, and `same` never crosses owners.
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
  // Its words open a new loop now, not a mention of the closed one.
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
    { op: "open", sentence: 1, kind: "goal", certainty: "tentative" },
  ])
})

test("a loop from the same message merges by shared words in either order, unless the judge said it differs", () => {
  const loops = store()
  const ref = "room:r:msg:m1"
  const tool = loops.open({ ...base, certainty: "explicit", text: "file tax return by Sunday 6pm", ref })
  if (!tool.ok) throw new Error("open failed")
  // Jev's words for the same sentence, read after the agent's run kept it.
  expect(loops.open({ ...base, certainty: "explicit", text: "I have to file my tax return by Sunday at 6pm.", ref, source: "jev" })).toEqual({ ok: true, id: tool.id, merged: true })
  // A second plan in the same message shares no words: its own loop. One Jev judged different stays apart too.
  expect(loops.open({ ...base, certainty: "explicit", text: "call the dentist Monday", ref })).toMatchObject({ merged: false })
  expect(loops.open({ ...base, certainty: "explicit", text: "tax return paperwork for Sunday", ref, source: "jev" }, null)).toMatchObject({ merged: false })
  // Another message never merges by words alone.
  expect(loops.open({ ...base, certainty: "explicit", text: "file the tax return", ref: "room:r:msg:m2" })).toMatchObject({ merged: false })
  expect(loops.fromRef(ref).length).toBe(3)
})

test("a sentence Jev found unlike every loop it was shown is opened as different", () => {
  const near = { id: 7, text: "submit the grant report" } as Loop
  const check = { sentences: [{ text: "book the flights to Lisbon", from: 0 }], near: [{ sentence: 0, loop: near }] }
  const choice = (choice: string, p: number) => ({ type: "choice" as const, choice, probabilities: { [choice]: p }, confidence: p })
  const open = (rel: string, p: number) => loopOps(check, { s0_l7: choice(rel, p), s0_kind: choice("intention", 0.9), s0_certain: { type: "bool", probability: 0.9 } })
  expect(open("other", 0.9)).toEqual([{ op: "open", sentence: 0, kind: "intention", certainty: "explicit", same: null }])
  expect(open("same", 0.9)).toEqual([{ op: "open", sentence: 0, kind: "intention", certainty: "explicit", same: 7 }])
  // Unsure: the store's own rule decides.
  expect(open("other", 0.4)).toEqual([{ op: "open", sentence: 0, kind: "intention", certainty: "explicit" }])
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
