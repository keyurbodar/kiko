// Smoke scenario, real models. Usage (server running, keys in the shell):
//   set -a; . apps/server/.dev.vars; set +a
//   bun .cursor/skills/verify-initiative/scripts/smoke.ts [--jev]
import { agentTexts, background, lifeLines, openChat, reminders, routines, save, say, setup, transcript, URL_, usage } from "./kit"

const jev = process.argv.includes("--jev")
const ctx = await setup({ name: `init-smoke-${jev ? "jev" : "nojev"}-${Date.now().toString(36)}`, jev })
const room = await openChat(ctx, "initiative smoke")
const t0 = Date.now()
const reply = await say(room, "heads up: my tax filing is due on november 14. i keep forgetting these things.")
console.log(`agent (${((Date.now() - t0) / 1000).toFixed(1)}s):`, JSON.stringify(reply))
await Bun.sleep(8_000) // let capture settle
const lines = await lifeLines(ctx)
const u = await usage(ctx, room)
const r = await routines(URL_, ctx.s)
console.log("life lines:", JSON.stringify(lines.map((l) => `${l.source}: ${l.text}`)))
const rem = await reminders(ctx)
console.log("reminders:", JSON.stringify(rem).slice(0, 600))
console.log("routines:", JSON.stringify(r.routines.map((x) => `${x.name} ${x.status}`)))
console.log("agent usage:", JSON.stringify(u.agent))
console.log("memory usage:", JSON.stringify(u.memory), "background tokens:", background(u.memory))
console.log("evidence:", save(ctx, "transcript", transcript(room)), save(ctx, "lifelines", lines), save(ctx, "usage", u), save(ctx, "routines", r), save(ctx, "reminders", rem))
if (!agentTexts(room).length) throw new Error("the agent said nothing")
ctx.v.closeAll()
process.exit(0)
