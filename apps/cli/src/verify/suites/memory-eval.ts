import type { RoomId, RoomToClient } from "@kiko/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"

// Architecture section 13. The memory eval: does an agent still know what was said hundreds of turns
// ago, when only a bounded <memory> block reaches the model? A chat of 320 turns is seeded straight
// into the room log (no runs), with eight facts planted from the first turns to the last. The room's
// summaries are made with the real model, then one human message asks all eight. The score is how
// many answers carry the fact. It also reports what the block costs: lines and characters.
//
// Needs a development server (the seed route) and a model key. Costs about 90 small summary calls
// and one answer.

const TURNS = 320
/** Below this score the suite fails. ASSUMPTION: the number, 6 of 8. */
const PASS = 6

const FACTS: { at: number; said: string; ask: string; expect: RegExp }[] = [
  { at: 4, said: "oh and the dog's name is miso, she's a shiba", ask: "what is the dog called?", expect: /miso/i },
  { at: 30, said: "sam's birthday is march 3rd, don't let me forget", ask: "when is sam's birthday?", expect: /march\s*3|3(rd)?\s*march|03\/03|3\/3/i },
  { at: 75, said: "we settled it: the budget for the whole trip is 2400 euros", ask: "what is the trip budget?", expect: /2[,.]?400/ },
  { at: 120, said: "kenji is allergic to shellfish, so no seafood places when he's with us", ask: "what is kenji allergic to?", expect: /shellfish|seafood/i },
  { at: 170, said: "the hotel is the sotetsu fresa inn in shinjuku, booked for nov 4 to 14", ask: "which hotel did we book?", expect: /sotetsu|fresa/i },
  { at: 215, said: "flight is JL 41 on nov 3, seat 32a", ask: "what is the flight number?", expect: /JL\s*41/i },
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
  "we said the museum is a maybe, only if it rains.",
  "ha.",
  "got it.",
  "fuunji near the south exit is the classic pick.",
  "works for me.",
]

function script(): { from: "human" | "kiko"; text: string }[] {
  const out: { from: "human" | "kiko"; text: string }[] = []
  for (let i = 0; i < TURNS; i++) {
    const fact = FACTS.find((f) => f.at === i)
    if (i % 2 === 0) out.push({ from: "human", text: fact ? fact.said : FILLER_HUMAN[(i / 2) % FILLER_HUMAN.length]! })
    else out.push({ from: "kiko", text: FILLER_AGENT[((i - 1) / 2) % FILLER_AGENT.length]! })
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

const suite: Suite = {
  name: "memory-eval",
  model: true,
  async run(v) {
    const s = await v.as(`memeval${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    const roomId = ulid() as RoomId
    user.send({ t: "chat", op: { op: "create", roomId, title: "japan trip" } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "chat" && e.chat.roomId === roomId))
    const room = await s.room(roomId)
    await room.expect((f) => f.t === "events")

    const seeded = await dev(v.url, s.cookie, "seed", { roomId, turns: script() })
    if (seeded.turns !== TURNS) throw new VerifyError(`seeded ${seeded.turns} turns, wanted ${TURNS}`)

    // The summaries run in the background with the real model. Wait until none is left.
    const started = Date.now()
    let state = await dev(v.url, s.cookie, "memory", { roomId })
    while (state.pending > 0) {
      if (Date.now() - started > 10 * 60_000) throw new VerifyError(`summaries still pending after 10 minutes: ${state.pending}`)
      await Bun.sleep(3_000)
      state = await dev(v.url, s.cookie, "memory", { roomId })
    }
    const view: string = state.view
    console.log(`  summaries done in ${Math.round((Date.now() - started) / 1000)} s; the chat block is ${view.split("\n").length} lines, ${view.length} characters, for ${TURNS} turns`)

    const quiz = ["quick quiz from everything we talked about. answer each in a few words, numbered, all in one bubble:", ...FACTS.map((f, i) => `${i + 1}) ${f.ask}`)].join("\n")
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
    const hits = FACTS.map((f) => f.expect.test(text))
    for (const [i, f] of FACTS.entries()) console.log(`  ${hits[i] ? "ok  " : "miss"} turn ${String(f.at).padStart(3)}: ${f.ask}`)
    const score = hits.filter(Boolean).length
    console.log(`  score ${score}/${FACTS.length}. the answer: ${JSON.stringify(text)}`)
    if (score < PASS) throw new VerifyError(`memory eval scored ${score}/${FACTS.length}, below ${PASS}`)
  },
}

export default suite
