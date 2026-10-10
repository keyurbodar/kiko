import { HugeIcon } from "@yuki/ui/huge-icon"
import { CheckIcon, CloseIcon, MoonIcon } from "@yuki/ui/icons"
import { showToastV2 } from "@yuki/ui/v2/toast-v2"
import { createSignal, For, Show } from "solid-js"
import { shortDate } from "./format"

/*
 * "On your plate" (architecture section 26): the human's open loops, one list per chat, in the same
 * shape as the routines list. An agent opens a loop when you state a goal, a plan or a deadline; here
 * you mark it done, push it to tomorrow, or drop it. Each change applies at once and is put back, with
 * a toast, if the server refuses it. The list stays in memory, so a reopened panel paints at once and
 * the fetch only corrects it.
 */

export type PlateLoop = { id: number; room: string; text: string; due: string | null; snoozedUntil: number | null }

const [all, setAll] = createSignal<readonly PlateLoop[] | undefined>(undefined)

/** Only what the panel draws. A row without an id, a chat, and words is dropped. */
export function readLoops(value: unknown): PlateLoop[] {
  const rows = (value as { loops?: unknown })?.loops
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r: Record<string, unknown>) =>
    typeof r?.id === "number" && typeof r.room === "string" && typeof r.text === "string" && r.text
      ? [{ id: r.id, room: r.room, text: r.text, due: typeof r.due === "string" ? r.due : null, snoozedUntil: typeof r.snoozedUntil === "number" ? r.snoozedUntil : null }]
      : [],
  )
}

export async function loadLoops(): Promise<void> {
  const res = await fetch("/api/loops").catch(() => null)
  if (res?.ok) setAll(readLoops(await res.json().catch(() => null)))
  else if (all() === undefined) setAll([])
}

/** A chat's loops that are not snoozed past now. */
export const loopsOf = (chatId: string, now = Date.now()): readonly PlateLoop[] | undefined =>
  all()?.filter((l) => l.room === chatId && (l.snoozedUntil === null || l.snoozedUntil <= now))

/** Tomorrow at 9:00 in the human's time zone. */
export function tomorrow(from = new Date()): number {
  const d = new Date(from)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

const post = (id: number, body: unknown) =>
  fetch(`/api/loops/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.ok).catch(() => false)

async function act(loop: PlateLoop, body: { action: "done" | "drop" } | { action: "snooze"; until: number }, failed: string): Promise<void> {
  setAll((list) => (body.action === "snooze" ? list?.map((l) => (l.id === loop.id ? { ...l, snoozedUntil: body.until } : l)) : list?.filter((l) => l.id !== loop.id)))
  if (!(await post(loop.id, body))) {
    setAll((list) => (list?.some((l) => l.id === loop.id) ? list.map((l) => (l.id === loop.id ? loop : l)) : [loop, ...(list ?? [])]))
    showToastV2({ title: failed, variant: "error" })
  }
}

const faint = "text-[color-mix(in_oklab,var(--text)_40%,transparent)]"
const tool =
  "grid size-7 shrink-0 place-items-center rounded-md text-[color-mix(in_oklab,var(--text)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--text)_8%,transparent)] hover:text-text"

function dueLabel(due: string | null): string {
  if (!due) return ""
  const at = Date.parse(due)
  return Number.isNaN(at) ? "" : `Due ${shortDate(at)}`
}

function LoopRow(props: { loop: PlateLoop }) {
  return (
    <li class="flex items-center gap-1 rounded-md pr-1 hover:bg-[color-mix(in_oklab,var(--text)_5%,transparent)]" data-loop={props.loop.id}>
      <div class="flex min-w-0 flex-1 flex-col px-2 py-2">
        <span class="text-[12px] leading-5 text-[color-mix(in_oklab,var(--text)_85%,transparent)]" data-component="loop-text">{props.loop.text}</span>
        <Show when={dueLabel(props.loop.due)}>{(label) => <span class={`text-[11px] leading-4 ${faint}`}>{label()}</span>}</Show>
      </div>
      <button type="button" class={tool} aria-label="Done" title="Done" data-action="loop-done" onClick={() => void act(props.loop, { action: "done" }, "Could not mark that done")}>
        <HugeIcon icon={CheckIcon} size={14} />
      </button>
      <button type="button" class={tool} aria-label="Snooze until tomorrow" title="Snooze until tomorrow" data-action="loop-snooze" onClick={() => void act(props.loop, { action: "snooze", until: tomorrow() }, "Could not snooze that")}>
        <HugeIcon icon={MoonIcon} size={14} />
      </button>
      <button type="button" class={tool} aria-label="Drop" title="Drop" data-action="loop-drop" onClick={() => void act(props.loop, { action: "drop" }, "Could not drop that")}>
        <HugeIcon icon={CloseIcon} size={14} />
      </button>
    </li>
  )
}

export function PlatePage(props: { chatId: string }) {
  return (
    <div class="px-2 py-2" data-component="info-plate">
      <Show when={loopsOf(props.chatId)} fallback={<p class={`px-2 py-6 text-center text-[12px] ${faint}`}>Loading</p>}>
        {(list) => (
          <Show when={list().length} fallback={<p class={`px-2 py-6 text-center text-[12px] leading-5 ${faint}`}>Nothing on your plate. Goals, plans and deadlines you mention show up here.</p>}>
            <ul class="flex flex-col gap-px">
              <For each={list()}>{(loop) => <LoopRow loop={loop} />}</For>
            </ul>
          </Show>
        )}
      </Show>
    </div>
  )
}
