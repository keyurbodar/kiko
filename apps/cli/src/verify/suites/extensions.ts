import { newRoom, poll, seen, statuses } from "../kit"
import type { ExtensionOp, ExtensionResult, UserEvent } from "@yuki/protocol"
import { expectEqual, type Session, VerifyError } from "../client"
import { must } from "../must"
import type { Suite } from "../runner"
import { fake, send } from "./mid-run"


const MANIFEST = (version: string) => ({
  yuki: 1,
  name: "verify-counter",
  version,
  description: "counts, for yuki verify",
  tools: { verify_bump: { description: "adds one to the count", effect: "write" } },
  hooks: ["beforeTool"],
  state: "room",
  tests: [{ tool: "verify_bump", expect: "count" }],
})

const SOURCE = (word: string) => `
export const tools = {
  async verify_bump(_args, yuki) {
    const n = ((await yuki.state.get("n")) ?? 0) + 1
    await yuki.state.set("n", n)
    return "${word} " + n
  },
}
export const hooks = {
  async beforeTool(call) {
    if (call.name === "fake_note") return { block: "notes are off" }
  },
}
`

async function extensionOps(s: Session) {
  const user = await s.user()
  let n = 0
  return async (op: ExtensionOp): Promise<ExtensionResult> => {
    const reqId = `x${++n}-${Date.now()}`
    user.send({ t: "extension", reqId, op })
    const frame = await user.expect((f) => f.t === "extension_result" && f.reqId === reqId, 10_000)
    return (frame as { result: ExtensionResult }).result
  }
}

const ok = (r: ExtensionResult, what: string) => {
  if (!r.ok) throw new VerifyError(`${what}: ${r.error}${r.problems ? ` (${r.problems.join("; ")})` : ""}`)
  return r
}

const suite: Suite = {
  name: "extensions",
  async run(v) {
    const s = await v.as(`extensions-${Date.now()}`)
    const op = await extensionOps(s)
    const user = await s.user()

    const broken = await op({ op: "propose", bundle: { manifest: { ...MANIFEST("x"), name: "Bad Name" }, files: {} } })
    if (broken.ok) throw new VerifyError("a bundle with a bad name and version was accepted")
    if (!broken.problems?.some((p) => p.startsWith('"name"')) || !broken.problems?.some((p) => p.startsWith('"version"'))) throw new VerifyError(`the problems do not name the bad fields: ${JSON.stringify(broken.problems)}`)

    const proposed = ok(await op({ op: "propose", bundle: { manifest: MANIFEST("1.0.0"), files: { "main.js": SOURCE("count") } } }), "propose")
    const id = must(proposed.proposal, "proposal").id
    await user.expect((f) => f.t === "events" && f.events.some((e: UserEvent) => e.t === "extension_proposal" && e.proposal.id === id))

    const { roomId, room } = await newRoom(s, "extensions")
    await fake(v, s, roomId)
    await send(room, "[ws verify_bump {}]")
    await poll("the agent's answer before the install", () => seen(room).live.length >= 1, 20_000)
    const before = must(seen(room).live.at(-1), "agent answer").text
    if (!/not available|not found|unknown/i.test(before)) throw new VerifyError(`the tool ran before the human installed it: ${before}`)

    ok(await op({ op: "install", id }), "install")
    await user.expect((f) => f.t === "events" && f.events.some((e: UserEvent) => e.t === "extension" && e.extension.name === "verify-counter"))

    const answer = async (text: string, n: number) => {
      await send(room, text)
      await poll(`answer ${n}`, () => seen(room).live.length >= n, 20_000)
      return must(seen(room).live[n - 1], `answer ${n}`).text
    }
    const first = await answer("[ws verify_bump {}]", 2)
    if (!first.includes("tool: count 1")) throw new VerifyError(`the first bump answered ${first}`)
    const second = await answer("[ws verify_bump {}]", 3)
    if (!second.includes("tool: count 2")) throw new VerifyError(`the count did not survive between runs: ${second}`)

    const blocked = await answer("[ws fake_note {}]", 4)
    if (!blocked.includes("fake_note blocked")) throw new VerifyError(`the hook did not block fake_note: ${blocked}`)

    ok(await op({ op: "enable", name: "verify-counter", enabled: false }), "switch off")
    const off = await answer("[ws verify_bump {}]", 5)
    if (off.includes("tool: count")) throw new VerifyError(`the tool still ran while switched off: ${off}`)

    ok(await op({ op: "enable", name: "verify-counter", enabled: true }), "switch on")
    const update = ok(await op({ op: "propose", bundle: { manifest: MANIFEST("1.1.0"), files: { "main.js": SOURCE("tally") } } }), "propose the update")
    expectEqual(Boolean(update.proposal?.replaces), true, "the update names the version it replaces")
    ok(await op({ op: "install", id: must(update.proposal, "update proposal").id }), "install the update")
    const updated = await answer("[ws verify_bump {}]", 6)
    if (!updated.includes("tool: tally 3")) throw new VerifyError(`the update did not take over at the next run: ${updated}`)

    const again = await op({ op: "propose", bundle: { manifest: MANIFEST("1.1.0"), files: { "main.js": SOURCE("tally") } } })
    if (again.ok) throw new VerifyError("proposing the installed version again was accepted")

    const catalog = ok(await op({ op: "catalog" }), "catalog").catalog ?? []
    if (!catalog.some((e) => e.name === "tally")) throw new VerifyError(`the catalog has no tally: ${catalog.map((e) => e.name).join(", ")}`)
    const fromCatalog = ok(await op({ op: "propose_catalog", name: "tally" }), "propose from the catalog")
    expectEqual(fromCatalog.proposal?.source, "catalog", "a catalog install says where it came from")
    ok(await op({ op: "decline", id: must(fromCatalog.proposal, "catalog proposal").id }), "decline")

    ok(await op({ op: "uninstall", name: "verify-counter" }), "uninstall")
    const reinstall = ok(await op({ op: "propose", bundle: { manifest: MANIFEST("1.1.0"), files: { "main.js": SOURCE("tally") } } }), "propose after uninstall")
    ok(await op({ op: "install", id: must(reinstall.proposal, "reinstall proposal").id }), "reinstall")
    const fresh = await answer("[ws verify_bump {}]", 7)
    if (!fresh.includes("tool: tally 1")) throw new VerifyError(`uninstall kept the old state: ${fresh}`)

    ok(await op({ op: "enable", name: "verify-counter", enabled: false }), "switch off before the slow run")
    const busy = await newRoom(s, "extensions mid-run")
    await fake(v, s, busy.roomId)
    await send(busy.room, "[tool] wait")
    await poll("the slow tool to start", () => statuses(busy.room).includes("working"), 10_000)
    ok(await op({ op: "enable", name: "verify-counter", enabled: true }), "switch on during the run")
    await send(busy.room, "[ws verify_bump {}]")
    await poll("the joined answer", () => seen(busy.room).live.length >= 1, 20_000)
    const joined = must(seen(busy.room).live.at(-1), "joined answer").text
    if (!joined.includes("tally 1")) throw new VerifyError(`a message that joined a run did not see the extension switched on during it: ${joined}`)
    console.log(`  ok a message that joined a run saw the extension switched on during it: ${JSON.stringify(joined.slice(0, 80))}`)
    busy.room.raw.close()
    ok(await op({ op: "uninstall", name: "verify-counter" }), "clean up")

    const sender = { yuki: 1, name: "verify-sender", version: "1.0.0", description: "sends, for yuki verify", tools: { verify_send: { description: "sends a ping outside yuki", effect: "external" } }, triggers: [{ id: "ping", rrule: "FREQ=DAILY", send: "[ws verify_send {}]" }], tests: [{ tool: "verify_send", expect: "sent" }] }
    await fetch(new URL("api/me", v.url), { headers: { cookie: s.cookie } })
    const sent = ok(await op({ op: "propose", bundle: { manifest: sender as never, files: { "main.js": 'export const tools = { async verify_send() { return "sent" } }' } } }), "propose the sender")
    ok(await op({ op: "install", id: must(sent.proposal, "sender proposal").id }), "install the sender")
    const reminders = await fetch(new URL("api/reminders", v.url), { headers: { cookie: s.cookie } })
    const trigger = ((await reminders.json()) as { id: string; roomId: string; createdBy: string; status: string }[]).find((r) => r.createdBy === "ext:verify-sender" && r.status === "active")
    if (!trigger) throw new VerifyError("installing an extension with a trigger scheduled nothing")
    const home = await s.room(trigger.roomId)
    await fake(v, s, trigger.roomId)
    const due = await fetch(new URL("api/dev/agent/due", v.url), { method: "POST", headers: { "content-type": "application/json", cookie: s.cookie }, body: JSON.stringify({ id: trigger.id }) })
    if (!due.ok) throw new VerifyError(`the due route answered ${due.status}`)
    await poll("the trigger's run", () => seen(home).live.some((m) => m.text.includes("tool: ")), 30_000)
    const said = must(seen(home).live.find((m) => m.text.includes("tool: ")), "trigger run").text
    if (!said.includes("tool: sent")) throw new VerifyError(`the trigger's run could not use its extension's outside tool: ${said}`)
    console.log(`  ok an extension's trigger ran its own outside tool: ${JSON.stringify(said.slice(0, 80))}`)
    ok(await op({ op: "uninstall", name: "verify-sender" }), "clean up the sender")
    home.raw.close()
  },
}

export default suite
