import { VerifyError } from "../client"
import { newRoom } from "../kit"
import { inSeconds, ok, type Routine } from "../routine-kit"
import type { Suite } from "../runner"

type Loop = { id: number; room: string; text: string; status: string }

// A routine and a plate item belong to the chat they were made in. Another chat of the same owner never lists them.
const suite: Suite = {
  name: "plate-scope",
  async run(v) {
    const s = await v.as("plate-scope")
    const url = v.url
    const tag = Date.now().toString(36)
    const a = await newRoom(s, "scope: room a")
    const b = await newRoom(s, "scope: room b")

    const standup = `standup ${tag}`
    const venue = `book the venue ${tag}`
    const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId: a.roomId, name: standup, instructions: "[quiet]", trigger: { on: "time", at: inSeconds(3600), rrule: "FREQ=DAILY" } })
    await ok(url, s, "dev/agent/loops", { open: { roomId: a.roomId, text: venue, due: null } })

    const { routines } = await ok<{ routines: Routine[] }>(url, s, "routines")
    const mine = routines.find((r) => r.id === routine.id)
    if (mine?.roomId !== a.roomId) throw new VerifyError(`the routine should belong to room a, got ${JSON.stringify(mine)}`)
    const inB = routines.filter((r) => r.roomId === b.roomId)
    if (inB.some((r) => r.id === routine.id)) throw new VerifyError(`room b lists room a's routine: ${JSON.stringify(inB)}`)
    console.log(`  ok the routine is in room a only`)

    const all = (await ok<{ loops: Loop[] }>(url, s, "loops")).loops
    const item = all.find((l) => l.text === venue)
    if (item?.room !== a.roomId) throw new VerifyError(`the plate item should belong to room a, got ${JSON.stringify(item)}`)
    const onB = (await ok<{ loops: Loop[] }>(url, s, `loops?room=${b.roomId}`)).loops
    if (onB.some((l) => l.text === venue)) throw new VerifyError(`room b's plate lists room a's item: ${JSON.stringify(onB)}`)
    const onA = (await ok<{ loops: Loop[] }>(url, s, `loops?room=${a.roomId}`)).loops
    if (!onA.some((l) => l.text === venue)) throw new VerifyError(`room a's plate is missing its item: ${JSON.stringify(onA)}`)
    console.log(`  ok the plate item is in room a only`)
  },
}

export default suite
