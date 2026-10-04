import type { AgentSlug, RoomToClient } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { useApp } from "../lib/store"

/*
 * DEVELOPMENT ONLY. Two ways to watch the presence row without a model key.
 *
 * `playPresenceDemo` plays a scripted run in the open chat: the same `typing`, `status` and
 * `draft` frames the room sends during a real run, fed through the room store's own handler.
 * Final messages are not faked, because the store would keep them in this browser's history;
 * the streaming bubbles are drafts, which the room never stores and clears at the end.
 *
 * `newFakeChat` opens a new chat whose agents answer from the scripted fake of the server's
 * `dev-fake.ts`, which posts real messages and spends no tokens. An agent reads the flag when
 * its first message arrives, so it must be set on a chat that has none: every one of your agents
 * is marked for the new chat, so any you add to it answers from the script too. Markers in your
 * text pick the script, such as `[tool]`, `[slow]` and `[two-part]`.
 */

const SOLO: readonly (string | undefined)[] = [
  undefined,
  "reading /notes.md",
  "reading a web page",
  "editing /draft.md",
  "running code on the human's connected apps",
  "working with a helper",
  "handling a reminder",
  "setting up agents",
]
const TEAM: readonly (string | undefined)[] = ["editing /plan.md", "reading a web page", undefined]
const REPLIES = [
  "late november is peak maple season, so book early. scout is checking ryokans now.",
  "found three that fit. the quietest is in ohara, forty minutes north, with private baths.",
  "all three come in under ¥30k a night if you skip the weekend.",
]
const STEP_MS = 2_400
const TYPE_MS = 60

let timers: ReturnType<typeof setTimeout>[] = []

function slugsOf(): AgentSlug[] {
  const members = useApp.room()?.members().map((m) => m.slug) ?? []
  return (members.length ? members : ["kiko"]).slice(0, 3) as AgentSlug[]
}

export function playPresenceDemo(): void {
  const feed = useApp.room()?.devFrame
  if (!feed) return
  for (const t of timers) clearTimeout(t)
  timers = []
  const slugs = slugsOf()
  const lead = slugs[0]!
  const runId = `demo-${Date.now()}`
  let clock = 0
  const at = (ms: number, frames: RoomToClient[]) => timers.push(setTimeout(() => frames.forEach(feed), ms))

  // One agent at work, through every act.
  at(clock, [{ t: "typing", who: [lead] }, { t: "status", slug: lead, state: "typing" }])
  SOLO.forEach((doing, i) => {
    if (i > 0) at((clock = i * STEP_MS), [{ t: "status", slug: lead, state: "working", doing: doing! }])
  })

  // The team at once, each on its own act.
  clock += STEP_MS
  at(clock, [
    { t: "typing", who: slugs },
    ...slugs.map((slug, i): RoomToClient => (TEAM[i] ? { t: "status", slug, state: "working", doing: TEAM[i]! } : { t: "status", slug, state: "typing" })),
  ])

  // Each agent's reply streams in as a bubble, one after another. A drafting agent leaves the row.
  clock += STEP_MS * 2
  slugs.forEach((slug, i) => {
    const text = REPLIES[i % REPLIES.length]!
    for (let n = 4; n <= text.length + 3; n += 3) at(clock + n * TYPE_MS, [{ t: "draft", slug, runId, index: i, text: text.slice(0, n) }])
    clock += text.length * TYPE_MS + 500
  })

  // The run ends. Without a final message to replace them, the drafts clear with it.
  clock += 4_000
  at(clock, [{ t: "typing", who: [] }, ...slugs.map((slug): RoomToClient => ({ t: "status", slug, state: "idle" }))])
}

export async function newFakeChat(openChat: () => void): Promise<void> {
  const before = location.pathname
  openChat()
  await new Promise((done) => setTimeout(done, 300))
  const roomId = location.pathname !== before ? decodeURIComponent(location.pathname.split("/").pop() ?? "") : ""
  if (!roomId) return void showToastV2({ title: "no new chat opened", variant: "error" })
  const slugs = ["kiko", ...useApp.agents().map((a) => a.slug)].filter((s, i, all) => all.indexOf(s) === i)
  const res = await fetch("/api/dev/agent/fake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId, slugs }),
  }).catch(() => null)
  showToastV2(
    res?.ok
      ? { title: "this chat answers from the dev script. try [two-part], [slow] or [tool] in a message, and add agents for a team." }
      : { title: "the dev server did not take the fake agents", variant: "error" },
  )
}
