import type { RecipeInstall, RecipeList } from "@kiko/protocol"
import { VerifyError } from "../client"
import { agentTexts, frames, messages, newRoom, poll } from "../kit"
import { api, ok, type Routine, toolLine } from "../routine-kit"
import type { Suite } from "../runner"
import { team } from "./team-loops"
import { fake, send } from "./mid-run"

type Full = Routine & { rrule: string | null }

const suite: Suite = {
  name: "recipes",
  async run(v) {
    const s = await v.as(`recipes-${Date.now()}`)
    const url = v.url
    const { roomId, room } = await newRoom(s, "recipes")
    await fake(v, s, roomId)
    const mine = async () => (await ok<{ routines: Full[] }>(url, s, "routines")).routines.filter((r) => r.roomId === roomId && r.status === "active")

    const library = await ok<RecipeList>(url, s, "recipes")
    const seeded = library.cards.find((c) => c.slug === "morning-briefing")
    if (library.cards.length < 10 || !seeded?.glyph.includes("<path") || library.broken.length) throw new VerifyError(`expected the built-in recipes in /home/recipes with icons, got ${library.cards.length} cards, broken ${JSON.stringify(library.broken)}`)
    const tea = "---\ntitle: Tea time\ndescription: A cup of tea and a short break at four.\nwhen: Daily at 16:00\ntags: [health]\ntriggers:\n  - every: FREQ=DAILY;BYHOUR=16;BYMINUTE=0\n    run: say tea time. follow the tea-time skill.\n---\nsay it is tea time, in one bubble.\n"
    const put = await s.putFile("home", "recipes/tea-time/RECIPE.md", tea, { type: "text/markdown" })
    const bad = await s.putFile("home", "recipes/broken/RECIPE.md", "---\ntitle: Broken\n---\nno description", { type: "text/markdown" })
    if (!put.ok || !bad.ok) throw new VerifyError(`writing to /home/recipes answered ${put.status} and ${bad.status}`)
    const mine2 = await ok<RecipeList>(url, s, "recipes")
    const teaCard = mine2.cards.find((c) => c.slug === "tea-time")
    if (!teaCard || mine2.broken.length !== 1 || !mine2.broken[0]?.includes("recipe broken: description is required")) throw new VerifyError(`expected the new recipe as a card and the broken one listed, got ${JSON.stringify({ teaCard: teaCard?.icon, broken: mine2.broken })}`)
    console.log(`  ok ${library.cards.length} built-in recipes were in /home/recipes; a new file became a card (${teaCard.icon}) and a broken one was named`)

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
    console.log(`  ok the recipe made routine ${routine.id} due ${due.toISOString()} and woke kiko`)

    const again = await ok<{ install: RecipeInstall }>(url, s, "recipes", body)
    if (again.install.at !== install.at || (await mine()).length !== 1) throw new VerifyError("a retried install made a second routine or a second install")
    const differentId = await ok<{ install: RecipeInstall }>(url, s, "recipes", { ...body, installId: crypto.randomUUID() })
    if (differentId.install.installId !== install.installId || (await mine()).length !== 1) throw new VerifyError("a new id duplicated the same recipe, chat, and agent")
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
    await send(room, toolLine("add_recipe", { slug: "tea-time" }))
    await poll("the agent's own add", async () => (await mine()).some((r) => r.name === "tea time"), 20_000)
    await poll("the add_recipe result", () => agentTexts(room).some((t) => t.includes("tool: added.")), 10_000)
    const teaRoutine = (await mine()).find((r) => r.name === "tea time")
    await poll("the added line", () => messages(room).some((m) => m.from.kind === "system" && m.text === "Tea time added"), 5_000)
    await Bun.sleep(1500)
    if (teaRoutine?.target !== "yuki" || agentTexts(room).some((t) => t.includes('"Tea time" recipe') && !t.includes("tool: added."))) throw new VerifyError("an agent's own add_recipe should make its routine and not wake the agent again")
    console.log("  ok an agent's add_recipe made the routine and got the setup text as its tool result")
    const edited = tea.replace("BYHOUR=16;BYMINUTE=0", "BYHOUR=17;BYMINUTE=30")
    const changed = await s.putFile("home", "recipes/tea-time/RECIPE.md", edited, { expect: new Bun.CryptoHasher("sha256").update(tea).digest("hex"), type: "text/markdown" })
    if (!changed.ok) throw new VerifyError(`editing the recipe answered ${changed.status}`)
    await poll("the file edit to update its routine without reopening the gallery", async () => (await mine()).find((r) => r.id === teaRoutine?.id)?.rrule?.includes("BYHOUR=17;BYMINUTE=30;BYSECOND=0"))
    const user = await s.user()
    user.send({ t: "home", op: { op: "rm", paths: ["recipes/tea-time/RECIPE.md"] } })
    await poll("a deleted recipe to pause its routine", async () => (await ok<{ routines: Full[] }>(url, s, "routines")).routines.find((r) => r.id === teaRoutine?.id)?.status === "paused")
    const removed = await api(url, s, `recipes/${install.installId}`, undefined, "DELETE")
    if (removed.status !== 200 || (await mine()).some((r) => r.id === routine.id)) throw new VerifyError("removing an install left its routine running")
    const readded = await ok<{ install: RecipeInstall }>(url, s, "recipes", { ...body, installId: crypto.randomUUID() })
    await ok(url, s, `reminders/${(await mine()).find((r) => r.name === "morning briefing")?.id}/cancel`, {})
    if ((await ok<RecipeList>(url, s, "recipes")).installs.some((i) => i.installId === readded.install.installId)) throw new VerifyError("cancelling the last routine left the install behind")
    console.log("  ok file edits updated the routine, deletion paused it, removal stopped it, and cancellation cleared its install")

    const group = await team(v, s, ["ada", "bea"], "recipe group")
    const groupInstalls = []
    for (const agent of ["yuki", "ada", "bea"]) groupInstalls.push((await ok<{ install: RecipeInstall }>(url, s, "recipes", { installId: crypto.randomUUID(), slug: "morning-briefing", roomId: group.roomId, agent })).install)
    const groupRoutines = () => ok<{ routines: Full[] }>(url, s, "routines").then((x) => x.routines.filter((r) => r.roomId === group.roomId && r.status === "active"))
    if ((await groupRoutines()).length !== 3) throw new VerifyError("each group member should have one routine")
    await api(url, s, `recipes/${groupInstalls[1]?.installId}`, undefined, "DELETE")
    const left = (await groupRoutines()).map((r) => r.target).sort()
    if (JSON.stringify(left) !== JSON.stringify(["bea", "yuki"])) throw new VerifyError(`removing Ada affected the other agents: ${left}`)
    console.log("  ok three agents used one recipe in a group; removing Ada left Kiko and Bea running")
    group.room.raw.close()
    room.raw.close()
  },
}

export default suite
