import type { RoomId, RoomToClient } from "@yuki/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"

// Architecture section 13. The memory eval: does an agent still know what was said hundreds of turns
// ago, when only a bounded <memory> block reaches the model? A group chat of 320 turns (the human,
// yuki, ada, and bob) is seeded straight into the room log, with no runs. Facts are planted from the
// first turns to the last: from the human and from teammates, one buried in a long reply, and two that
// are corrected later. The room's summaries are made with the real model, then one human message asks
// every question. An answer scores when it carries the newest value. It also
// reports what the block costs: lines and characters.
//
// Needs a development server (the seed route) and a model key. Costs about 80 small summary calls
// and one answer.


/**
 * Each fact sits on one turn. The human speaks on even turns; on odd turns yuki, ada, and bob take
 * turns. A fact may come from an agent, may be buried in a long reply, or may be corrected later: the
 * answer must carry the newest value and not the old one.
 */
export type Fact = { at: number; from?: "ada" | "bob" | "yuki"; said: string; ask?: string; expect?: RegExp; reject?: RegExp }
const FACTS: Fact[] = [
  { at: 4, said: "oh and the dog's name is miso, she's a shiba", ask: "what is the dog called?", expect: /miso/i },
  { at: 30, said: "sam's birthday is march 3rd, don't let me forget", ask: "when is sam's birthday?", expect: /march\s*3|3(rd)?\s*march|03\/03|3\/3/i },
  { at: 74, said: "we settled it: the budget for the whole trip is 2400 euros" },
  { at: 120, said: "kenji is allergic to shellfish, so no seafood places when he's with us", ask: "what is kenji allergic to?", expect: /shellfish|seafood/i },
  { at: 145, from: "ada", said: `${"i went through every ryokan near hakone that takes a group of four, compared the onsen hours, the dinner plans, the cancellation rules and the walk from the station. most were full on the eighth or wanted a two-night minimum. ".repeat(2)}in the end i booked the one with the private bath for nov 8, confirmation HK-5521, paid the deposit, and the rest is due at check-in.` , ask: "what is the ryokan's confirmation code?", expect: /HK-?\s*5521/i },
  { at: 170, said: "the hotel is the sotetsu fresa inn in shinjuku, booked for nov 4 to 14", ask: "which hotel did we book?", expect: /sotetsu|fresa/i },
  { at: 214, said: "flight is JL 41 on nov 3, seat 32a", ask: "what is the flight number?", expect: /JL\s*41/i },
  { at: 233, from: "bob", said: "heads up: i moved the teamlab tickets from the 6th to nov 9 at 18:30, the 6th was sold out", ask: "when are the teamlab tickets now?", expect: /nov(ember)?\s*9|9(th)?\s*nov|9\/11|11\/9/i },
  { at: 250, said: "change of plan: we raised the trip budget to 2800 euros", ask: "what is the trip budget?", expect: /2[,.]?800/ },
  { at: 262, said: "my new dentist is dr okafor, in alfama", ask: "who is my new dentist?", expect: /okafor/i },
  { at: 300, said: "the team standup moved to thursdays at 10", ask: "when is the team standup now?", expect: /thursday/i },
]
const FILLER_HUMAN = [
  "what do you think about the weather this week",
  "can you look at the draft again later",
  "ok sounds good",
  "remind me what we said about the museum",
  "lol fair",
  "i'm tired today, short answers please",
  "any good ramen spots near the station?",
  "let's keep going tomorrow",
]
const FILLER_AGENT = [
  "looks like rain midweek, sunny on the weekend.",
  "sure, i'll go over it tonight.",
  "great.",
  "we said the museum is a maybe, only if it rains. if it does, the mori art museum and the edo-tokyo one are both near the line we take every day, and neither needs a booking on a weekday.",
  "ha.",
  "got it.",
  "fuunji near the south exit is the classic pick.",
  "works for me.",
]
const AGENTS = ["yuki", "ada", "bob"] as const

export type Eval = { name: string; turns: number; facts: Fact[]; pass: number; fillerHuman: string[]; fillerAgent: string[] }

export function script(e: Eval): { from: string; text: string }[] {
  for (const f of e.facts) if ((f.at % 2 === 0) !== !f.from) throw new Error(`fact at ${f.at}: the human speaks on even turns, agents on odd ones`)
  const out: { from: string; text: string }[] = []
  for (let i = 0; i < e.turns; i++) {
    const fact = e.facts.find((f) => f.at === i)
    if (i % 2 === 0) out.push({ from: "human", text: fact ? fact.said : e.fillerHuman[(i / 2) % e.fillerHuman.length]! })
    else out.push({ from: fact?.from ?? AGENTS[((i - 1) / 2) % 3]!, text: fact ? fact.said : e.fillerAgent[((i - 1) / 2) % e.fillerAgent.length]! })
  }
  return out
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function ulid(): string {
  let time = Date.now()
  let head = ""
  for (let i = 0; i < 10; i++) {
    head = CROCKFORD[time % 32] + head
    time = Math.floor(time / 32)
  }
  return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

async function dev(url: string, cookie: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(new URL(`api/dev/agent/${path}`, url.endsWith("/") ? url : `${url}/`), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new VerifyError(`the dev route ${path} answered ${res.status}. start the Worker with NODE_ENV=development`)
  return res.json()
}

export const memorySuite = (e: Eval): Suite => ({
  name: e.name,
  model: true,
  async run(v) {
    const TURNS = e.turns
    const ASKED = e.facts.filter((f) => f.ask)
    const s = await v.as(`memeval${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    const roomId = ulid() as RoomId
    user.send({ t: "chat", op: { op: "create", roomId, title: "japan trip" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    let room = await s.room(roomId)
    await room.expect((f) => f.t === "events")

    const seeded = await dev(v.url, s.cookie, "seed", { roomId, turns: script(e) })
    if (seeded.turns !== TURNS) throw new VerifyError(`seeded ${seeded.turns} turns, wanted ${TURNS}`)

    // The summaries run in the background with the real model. Wait until none is left.
    const started = Date.now()
    let state: any = { pending: 1 }
    let lost = 0
    while (state.pending > 0) {
      if (Date.now() - started > 45 * 60_000) throw new VerifyError(`summaries still pending after 45 minutes: ${state.pending}`)
      if (state.view !== undefined || lost) await Bun.sleep(3_000)
      // A busy machine's wrangler dev sometimes drops a request to the room ("Network connection lost");
      // the next poll reaches it again. Five failures in a row are real.
      try {
        state = await dev(v.url, s.cookie, "memory", { roomId })
        lost = 0
      } catch (error) {
        if (++lost >= 5) throw error
        console.log(`  poll failed (${lost}), trying again: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const view: string = state.view
    for (const line of view.split("\n").filter((l) => /^#\d+-\d+ /.test(l))) console.log(`  summary ${line}`)
    console.log(`  summaries done in ${Math.round((Date.now() - started) / 1000)} s; the chat block is ${view.split("\n").length} lines, ${view.length} characters, for ${TURNS} turns`)

    // On a busy machine the summaries take long enough for the idle socket to drop: ask on a fresh one.
    room.raw.close()
    room = await s.room(roomId)
    await room.expect((f) => f.t === "events")
    const quiz = ["quick quiz from everything we talked about. answer each in a few words, numbered, all in one bubble:", ...ASKED.map((f, i) => `${i + 1}) ${f.ask}`)].join("\n")
    const before = room.raw.log.length
    room.send(quiz)
    const answer = async () => {
      const texts: string[] = []
      for (const e of room.raw.log.slice(before)) {
        const f = e.frame as RoomToClient
        if (e.dir === "in" && f.t === "events") for (const ev of f.events) if (ev.t === "message" && ev.from.kind === "agent") texts.push(ev.text)
      }
      return texts.join("\n")
    }
    const isIdle = () =>
      room.raw.log.slice(before).some((e) => e.dir === "in" && (e.frame as RoomToClient).t === "status" && (e.frame as { state: string }).state === "idle")
    const end = Date.now() + 180_000
    while (!isIdle() || !(await answer())) {
      if (Date.now() > end) throw new VerifyError(`no answer to the quiz. got: ${JSON.stringify(await answer())}`)
      await Bun.sleep(500)
    }
    const text = await answer()
    // Each answer is its own numbered line, so a replaced value elsewhere in the text cannot count against it.
    const answerLine = (n: number) => text.split("\n").find((l) => new RegExp(`^\\s*${n}[).:]`).test(l)) ?? ""
    const hits = ASKED.map((f, i) => {
      const line = answerLine(i + 1) || text
      return f.expect!.test(line) && !f.reject?.test(line)
    })
    for (const [i, f] of ASKED.entries()) console.log(`  ${hits[i] ? "ok  " : "miss"} turn ${String(f.at).padStart(3)}${f.from ? ` @${f.from}` : ""}: ${f.ask}`)
    const score = hits.filter(Boolean).length
    console.log(`  score ${score}/${ASKED.length}. the answer: ${JSON.stringify(text)}`)
    // After the quiz: the usage route opens the agent, which must first have its chat (agent-do.ts).
    console.log(`  summary cost: ${JSON.stringify((await dev(v.url, s.cookie, "usage", { roomId })).memory)}`)
    if (score < e.pass) throw new VerifyError(`memory eval scored ${score}/${ASKED.length}, below ${e.pass}`)
  },
})

/** Measured 10 of 10 on 2026-10-04 with deepseek-v4.1-flash. */
export default memorySuite({ name: "memory-eval", turns: 320, facts: FACTS, pass: 9, fillerHuman: FILLER_HUMAN, fillerAgent: FILLER_AGENT })
