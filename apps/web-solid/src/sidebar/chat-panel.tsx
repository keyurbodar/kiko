import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronDownIcon, PlusIcon, SlidersIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js"
import { runCommand } from "../commands/registry"
import type { RosterBot } from "../lib/types"
import { room } from "../state/room"
import { user } from "../state/user"
import { markedUnread } from "./actions"
import { ChatRow, isLive } from "./chat-row"
import { filterRows, pinnedRows } from "./filter"
import { flipRows } from "./flip"
import { createFailuresElsewhere } from "./failures"
import { type Need, needsOf } from "./needs"

const SKELETON_ROWS = [62, 48, 70, 54, 66, 44]

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i])

function SectionLabel(props: {
  label: string
  open: boolean
  onToggle: () => void
  children?: JSX.Element
}): JSX.Element {
  return (
    <div class="chat-section" data-component="sidebar-section-label">
      <button
        type="button"
        class="chat-section-toggle"
        aria-expanded={props.open}
        data-open={props.open ? "" : undefined}
        onClick={props.onToggle}
      >
        {props.label}
        <RemixIcon icon={ChevronDownIcon} size={11} class="chat-section-chevron" />
      </button>
      <span class="chat-section-actions">{props.children}</span>
    </div>
  )
}

function Fold(props: { open: boolean; children: JSX.Element }): JSX.Element {
  return (
    <div class="chat-fold" data-open={props.open ? "" : undefined} inert={!props.open}>
      <div class="chat-fold-inner">{props.children}</div>
    </div>
  )
}

export type ChatSectionsProps = {
  bots: readonly RosterBot[]
  needs: ReadonlyMap<string, Need>
  activeId: string | null
  mainId: string | null | undefined
  muted: ReadonlySet<string>
  now: number
  loading: boolean
}

type OpenState = { needs: boolean; working: boolean; pinned: boolean; chats: boolean }

export function ChatSections(props: ChatSectionsProps): JSX.Element {
  const [unreadOnly, setUnreadOnly] = createSignal(false)
  const [open, setOpen] = createSignal<OpenState>({ needs: true, working: true, pinned: true, chats: true })
  const toggle = (key: keyof OpenState) => setOpen((all) => ({ ...all, [key]: !all[key] }))
  const [settled, setSettled] = createSignal(false)
  onMount(() => requestAnimationFrame(() => setSettled(true)))

  const shown = createMemo(() =>
    filterRows(
      props.bots,
      { query: "", unreadOnly: unreadOnly() },
      (row) => row.unread > 0 || markedUnread(row.id) || props.needs.has(row.id),
    ),
  )
  const asking = createMemo(() => shown().filter((bot) => props.needs.has(bot.id)))
  const calm = createMemo(() => shown().filter((bot) => !props.needs.has(bot.id)))
  const working = createMemo(() => calm().filter(isLive))
  const rest = createMemo(() => calm().filter((bot) => !isLive(bot)))
  const pinned = createMemo(() => pinnedRows(rest(), props.mainId))
  const showPinned = createMemo(() => pinned().some((bot) => bot.id !== props.mainId))
  const pinnedList = createMemo(() => (showPinned() ? pinned() : []))
  const chats = createMemo(() =>
    showPinned() ? rest().filter((bot) => !bot.pinned) : [...pinned(), ...rest().filter((bot) => !bot.pinned)],
  )

  const idsOf = (rows: () => readonly RosterBot[]) =>
    createMemo(() => rows().map((bot) => bot.id), undefined, { equals: sameIds })
  const needIds = idsOf(asking)
  const workingIds = idsOf(working)
  const pinnedIds = idsOf(pinnedList)
  const chatIds = idsOf(chats)
  const byId = createMemo(() => new Map(shown().map((bot) => [bot.id, bot])))
  const jumpHint = createMemo(() => {
    if (unreadOnly()) return new Map<string, string>()
    const order = [...props.bots.filter((b) => b.pinned), ...props.bots.filter((b) => !b.pinned)].slice(0, 9)
    return new Map(order.map((b, i) => [b.id, `chats.go-${i + 1}`]))
  })

  let scroller: HTMLDivElement | undefined
  flipRows(
    () => scroller,
    () => [...needIds(), "|", ...workingIds(), "|", ...pinnedIds(), "|", ...chatIds()],
  )

  const rows = (ids: () => readonly string[], pinMark = false) => (
    <For each={ids()}>
      {(id) => (
        <Show when={byId().get(id)}>
          {(bot) => (
            <ChatRow
              bot={bot()}
              hint={jumpHint().get(id)}
              active={props.activeId === id}
              main={id === props.mainId}
              muted={props.muted.has(id)}
              now={props.now}
              enter={settled()}
              pinMark={pinMark}
              need={props.needs.get(id)}
            />
          )}
        </Show>
      )}
    </For>
  )

  return (
    <div class="chat-scroll" data-component="sidebar-list" ref={(el) => (scroller = el)}>
      <Show when={asking().length > 0}>
        <div data-component="sidebar-needs" data-section="needs">
          <SectionLabel label="Needs you" open={open().needs} onToggle={() => toggle("needs")} />
          <Fold open={open().needs}>{rows(needIds)}</Fold>
        </div>
      </Show>
      <Show when={working().length > 0}>
        <div data-section="working">
          <SectionLabel label="Working" open={open().working} onToggle={() => toggle("working")} />
          <Fold open={open().working}>{rows(workingIds)}</Fold>
        </div>
      </Show>
      <Show when={pinnedList().length > 0}>
        <div data-section="pinned">
          <SectionLabel label="Pinned" open={open().pinned} onToggle={() => toggle("pinned")} />
          <Fold open={open().pinned}>{rows(pinnedIds, true)}</Fold>
        </div>
      </Show>
      <SectionLabel label="Chats" open={open().chats} onToggle={() => toggle("chats")}>
        <TooltipV2 placement="bottom" openDelay={400} value="New chat">
          <button
            type="button"
            class="chat-section-button"
            data-component="sidebar-chats-new"
            aria-label="New chat"
            onClick={() => runCommand("chat.new")}
          >
            <RemixIcon icon={PlusIcon} size={15} />
          </button>
        </TooltipV2>
        <TooltipV2 placement="bottom" openDelay={400} value="Unread only">
          <button
            type="button"
            class="chat-section-button"
            data-component="sidebar-filter"
            aria-label="Show unread only"
            aria-pressed={unreadOnly()}
            onClick={() => setUnreadOnly(!unreadOnly())}
          >
            <RemixIcon icon={SlidersIcon} size={15} />
          </button>
        </TooltipV2>
      </SectionLabel>
      <Show when={shown().length === 0 && unreadOnly()}>
        <div class="chat-empty" data-component="sidebar-empty">
          No unread chats
        </div>
      </Show>
      <Show when={props.loading}>
        <div class="chat-skeleton-list" data-component="sidebar-skeleton" aria-hidden="true">
          <For each={SKELETON_ROWS}>
            {(width) => (
              <div class="chat-skeleton-row">
                <span class="chat-skeleton chat-skeleton-avatar motion-skeleton" />
                <span class="chat-skeleton-text">
                  <span class="chat-skeleton motion-skeleton" style={{ width: `${width}%` }} />
                  <span class="chat-skeleton motion-skeleton" style={{ width: `${width - 20}%` }} />
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Fold open={open().chats}>{rows(chatIds)}</Fold>
    </div>
  )
}

export function ChatPanel() {
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 60_000)
  onCleanup(() => clearInterval(clock))

  const all = createMemo(() => room.bots())
  const muted = createMemo(() => new Set((user.chats() ?? []).filter((c) => c.muted).map((c) => c.roomId as string)))
  const elsewhere = createFailuresElsewhere(() => room.activeId())
  const needs = createMemo(() =>
    needsOf({
      activeId: room.activeId(),
      asks: room.active()?.asks() ?? [],
      messages: room.messages(),
      retry: (id) => room.retryRun(id),
      elsewhere: elsewhere(),
    }),
  )
  const loading = () => all().length === 0 && !!user.loaded() && !user.synced()

  return (
    <div class="chat-panel" data-component="sidebar-chats">
      <ChatSections
        bots={all()}
        needs={needs()}
        activeId={room.activeId()}
        mainId={user.kikoChatId()}
        muted={muted()}
        now={now()}
        loading={loading()}
      />
    </div>
  )
}
