import type { ExtensionOp, ExtensionProposal, ExtensionResult, UserEvent } from "@kiko/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, seen, send, until } from "./mid-run"

// Architecture section 24 with the real test model. Two things the fake agent cannot show:
// 1. A real agent uses an installed catalog extension that fetches the real network (weather).
// 2. A real agent writes an extension from a one-line ask: it reads the skill, writes the files,
//    runs extension_check until it passes, and proposes it. The human installs it, and the agent
//    then uses the new tool in the same chat. No deploy anywhere.

const suite: Suite = {
  name: "extensions-model",
  model: true,
  async run(v) {
    const s = await v.as(`ext-model-${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const op = async (o: ExtensionOp): Promise<ExtensionResult> => {
      const reqId = `m${++n}`
      user.send({ t: "extension", reqId, op: o })
      return ((await user.expect((f) => f.t === "extension_result" && f.reqId === reqId, 10_000)) as { result: ExtensionResult }).result
    }
    const must = (r: ExtensionResult, what: string) => {
      if (!r.ok) throw new VerifyError(`${what}: ${r.error} ${r.problems?.join("; ") ?? ""}`)
      return r
    }
    const { room } = await newRoom(s, "extensions with the real model")
    /** True when a room frame after log position `from` says the agent was using `what` (the presence line). */
    const used = (from: number, what: string) => room.raw.log.slice(from).some((e) => e.dir === "in" && JSON.stringify(e.frame).includes(`using ${what}`))
    const approvals = (from: number) => room.raw.log.slice(from).filter((e) => e.dir === "in" && JSON.stringify(e.frame).includes('"t":"approval"')).length
    const replyAfter = async (text: string, ms: number) => {
      const before = seen(room).live.length
      await send(room, text)
      await until("the agent's reply", () => seen(room).live.length > before, ms)
      await Bun.sleep(4_000)
      return seen(room).live.slice(before).map((m) => m.text).join("\n")
    }

    // 1. A catalog extension with a real fetch.
    const weather = must(await op({ op: "propose_catalog", name: "weather" }), "propose weather")
    must(await op({ op: "install", id: weather.proposal!.id }), "install weather")
    // Two places in one message: the read tool runs twice in one run, and no approval card appears.
    const wxFrom = room.raw.log.length
    const forecast = await replyAfter("what's the weather in lisbon and in porto right now? use your weather tool for each.", 120_000)
    console.log(`  weather reply: ${JSON.stringify(forecast)}`)
    if (!used(wxFrom, "weather")) throw new VerifyError("the room never saw the agent using weather")
    if (!/°|degrees|\d+\s?c\b/i.test(forecast)) throw new VerifyError(`the reply has no temperature, so the tool did not run: ${forecast}`)
    if (approvals(wxFrom)) throw new VerifyError("a read tool's second call in one run asked for approval")

    // 2. The agent writes an extension.
    const proposed = user.expect((f) => f.t === "events" && f.events.some((e: UserEvent) => e.t === "extension_proposal"), 300_000)
    const ask = await replyAfter(
      "build me an extension named dice with one tool, roll_dice, that rolls a die with a given number of sides (default 6) and returns the number it rolled. check it and propose it.",
      300_000,
    )
    console.log(`  build reply: ${JSON.stringify(ask)}`)
    const frame = (await proposed) as unknown as { events: UserEvent[] }
    const proposal = frame.events.flatMap((e) => (e.t === "extension_proposal" ? [e.proposal] : []))[0] as ExtensionProposal
    console.log(`  proposal: ${proposal.name} ${proposal.version} by @${proposal.by}, tools ${Object.keys(proposal.bundle.manifest.tools ?? {}).join(", ")}`)
    console.log(`  main.js:\n${(proposal.bundle.files[proposal.bundle.manifest.main ?? "main.js"] ?? "").split("\n").map((l) => `    ${l}`).join("\n")}`)
    if (!proposal.bundle.manifest.tools?.roll_dice) throw new VerifyError("the proposal has no roll_dice tool")
    must(await op({ op: "install", id: proposal.id }), "install dice")

    const rollFrom = room.raw.log.length
    const rolled = await replyAfter("roll a 20-sided die with roll_dice and tell me the number.", 120_000)
    if (!used(rollFrom, "roll dice")) throw new VerifyError("the room never saw the agent using roll_dice, so the number may be made up")
    console.log(`  roll reply: ${JSON.stringify(rolled)}`)
    const number = Number(/\b(\d{1,2})\b/.exec(rolled)?.[1])
    if (!(number >= 1 && number <= 20)) throw new VerifyError(`no roll between 1 and 20 in the reply: ${rolled}`)
  },
}

export default suite
