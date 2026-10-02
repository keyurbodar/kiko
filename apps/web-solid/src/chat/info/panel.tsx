import { createEffect, createMemo, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { useCommands } from "../../commands/registry"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { useApp } from "../../lib/store"
import { chatModel, setChatModel } from "../../settings/chat-model"
import { ModelList } from "../../settings/model-picker"
import { createCatalog } from "./catalog"
import { FilesCard, FilesList, LinksCard, LinksList, MediaCard, MediaList } from "./lists"
import { ChatMemory, MemoryError, MemoryList, RecordView, useMemoryStore } from "./memory/views"
import { Card, chatOf, Danger, Header, Members, ModelCard, roomMembers, Toggles } from "./sections"
import {
  closeInfo,
  type InfoView,
  infoDepth,
  infoSections,
  infoView,
  infoWidth,
  MAX_WIDTH,
  MIN_WIDTH,
  popInfo,
  pushInfo,
  resetInfo,
  setInfoWidth,
} from "./state"

/*
 * The chat info panel: everything about one chat behind one click on its name. It is the
 * right-hand column of the shell, 360 px by default and resizable by its left edge. The
 * shell loads this file on the first open, so the chat route does not carry it.
 *
 * Each card opens its full list inside the panel, and the back arrow returns. Nothing here
 * animates. The panel stays mounted across chats, and the scroll position of each chat's view
 * is kept, so coming back to a chat finds its panel where it was left.
 */

const scrolls = new Map<string, number>()

const TITLES: Record<InfoView["kind"], string> = {
  home: "chat info",
  memory: "memory",
  record: "memory",
  links: "links",
  media: "media",
  files: "files",
  agent: "agent",
  model: "model",
}

function AgentCard(props: { slug: string; chatId: string }) {
  const member = () => roomMembers().find((m) => m.slug === props.slug)
  const status = () => useApp.room()?.state.status[props.slug as never] ?? "idle"
  return (
    <div class="flex flex-col gap-3" data-component="info-agent" data-slug={props.slug}>
      <div class="flex flex-col items-center gap-2 pt-2">
        <IdentityAvatar seed={props.slug} size={72} />
        <h2 class="text-lg font-medium text-text">{member()?.name ?? props.slug}</h2>
      </div>
      <Card id="agent-facts" title="details">
        <dl class="flex flex-col gap-1 px-2 py-1 text-sm">
          <div class="flex justify-between">
            <dt class="text-weak">role</dt>
            <dd data-field="role">{member()?.lead ? "lead" : "agent"}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-weak">model</dt>
            <dd class="truncate" data-field="model">
              {chatModel(props.chatId)?.split("/").slice(1).join("/") ?? "none"}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-weak">status</dt>
            <dd data-field="status">{status()}</dd>
          </div>
        </dl>
      </Card>
      {/* ASSUMPTION: rename and remove need the team frames of P6-08, so they wait. */}
      <div class="flex gap-2">
        <button type="button" class="h-8 rounded-lg bg-btn px-3 text-sm text-text disabled:opacity-40" disabled title="renaming agents arrives with teams">
          rename
        </button>
        <button type="button" class="h-8 rounded-lg bg-btn px-3 text-sm text-[oklch(var(--l-danger)_var(--c-danger)_var(--h-danger))] disabled:opacity-40" disabled title="removing agents arrives with teams">
          remove
        </button>
      </div>
    </div>
  )
}

function Home(props: { chatId: string; links: ReturnType<typeof createCatalog>; media: ReturnType<typeof createCatalog> }) {
  const members = roomMembers
  const memory = useMemoryStore()
  const name = () => chatOf(props.chatId)?.title ?? useApp.chatById(props.chatId)?.name ?? ""
  const extras = createMemo(() => infoSections().filter((s) => !s.when || s.when(props.chatId)))
  return (
    <div class="flex flex-col gap-3" data-component="info-home">
      <Header chatId={props.chatId} members={members()} />
      <Members members={members()} />
      <ModelCard chatId={props.chatId} />
      <Toggles chatId={props.chatId} />
      <Card id="memory" title="memory" hint="all memory" onOpen={() => pushInfo({ kind: "memory" })}>
        <Show when={memory()} fallback={<p class="px-2 py-1 text-sm text-weak">loading</p>}>
          {(store) => (
            <ChatMemory store={store()} chatName={name()} onOpen={(id) => pushInfo({ kind: "record", id })} />
          )}
        </Show>
      </Card>
      <LinksCard catalog={props.links} />
      <MediaCard catalog={props.media} />
      <FilesCard />
      <For each={extras()}>
        {(section) => (
          <Card id={section.id} title={section.title}>
            {section.render(props.chatId)}
          </Card>
        )}
      </For>
      <Danger chatId={props.chatId} />
    </div>
  )
}

function MemoryViews(props: { view: Extract<InfoView, { kind: "memory" | "record" }> }) {
  const store = useMemoryStore()
  return (
    <Show when={store()} fallback={<p class="p-2 text-sm text-weak">loading</p>}>
      {(s) => (
        <div class="flex flex-col gap-3" data-component="info-memory">
          <MemoryError store={s()} />
          <Switch>
            <Match when={props.view.kind === "record" && props.view}>
              {(view) => {
                const record = () => s().get((view() as { id: string }).id)
                return (
                  <Show
                    when={record()}
                    fallback={<p class="p-2 text-sm text-weak">{s().state.loaded ? "that record is gone" : "loading"}</p>}
                  >
                    {(r) => <RecordView record={r()} store={s()} onOpen={(id) => pushInfo({ kind: "record", id })} onGone={popInfo} />}
                  </Show>
                )
              }}
            </Match>
            <Match when={true}>
              <MemoryList store={s()} onOpen={(id) => pushInfo({ kind: "record", id })} />
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  )
}

function Back() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 3L5 8l5 5" />
    </svg>
  )
}

function Resizer() {
  let start: { x: number; width: number } | null = null
  const move = (event: PointerEvent) => {
    // The panel is on the right, so dragging left makes it wider.
    if (start) setInfoWidth(start.width + (start.x - event.clientX))
  }
  const stop = () => {
    start = null
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", stop)
  }
  onCleanup(stop)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="resize chat info"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={infoWidth()}
      data-component="info-resizer"
      class="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-[var(--tab-bg-hover)]"
      onPointerDown={(event) => {
        start = { x: event.clientX, width: infoWidth() }
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", stop)
        event.preventDefault()
      }}
    />
  )
}

export default function InfoPanel(props: { chatId: string }) {
  // Escape closes the panel. It is a command like every shortcut, and a dialog above the panel
  // (the media viewer, a picker) keeps its own Escape.
  useCommands([
    {
      id: "chat.info-close",
      title: "chat: close info",
      group: "chat",
      icon: "close",
      shortcut: "Escape",
      run: () => {
        if (!document.querySelector('[role="dialog"]')) closeInfo()
      },
    },
  ])
  const links = createCatalog("links")
  const media = createCatalog("media")
  let scroller!: HTMLDivElement
  const key = () => `${props.chatId}:${infoView().kind}`

  // A different chat opens on its home card, at the scroll it was left at. A chat never seen
  // keeps the scroll the reader already has.
  createEffect(on(() => props.chatId, () => resetInfo(), { defer: true }))
  createEffect(
    on(key, (k) => {
      const saved = scrolls.get(k)
      queueMicrotask(() => {
        if (saved !== undefined) scroller.scrollTop = saved
        else if (infoView().kind !== "home") scroller.scrollTop = 0
      })
    }),
  )

  const view = infoView
  return (
    <aside
      class="relative flex min-h-0 shrink-0 flex-col border-l border-[var(--border-weak,transparent)] bg-bg @max-[760px]/main:absolute @max-[760px]/main:inset-y-0 @max-[760px]/main:right-0 @max-[760px]/main:z-30 @max-[760px]/main:shadow-[-12px_0_32px_rgb(0_0_0/0.35)]"
      style={{ width: `min(${infoWidth()}px, 100%)` }}
      data-component="info-panel"
      aria-label="chat info"
    >
      <Resizer />
      <div class="flex h-[50px] shrink-0 items-center gap-1 px-2">
        <Show when={infoDepth() > 1}>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-lg text-muted hover:bg-[var(--tab-bg-hover)]"
            data-action="back"
            aria-label="back"
            onClick={() => popInfo()}
          >
            <Back />
          </button>
        </Show>
        <h2 class="min-w-0 flex-1 truncate px-1 text-sm font-medium text-muted" data-component="info-title">
          {TITLES[view().kind]}
        </h2>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-lg text-muted hover:bg-[var(--tab-bg-hover)]"
          data-action="close"
          aria-label="close chat info"
          onClick={() => closeInfo()}
        >
          <svg width="10" height="10" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
            <path d="M1 1l6 6M7 1L1 7" />
          </svg>
        </button>
      </div>
      <div
        ref={scroller}
        class="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
        data-component="info-scroll"
        onScroll={(event) => scrolls.set(key(), event.currentTarget.scrollTop)}
      >
        <Switch>
          <Match when={view().kind === "home"}>
            <Home chatId={props.chatId} links={links} media={media} />
          </Match>
          <Match when={view().kind === "memory" || view().kind === "record"}>
            <MemoryViews view={view() as never} />
          </Match>
          <Match when={view().kind === "links"}>
            <LinksList catalog={links} />
          </Match>
          <Match when={view().kind === "media"}>
            <MediaList catalog={media} />
          </Match>
          <Match when={view().kind === "files"}>
            <FilesList />
          </Match>
          <Match when={view().kind === "agent"}>
            <AgentCard slug={(view() as { slug: string }).slug} chatId={props.chatId} />
          </Match>
          <Match when={view().kind === "model"}>
            <div class="flex h-[min(560px,70dvh)] flex-col" data-component="info-model-list">
              <ModelList current={chatModel(props.chatId)} onPick={(ref) => (setChatModel(props.chatId, ref), popInfo())} />
            </div>
          </Match>
        </Switch>
      </div>
    </aside>
  )
}
