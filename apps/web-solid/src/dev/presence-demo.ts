import type { AgentSlug, RoomToClient } from "@kiko/protocol"
import { useApp } from "../lib/store"

/*
 * DEVELOPMENT ONLY. Plays a scripted run in the open chat so the presence row can be seen
 * without a model key: the same `typing` and `status` frames the room sends during a real run,
 * fed through the room store's own handler. Run it from the palette, "dev: play the presence demo".
 */

const SCRIPT: readonly (string | undefined)[] = [
  undefined,
  "reading /notes.md",
  "reading a web page",
  "editing /draft.md",
  "running code on the human's connected apps",
  "working with a helper",
  "handling a reminder",
  "setting up agents",
]
const STEP_MS = 3_200

let timers: ReturnType<typeof setTimeout>[] = []

export function playPresenceDemo(): void {
  const room = useApp.room()
  const feed = room?.devFrame
  if (!room || !feed) return
  for (const t of timers) clearTimeout(t)
  timers = []
  const slugs = (room.members().map((m) => m.slug).length ? room.members().map((m) => m.slug) : ["kiko"]).slice(0, 3) as AgentSlug[]
  const lead = slugs[0]!
  const at = (ms: number, frames: RoomToClient[]) => timers.push(setTimeout(() => frames.forEach(feed), ms))

  at(0, [{ t: "typing", who: [lead] }, { t: "status", slug: lead, state: "typing" }])
  SCRIPT.forEach((doing, i) => {
    if (i === 0) return
    at(i * STEP_MS, [{ t: "status", slug: lead, state: "working", doing: doing! }])
  })
  // The team joins in: every agent writing at once.
  const group = SCRIPT.length * STEP_MS
  at(group, [{ t: "typing", who: slugs }, ...slugs.map((slug) => ({ t: "status", slug, state: "typing" }) as RoomToClient)])
  at(group + STEP_MS * 1.5, [{ t: "typing", who: [] }, ...slugs.map((slug) => ({ t: "status", slug, state: "idle" }) as RoomToClient)])
}
