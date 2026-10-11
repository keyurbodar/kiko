import type { ExtensionOp, ExtensionProposal, ExtensionResult, RoomToClient, UserEvent } from "@yuki/protocol"
import { connectTestModel, VerifyError } from "../client"
import type { Suite } from "../runner"
import { newRoom, seen, send, until } from "./mid-run"
import { must as mustPresent } from "../must"


const probe = (id: string, verdict: "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE", evidence: string) => console.log(`  PROBE ${id} ${verdict}: ${evidence}`)
const short = (t: string) => JSON.stringify(t.length > 300 ? `${t.slice(0, 300)}...` : t)

const suite: Suite = {
  name: "extensions-edit-model",
  model: true,
  async run(v) {
    const s = await v.as(`ext-edit-${Date.now()}`)
    await connectTestModel(s)
    const user = await s.user()
    let n = 0
    const op = async (o: ExtensionOp): Promise<ExtensionResult> => {
      const reqId = `e${++n}`
      user.send({ t: "extension", reqId, op: o })
      return ((await user.expect((f) => f.t === "extension_result" && f.reqId === reqId, 10_000)) as { result: ExtensionResult }).result
    }
    const must = (r: ExtensionResult, what: string) => {
      if (!r.ok) throw new VerifyError(`${what}: ${r.error} ${r.problems?.join("; ") ?? ""}`)
      return r
    }
    const { room } = await newRoom(s, "extensions: edit loop")
    const used = (from: number, what: string) => room.raw.log.slice(from).some((e) => e.dir === "in" && JSON.stringify(e.frame).includes(`using ${what}`))
    const replyAfter = async (text: string, ms: number) => {
      const before = seen(room).live.length
      await send(room, text)
      await until("the agent's reply", () => seen(room).live.length > before, ms)
      for (let quiet = Date.now(); Date.now() - quiet < 20_000; await Bun.sleep(1_000)) {
        const count = seen(room).live.length
        await Bun.sleep(1_000)
        if (seen(room).live.length !== count) quiet = Date.now()
      }
      return seen(room).live.slice(before).map((m) => m.text).join("\n")
    }
    const fileNames = () =>
      room.raw.log.flatMap((e) => (e.dir === "in" && (e.frame as RoomToClient).t === "events" ? (e.frame as Extract<RoomToClient, { t: "events" }>).events.flatMap((ev) => (ev.t === "file" ? [ev.file.name] : [])) : []))

    try {
      const guard = must(await op({ op: "propose_catalog", name: "path-guard" }), "propose path-guard")
      must(await op({ op: "install", id: mustPresent(guard.proposal, "guard proposal").id }), "install path-guard")
      const writer = must(
        await op({
          op: "propose",
          bundle: {
            manifest: { yuki: 1, name: "writer", version: "1.0.0", description: "saves a note file, for yuki verify", tools: { write_via: { description: "saves the text /prod/via.md", effect: "write" } }, calls: ["write"] } as never,
            files: { "main.js": 'export const tools = { async write_via(_a, yuki) { return await yuki.call("write", { path: "/prod/via.md", content: "bypass" }) } }' },
          },
        }),
        "propose writer",
      )
      must(await op({ op: "install", id: mustPresent(writer.proposal, "writer proposal").id }), "install writer")
      const from = room.raw.log.length
      const said = await replyAfter(
        "do these in order and report each result in one line. 1) guard_paths with add /prod. 2) write /prod/direct.md with the content direct. 3) call write_via. 4) ls /prod. say plainly whether each step worked or was blocked.",
        240_000,
      )
      const names = fileNames().filter((f) => f.startsWith("prod/"))
      const direct = names.includes("prod/direct.md")
      const via = names.includes("prod/via.md")
      const evidence = `files that appeared under /prod: ${JSON.stringify(names)}; used write_via: ${used(from, "write via")}; reply ${short(said)}`
      if (direct) probe("P1r", "INCONCLUSIVE", `the control failed, the direct write got through. ${evidence}`)
      else if (!used(from, "write via") && !names.length && !/write_via/.test(said)) probe("P1r", "INCONCLUSIVE", `the model never reached write_via. ${evidence}`)
      else probe("P1r", via ? "NOT VERIFIED" : "VERIFIED", `${via ? "BYPASS: /prod/via.md exists while /prod is protected. " : "no file under /prod. "}${evidence}`)
    } catch (e) {
      if (!(e instanceof VerifyError)) throw e
      probe("P1r", "INCONCLUSIVE", `harness: ${e.message}`)
    }

    try {
      const proposed = user.expect((f) => f.t === "events" && f.events.some((e: UserEvent) => e.t === "extension_proposal" && e.proposal.name === "dice"), 300_000)
      await replyAfter("build me an extension named dice with one tool, roll_dice, that rolls one die with a given number of sides (default 6) and returns the number it rolled. check it and propose it.", 300_000)
      const first = ((await proposed) as unknown as { events: UserEvent[] }).events.flatMap((e) => (e.t === "extension_proposal" ? [e.proposal] : []))[0] as ExtensionProposal
      must(await op({ op: "install", id: first.id }), "install dice")
      const second = user.expect((f) => f.t === "events" && f.events.some((e: UserEvent) => e.t === "extension_proposal" && e.proposal.name === "dice" && e.proposal.id !== first.id), 300_000)
      const from = room.raw.log.length
      let edit = await replyAfter("change dice so roll_dice takes a count and rolls that many dice, then propose the update.", 300_000)
      const early = await Promise.race([second.then(() => true, () => false), Bun.sleep(5_000).then(() => false)])
      if (!early && /\bgo\b|reply|ok to/i.test(edit)) {
        console.log(`  the agent asked before saving the update: ${short(edit.split("\n").at(-1) ?? "")}`)
        edit += `\n${await replyAfter("go", 300_000)}`
      }
      let why = ""
      const arrived = (await second.catch((e: Error) => {
        why = e.message
        return null
      })) as { events: UserEvent[] } | null
      const next = arrived?.events.flatMap((e) => (e.t === "extension_proposal" ? [e.proposal] : []))[0] as ExtensionProposal | undefined
      if (!next) throw new VerifyError(`no update was proposed (${why}). reply ${short(edit)}`)
      const opened = used(from, "extension open")
      const newer = next.version !== first.version
      console.log(`  update: ${first.version} -> ${next.version}, replaces ${JSON.stringify(next.replaces)}, opened the installed files: ${opened}`)
      console.log(`  update main.js:\n${(next.bundle.files[next.bundle.manifest.main ?? "main.js"] ?? "").split("\n").map((l) => `    ${l}`).join("\n")}`)
      must(await op({ op: "install", id: next.id }), "install the update")
      const rollFrom = room.raw.log.length
      const rolled = await replyAfter("roll 3 six-sided dice with roll_dice and give me the three numbers.", 120_000)
      const numbers = [...rolled.matchAll(/\b([1-6])\b/g)].map((m) => m[1])
      const ran = used(rollFrom, "roll dice")
      const ok = newer && Boolean(next.replaces) && numbers.length >= 3 && ran
      probe("P4", ok ? "VERIFIED" : "NOT VERIFIED", `version ${first.version} -> ${next.version}, replaces ${JSON.stringify(next.replaces)}, extension_open used ${opened}, roll_dice used ${ran}, numbers ${JSON.stringify(numbers)}, reply ${short(rolled)}`)
    } catch (e) {
      if (!(e instanceof VerifyError)) throw e
      probe("P4", "INCONCLUSIVE", `harness: ${e.message}`)
    }
  },
}

export default suite
