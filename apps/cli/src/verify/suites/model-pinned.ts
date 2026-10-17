import type { Agent, AgentSlug, UserEvent, UserToClient } from "@kiko/protocol"
import { connectTestModel, expectEqual, TEST_MODEL, TEST_PROVIDER, VerifyError } from "../client"
import { frames, newRoom, poll, seen } from "../kit"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"
import { send } from "./mid-run"

const DEEPSEEK = "opencode-go/deepseek-v4-flash"
const MUSE = "opencode-go/muse-spark-1.3-contributor"

const modelEvents = (frame: UserToClient): Extract<UserEvent, { t: "agent_model" }>[] =>
  frame.t === "events" ? frame.events.filter((e): e is Extract<UserEvent, { t: "agent_model" }> => e.t === "agent_model") : []

const calledModels = (counters: Record<string, number>) =>
  Object.fromEntries(Object.entries(counters).filter(([k]) => k.startsWith("model.id.")).map(([k, n]) => [k.slice("model.id.".length), n]))

const suite: Suite = {
  name: "model-pinned",
  model: true,
  async run(v) {
    const s = await v.as(`model-pinned-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    const reset = await user.expect((f) => f.t === "reset")
    expectEqual(reset.t === "reset" ? reset.snapshot.agentModels?.kiko?.model : undefined, TEST_MODEL, "Kiko runs on the model the human picked")

    const { room } = await newRoom(s, "model pinned")
    const ask = async (text: string, expected: string) => {
      await resetStats(v, s)
      const before = seen(room).live.length
      await send(room, text)
      await poll(`an answer to "${text}"`, () => seen(room).live.length > before, 90_000)
      await Bun.sleep(2_000)
      const called = calledModels(await readStats(v, s))
      const id = expected.slice(expected.indexOf("/") + 1)
      console.log(`  "${text}" answered ${JSON.stringify(seen(room).live.slice(before).map((m) => m.text))} by ${JSON.stringify(called)}`)
      // The counters are the whole server's, so other dev users' background work can show up. This test's other model must not.
      const otherRef = expected === DEEPSEEK ? MUSE : DEEPSEEK
      const other = otherRef.slice(otherRef.indexOf("/") + 1)
      if (!called[id] || called[other]) throw new VerifyError(`expected ${id} to answer and ${other} not to, got ${JSON.stringify(called)}`)
    }

    user.send({ t: "agent_model", slug: "kiko" as AgentSlug, ref: DEEPSEEK })
    await user.expect((f) => modelEvents(f).some((e) => e.slug === "kiko" && e.model === DEEPSEEK))
    await ask("reply with the single word one.", DEEPSEEK)

    const quiet = user.log.length
    const typesafe = process.env.TYPESAFE_API_KEY
    if (!typesafe) throw new VerifyError("TYPESAFE_API_KEY is not set in this shell. source the dev vars first")
    await s.connectProvider("typesafe", typesafe)
    await s.disconnectProvider("typesafe")
    await s.disconnectProvider(TEST_PROVIDER)
    await s.connectProvider(TEST_PROVIDER, process.env.OPENCODE_API_KEY!)
    await Bun.sleep(1_000)
    const moved = user.log.slice(quiet).flatMap((e) => (e.dir === "in" ? modelEvents(e.frame as UserToClient) : []))
    expectEqual(moved, [], "model events after key changes")
    await ask("reply with the single word two.", DEEPSEEK)

    user.send({ t: "agent_model", slug: "kiko" as AgentSlug, ref: MUSE })
    await user.expect((f) => modelEvents(f).some((e) => e.slug === "kiko" && e.model === MUSE))
    await ask("reply with the single word three.", MUSE)

    const gone: Agent = { id: crypto.randomUUID(), name: "Gone", slug: `gone${Date.now().toString(36)}` as AgentSlug, prompt: "", model: "opencode-go/retired-model" }
    user.send({ t: "agent", op: { op: "create", agent: gone } })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "agent" && e.agent.slug === gone.slug))
    const fresh = await (await s.user()).expect((f) => f.t === "reset")
    expectEqual(fresh.t === "reset" ? fresh.snapshot.agentModels?.[gone.slug]?.model : undefined, gone.model, "an agent made with an unlisted model keeps it")
    const { room: goneRoom } = await newRoom(s, "unlisted model", [gone.id])
    await resetStats(v, s)
    await send(goneRoom, "reply with the single word four.")
    const failed = await poll(
      "a run error for the unlisted model",
      () => frames(goneRoom).flatMap((f) => (f.t === "events" ? f.events : [])).find((e) => e.t === "message" && (e.event as { kind?: string } | undefined)?.kind === "run_error"),
      90_000,
    )
    const called = calledModels(await readStats(v, s))
    console.log(`  the unlisted model failed with ${JSON.stringify(failed.t === "message" ? { text: failed.text, event: failed.event } : failed)}; models called ${JSON.stringify(called)}`)
    const fresh2 = await v.as(`model-unpicked-${Date.now().toString(36)}`)
    await fresh2.connectProvider(TEST_PROVIDER, process.env.OPENCODE_API_KEY!)
    const { room: unpicked } = await newRoom(fresh2, "no model picked")
    await send(unpicked, "hi")
    const asked = await poll(
      "a no_model run error for an agent nobody picked a model for",
      () => frames(unpicked).flatMap((f) => (f.t === "events" ? f.events : [])).find((e) => e.t === "message" && (e.event as { kind?: string; reason?: string } | undefined)?.reason === "no_model"),
      60_000,
    )
    console.log(`  an unpicked Kiko said ${JSON.stringify(asked.t === "message" ? { text: asked.text, actions: (asked.event as { actions?: unknown }).actions } : asked)}`)
    if (seen(unpicked).live.some((m) => m.from.kind === "agent" && !m.event)) throw new VerifyError("an agent with no model answered anyway")
    if (seen(goneRoom).live.some((m) => m.from.kind === "agent" && !(m.event as { kind?: string } | undefined)?.kind)) throw new VerifyError("an agent on an unlisted model answered on some other model")
  },
}

export default suite
