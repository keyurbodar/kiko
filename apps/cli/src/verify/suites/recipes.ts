import type { RecipeInstall } from "@kiko/protocol"
import { VerifyError } from "../client"
import { agentTexts, messages, newRoom, poll } from "../kit"
import { api, ok, type Routine } from "../routine-kit"
import type { Suite } from "../runner"
import { fake } from "./mid-run"

type Full = Routine & { rrule: string | null }

const suite: Suite = {
  name: "recipes",
  async run(v) {
    const s = await v.as(`recipes-${Date.now()}`)
    const url = v.url
    const { roomId, room } = await newRoom(s, "recipes")
    await fake(v, s, roomId)
    const mine = async () => (await ok<{ routines: Full[] }>(url, s, "routines")).routines.filter((r) => r.roomId === roomId && r.status === "active")

    const installId = crypto.randomUUID()
    const body = { installId, slug: "morning-briefing", roomId, agent: "yuki" }
    const { install } = await ok<{ install: RecipeInstall }>(url, s, "recipes", body)
    if (install.roomId !== roomId || install.agent !== "yuki") throw new VerifyError(`expected the install in this chat for kiko, got ${JSON.stringify(install)}`)
    await poll("the agent hearing the recipe", () => agentTexts(room).some((t) => t.includes('"Morning briefing" recipe')), 20_000)
    await poll("the added line", () => messages(room).some((m) => m.from.kind === "system" && m.text === "Morning briefing added"), 5_000)
    const [routine, ...extra] = await mine()
    if (!routine || extra.length || routine.name !== "morning briefing" || routine.target !== "yuki") throw new VerifyError(`expected one morning briefing routine for kiko, got ${JSON.stringify(await mine())}`)
    const due = new Date(routine.dueUtc)
    if (`${due.getUTCHours()}:${due.getUTCMinutes()}:${due.getUTCSeconds()}` !== "7:55:0" || !routine.rrule?.includes("FREQ=DAILY")) throw new VerifyError(`expected a daily routine due at 7:55:00 UTC, got ${due.toISOString()} ${routine.rrule}`)
    const skill = await fetch(new URL(`api/files/${roomId}/skills/morning-briefing/SKILL.md`, url), { headers: { cookie: s.cookie } })
    const text = await skill.text()
    if (!skill.ok || !text.startsWith("---\nname: morning-briefing\n") || !text.includes("each morning")) throw new VerifyError(`expected the recipe as a chat skill, got ${skill.status} ${text.slice(0, 120)}`)
    console.log(`  ok the recipe made routine ${routine.id} due ${due.toISOString()}, wrote its skill, and woke kiko`)

    const again = await ok<{ install: RecipeInstall }>(url, s, "recipes", body)
    if (again.install.at !== install.at || (await mine()).length !== 1) throw new VerifyError("a retried install made a second routine or a second install")
    const listed = await ok<{ installs: RecipeInstall[] }>(url, s, "recipes")
    if (listed.installs.filter((i) => i.slug === "morning-briefing").length !== 1) throw new VerifyError(`expected one listed install, got ${JSON.stringify(listed.installs)}`)
    console.log("  ok a retry with the same install id changed nothing")

    const stranger = await api<{ error: string }>(url, s, "recipes", { installId: crypto.randomUUID(), slug: "morning-briefing", roomId, agent: "nobody-here" })
    if (stranger.status !== 400 || !String(stranger.json.error).includes("not in that chat") || (await mine()).length !== 1) throw new VerifyError(`an agent outside the chat should be refused with nothing left behind, got ${stranger.status} ${JSON.stringify(stranger.json)}`)
    const unknown = await api<{ error: string }>(url, s, "recipes", { installId: crypto.randomUUID(), slug: "no-such-recipe", roomId, agent: "yuki" })
    if (unknown.status !== 400) throw new VerifyError(`an unknown recipe should be refused, got ${unknown.status}`)
    console.log("  ok an agent outside the chat and an unknown recipe were refused, and left no routine")

    const own = await ok<{ install: RecipeInstall }>(url, s, "recipes", { installId: crypto.randomUUID(), slug: "morning-briefing", own: true })
    if (own.install.roomId === roomId || !own.install.agent.startsWith("briefing")) throw new VerifyError(`expected a new chat with @briefing, got ${JSON.stringify(own.install)}`)
    const ownRoutines = (await ok<{ routines: Full[] }>(url, s, "routines")).routines.filter((r) => r.roomId === own.install.roomId)
    if (ownRoutines.length !== 1 || ownRoutines[0]?.target !== own.install.agent) throw new VerifyError(`expected the new agent's routine in its chat, got ${JSON.stringify(ownRoutines)}`)
    console.log(`  ok "its own chat" made @${own.install.agent} in chat ${own.install.roomId} with its routine`)
    room.raw.close()
  },
}

export default suite
