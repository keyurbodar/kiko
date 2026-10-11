import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { newRoom, seen, send, until } from "./mid-run"

// Architecture section 8 with the real test model. `workers` proves each rule with the fake agent.
// The browser check that set the rule: asked to read six pages, the talker fetched them itself, and a
// human question sent after its first bubble waited behind the run. Now the talker has no web_fetch,
// so the pages go to a worker, the question is answered at once, and a steer reaches the worker.

type Work = { id: string; status: string; delivered: boolean }

const PAGES = ["Rust_(programming_language)", "Go_(programming_language)", "Python_(programming_language)", "Zig_(programming_language)", "Bun_(software)", "Deno_(software)"].map(
  (p) => `https://en.wikipedia.org/wiki/${p}`,
)
/** About 10 s from the question to its answer, with room for one slow model turn. */
const ANSWER_MS = 12_000

const suite: Suite = {
  name: "workers-model",
  model: true,
  async run(v) {
    const s = await v.as("workers-model")
    await connectTestModel(s)
    const { roomId, room } = await newRoom(s, "workers model check")
    const list = async (): Promise<Work[]> => {
      const res = await fetch(new URL(`api/dev/agent/workers?roomId=${roomId}`, v.url.endsWith("/") ? v.url : `${v.url}/`), { headers: { cookie: s.cookie } })
      if (!res.ok) throw new VerifyError(`the workers route answered ${res.status}. start the Worker with NODE_ENV=development`)
      return ((await res.json()) as { workers: Work[] }).workers
    }
    const texts = () => seen(room).live.map((m) => m.text)
    const step = (what: string) => console.log(`  ok ${what}`)
    try {
      await resetStats(v, s)
      await send(room, `look up these six wikipedia pages and give me one line on each language or tool. ${PAGES.join(" ")}`)
      await until("the agent's first bubble", () => texts().length > 0, 60_000)
      const before = texts().length
      const asked = performance.now()
      await send(room, "what is 6 times 7?")
      await until(`an answer to 6 times 7 within ${ANSWER_MS / 1000} s`, () => texts().slice(before).some((t) => /\b42\b/.test(t)), ANSWER_MS)
      const answeredMs = Math.round(performance.now() - asked)
      const works = await list()
      if (!works.length) throw new VerifyError(`the agent never started a worker: ${JSON.stringify(texts())}`)
      if (works.every((w) => w.delivered)) throw new VerifyError(`the worker reported before the answer to 6 times 7: ${JSON.stringify(works)}`)
      step(`"42" came ${answeredMs} ms after the question, while ${works.map((w) => `${w.id} was ${w.status}`).join(", ")}`)

      const steered = texts().length
      await send(room, "change of plan for the research: only Bun and Deno.")
      for (const end = Date.now() + 240_000; ; await Bun.sleep(1_000)) {
        const all = await list()
        if (all.length && all.every((x) => x.delivered) && texts().length > steered + 1) break
        if (Date.now() > end) throw new VerifyError(`no report after the steer: ${JSON.stringify({ workers: all, bubbles: texts().slice(steered) })}`)
      }
      await Bun.sleep(5_000)
      const report = texts().slice(steered).join("\n")
      if (!/\bbun\b/i.test(report) || !/\bdeno\b/i.test(report)) throw new VerifyError(`the report does not cover Bun and Deno: ${JSON.stringify(report.slice(0, 400))}`)
      if (/\b(python|zig)\b/i.test(report) && !/skip|only|dropped|left out/i.test(report)) throw new VerifyError(`the report still covers a dropped page: ${JSON.stringify(report.slice(0, 400))}`)
      step(`the report follows the steer: ${JSON.stringify(report.slice(0, 200))}`)

      const stats = await readStats(v, s)
      const calls = (who: string) => Object.entries(stats).filter(([k]) => k.startsWith(`tool.${who}.`)).map(([k, n]) => `${k.split(".")[2]}=${n}`)
      console.log(`  talker tools ${calls("talker").join(" ")}; worker tools ${calls("worker").join(" ")}`)
      if (stats["tool.talker.web_fetch"]) throw new VerifyError(`the talker called web_fetch ${stats["tool.talker.web_fetch"]} times`)
      if (!stats["tool.worker.web_fetch"]) throw new VerifyError("no worker called web_fetch")
      step("only workers fetched pages")
      console.log(`  bubbles ${JSON.stringify(texts().map((t) => (t.length > 90 ? `${t.slice(0, 87)}...` : t)))}`)
    } finally {
      room.raw.close()
    }
  },
}

export default suite
