import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, seen, send, until } from "./mid-run"

// Architecture section 8 with the real test model. `workers` proves each rule with the fake agent.
// This one checks that a real model hands slow research to a worker, answers an unrelated question
// while the worker runs, passes a steer on, and reports a result that follows the steer.

type Work = { id: string; status: string; delivered: boolean }

const PAGES = [
  "https://en.wikipedia.org/wiki/Example.com",
  "https://www.iana.org/help/example-domains",
  "https://www.rfc-editor.org/rfc/rfc2606.html",
  "https://en.wikipedia.org/wiki/Top-level_domain",
  "https://www.iana.org/domains/reserved",
]

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
      await send(room, `research for me: read each of these pages one by one with web_fetch and give me one line on what each says about reserved example domains. ${PAGES.join(" ")}`)
      let started: Work | undefined
      for (const end = Date.now() + 90_000; !started; await Bun.sleep(500)) {
        if (Date.now() > end) throw new VerifyError(`the agent never started a worker: ${JSON.stringify(texts())}`)
        started = (await list())[0]
      }
      step(`the agent started ${started.id}`)
      await until("the agent's first reply", () => texts().length > 0, 60_000)
      const before = texts().length
      await send(room, "unrelated question: what is 17 plus 25? answer with only the number.")
      await until("an answer to the unrelated question", () => texts().slice(before).some((t) => /\b42\b/.test(t)), 60_000)
      const [w] = await list()
      if (!w || w.delivered) throw new VerifyError(`the worker reported before the unrelated answer: ${JSON.stringify(w)}`)
      step(`the agent answered "42" while ${w.id} was ${w.status}`)
      const steered = texts().length
      await send(room, "change of plan for the research: only look at the wikipedia pages, skip all the others.")
      for (const end = Date.now() + 240_000; ; await Bun.sleep(1_000)) {
        const all = await list()
        if (all.length && all.every((x) => x.delivered) && texts().length > steered + 1) break
        if (Date.now() > end) throw new VerifyError(`no report after the steer: ${JSON.stringify({ workers: all, bubbles: texts().slice(steered) })}`)
      }
      await Bun.sleep(5_000)
      const report = texts().slice(steered).join("\n")
      if (!/wikipedia/i.test(report)) throw new VerifyError(`the report does not follow the steer: ${JSON.stringify(report.slice(0, 400))}`)
      if (/rfc ?2606|rfc-editor/i.test(report) && !/skip|only|wikipedia only/i.test(report)) throw new VerifyError(`the report still covers a skipped page: ${JSON.stringify(report.slice(0, 400))}`)
      step(`the report follows the steer: ${JSON.stringify(report.slice(0, 200))}`)
      console.log(`  workers ${JSON.stringify(await list())}`)
      console.log(`  bubbles ${JSON.stringify(texts().map((t) => (t.length > 90 ? `${t.slice(0, 87)}...` : t)))}`)
    } finally {
      room.raw.close()
    }
  },
}

export default suite
