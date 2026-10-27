import type { LifeLine } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  ArrowUpIcon,
  ChevronDownIcon,
  MemoryIcon,
  MessageIcon,
  MoreIcon,
  PinFillIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
  UnpinIcon,
  UserIcon,
} from "@kiko/ui/icons"
import { createMemo, createResource, createSignal, For, lazy, Match, Show, Suspense, Switch } from "solid-js"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { session } from "../../../app/session"
import { IdentityAvatar } from "../../../lib/IdentityAvatar"
import { agentDisplayName } from "../../../lib/names"
import { room } from "../../../state/room"
import { leadName, PanelEmpty } from "../empty"
import { memoryFor } from "./instance"
import { ago, matching, mergeResults, ordered, originOf, replacedMark } from "./lines"
import type { MemoryStore } from "./store"

const quiet = "rounded-control px-1.5 py-0.5 text-hint text-fg3 hover:bg-hover hover:text-fg"
const action = "grid size-6 place-items-center rounded-control text-fg3 hover:bg-active hover:text-fg"

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function Origin(props: { line: LifeLine }) {
  const origin = () => originOf(props.line)
  const agent = () => {
    const o = origin()
    return o.kind === "agent" ? o.slug : undefined
  }
  const chat = () => {
    const o = origin()
    return o.kind === "chat" ? o.title : undefined
  }
  return (
    <span class="flex min-w-0 items-center gap-1.5" data-component="memory-origin">
      <Switch>
        <Match when={agent()}>
          {(slug) => (
            <>
              <IdentityAvatar seed={slug()} size={14} />
              <span class="truncate">{room.memberById(slug())?.name ?? agentDisplayName(slug(), [])}</span>
            </>
          )}
        </Match>
        <Match when={chat()}>
          {(title) => (
            <>
              <RemixIcon icon={MessageIcon} size={12} class="shrink-0" />
              <span class="truncate">{title()}</span>
            </>
          )}
        </Match>
        <Match when={true}>
          <RemixIcon icon={UserIcon} size={12} class="shrink-0" />
          <span>You</span>
        </Match>
      </Switch>
    </span>
  )
}

function Line(props: { line: LifeLine; store: MemoryStore }) {
  const l = () => props.line
  const [open, setOpen] = createSignal(false)
  const [sure, setSure] = createSignal(false)
  return (
    <li
      class="group/row rounded-row px-2.5 py-2 transition-colors duration-[120ms] hover:bg-hover focus-within:bg-hover"
      data-component="memory-line"
      data-pos={l().pos}
      data-pinned={l().pinned ? "" : undefined}
    >
      <button
        type="button"
        class={`block w-full text-left text-ui leading-snug ${open() ? "" : "line-clamp-3"} ${replacedMark(l()) ? "text-fg3 line-through" : "text-fg"}`}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {sentence(l().text)}
      </button>
      <div class="mt-1 flex h-6 items-center gap-1.5 text-hint text-fg3">
        <Show when={l().pinned}>
          <RemixIcon icon={PinFillIcon} size={12} class="shrink-0" aria-label="Pinned" aria-hidden={false} />
        </Show>
        <Origin line={l()} />
        <Show when={replacedMark(l())}>{(mark) => <span class="rounded bg-active px-1 text-hint">{mark()}</span>}</Show>
        <span class="ml-auto shrink-0 tabular-nums text-fg4 group-hover/row:hidden group-focus-within/row:hidden">
          {ago(l().at)}
        </span>
        <Show when={l().pos >= 0}>
          <span class="ml-auto hidden items-center gap-0.5 group-hover/row:flex group-focus-within/row:flex">
            <button
              type="button"
              class={action}
              data-action="pin"
              aria-label={l().pinned ? "Unpin" : "Pin"}
              title={l().pinned ? "Unpin" : "Pin"}
              onClick={() => props.store.pin(l().pos, !l().pinned)}
            >
              <Show when={l().pinned} fallback={<RemixIcon icon={PinIcon} size={12} />}>
                <RemixIcon icon={UnpinIcon} size={12} />
              </Show>
            </button>
            <button
              type="button"
              class={sure() ? "h-6 rounded-control px-1.5 text-hint text-bad hover:bg-bad-wash" : action}
              data-action="redact"
              aria-label={sure() ? "Remove for good" : "Remove"}
              title="Remove"
              onClick={() => (sure() ? props.store.redact(l().pos) : setSure(true))}
              onBlur={() => setSure(false)}
            >
              <Show when={sure()} fallback={<RemixIcon icon={TrashIcon} size={12} />}>
                Remove for good
              </Show>
            </button>
          </span>
        </Show>
      </div>
    </li>
  )
}

function Section(props: { title: string; icon?: boolean; lines: LifeLine[]; store: MemoryStore }) {
  return (
    <Show when={props.lines.length}>
      <section class="flex flex-col gap-0.5" data-group={props.title}>
        <h3 class="flex items-center gap-1.5 px-2.5 pt-1 pb-0.5 type-label text-fg3">
          <Show when={props.icon}>
            <RemixIcon icon={PinIcon} size={12} />
          </Show>
          {props.title}
        </h3>
        <ul class="flex flex-col">
          <For each={props.lines}>{(l) => <Line line={l} store={props.store} />}</For>
        </ul>
      </section>
    </Show>
  )
}

function ViewLine(props: { text: string; store: MemoryStore }) {
  const id = () => /^#(\d+-\d+) /.exec(props.text)?.[1]
  const opened = () => (id() ? props.store.state.opened[id()!] : undefined)
  return (
    <div class="flex flex-col">
      <Show when={id()} fallback={<span class="py-0.5 text-label leading-snug text-fg3">{props.text}</span>}>
        <button
          type="button"
          class="py-0.5 text-left text-label leading-snug text-fg3 hover:text-fg"
          data-component="memory-summary"
          onClick={() => void props.store.zoom(id()!)}
        >
          {props.text}
        </button>
        <Show when={opened()}>
          <div class="ml-3 border-l-[1.5px] border-line pl-2">
            <For each={opened()}>{(t) => <ViewLine text={t} store={props.store} />}</For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

const ModelPickerPanel = lazy(() => import("../../../settings/model-picker-panel"))

function MemoryMore(props: { store: MemoryStore }) {
  const [picking, setPicking] = createSignal(false)
  let trigger: HTMLButtonElement | undefined
  const current = () => {
    const m = props.store.state.model
    return m ? `${m.provider}/${m.modelId}` : undefined
  }
  return (
    <>
      <MenuV2 gutter={6} placement="bottom-end">
        <MenuV2.Trigger
          ref={trigger}
          class="grid size-8 shrink-0 place-items-center rounded-control text-fg2 hover:bg-hover hover:text-fg aria-expanded:bg-hover"
          aria-label="More memory options"
          data-component="memory-more"
        >
          <RemixIcon icon={MoreIcon} size={16} />
        </MenuV2.Trigger>
        <MenuV2.Portal>
          <MenuV2.Content class="min-w-56" data-component="memory-more-menu">
            <MenuV2.Item data-action="memory-model" onSelect={() => setPicking(true)}>
              <span class="flex min-w-0 flex-1 flex-col">
                <span>Memory model…</span>
                <span class="truncate type-hint text-fg4">
                  {current()?.split("/").slice(1).join("/") ?? `${leadName()}'s model`}
                </span>
              </span>
            </MenuV2.Item>
            <Show when={current()}>
              <MenuV2.Item onSelect={() => void props.store.setModel(null)}>{`Use ${leadName()}'s model`}</MenuV2.Item>
            </Show>
          </MenuV2.Content>
        </MenuV2.Portal>
      </MenuV2>
      <Show when={picking()}>
        <Suspense>
          <ModelPickerPanel
            current={current()}
            onPick={(ref) => {
              const at = ref.indexOf("/")
              void props.store.setModel({ provider: ref.slice(0, at), modelId: ref.slice(at + 1) })
            }}
            onOpenChange={setPicking}
            trigger={() => trigger}
          />
        </Suspense>
      </Show>
    </>
  )
}

export function MemoryList(props: { store: MemoryStore }) {
  const [query, setQuery] = createSignal("")
  const [reading, setReading] = createSignal(false)
  const s = () => props.store.state
  const searching = () => query().trim() !== ""
  const sections = createMemo(() => {
    if (!searching()) return ordered(s().lines)
    return { pinned: [], recent: mergeResults(matching(s().lines, query()), s().results) }
  })
  const search = (value: string) => {
    setQuery(value)
    void props.store.search(value)
  }
  const empty = () => s().loaded && !sections().pinned.length && !sections().recent.length
  const [draft, setDraft] = createSignal("")
  return (
    <nav class="flex min-h-0 flex-1 flex-col" aria-label="Memory" data-component="memory-list">
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-none px-2.5 pb-3">
        <div class="sticky top-0 z-10 flex shrink-0 items-center gap-1 bg-bg">
          <label class="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-row bg-hover px-2.5 text-fg3 focus-within:text-fg">
            <RemixIcon icon={SearchIcon} size={16} />
            <input
              type="search"
              class="h-full min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg3"
              placeholder="Search memory"
              aria-label="Search memory"
              value={query()}
              onInput={(e) => search(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query()) {
                  e.stopPropagation()
                  search("")
                }
              }}
            />
          </label>
          <MemoryMore store={props.store} />
        </div>
        <Section title="Pinned" icon lines={sections().pinned} store={props.store} />
        <Section title={searching() ? "Results" : "Remembered"} lines={sections().recent} store={props.store} />
        <Show when={!searching() && s().next !== null}>
          <button type="button" class={`${quiet} self-center`} onClick={() => void props.store.more()}>
            Show older
          </button>
        </Show>
        <Show when={empty() && searching()}>
          <p class="px-1 py-6 text-center text-label text-fg3">Nothing matches "{query().trim()}"</p>
        </Show>
        <Show when={empty() && !searching()}>
          <PanelEmpty
            component="memory-empty"
            icon={MemoryIcon}
            title="Nothing remembered yet"
            line={`Talk to ${leadName()} about people, places, and how you like things done. The lasting parts stay here.`}
          />
        </Show>
      </div>
      <div class="flex shrink-0 flex-col gap-2 px-2.5 py-2.5">
        <Show when={s().view.length}>
          <section class="flex flex-col rounded-pop bg-panel px-3 py-1" data-component="memory-view">
            <button
              type="button"
              class="flex h-8 items-center gap-2 text-left text-label text-fg3 hover:text-fg"
              aria-expanded={reading()}
              onClick={() => setReading(!reading())}
            >
              <span class="flex-1">What every agent reads</span>
              <span class="tabular-nums">
                {s().view.length} {s().view.length === 1 ? "line" : "lines"}
              </span>
              <RemixIcon icon={ChevronDownIcon} size={12} class={reading() ? "rotate-180" : ""} />
            </button>
            <Show when={reading()}>
              <div class="flex max-h-48 flex-col overflow-y-auto pb-1">
                <For each={s().view}>{(t) => <ViewLine text={t} store={props.store} />}</For>
              </div>
            </Show>
          </section>
        </Show>
        <form
          class="flex h-10 items-center gap-2 rounded-full bg-raise pr-1 pl-4"
          data-component="memory-note"
          onSubmit={(e) => {
            e.preventDefault()
            const input = e.currentTarget.elements.namedItem("note") as HTMLInputElement
            if (!input.value.trim()) return
            void props.store.note(input.value)
            input.value = ""
            setDraft("")
          }}
        >
          <input
            name="note"
            class="min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-fg3"
            placeholder={`Tell ${leadName()} something to remember`}
            aria-label="Add a memory"
            maxLength={280}
            onInput={(e) => setDraft(e.currentTarget.value)}
          />
          <button
            type="submit"
            class={`grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,color,transform] duration-(--dur-hover) ease-kiko active:scale-[0.97] ${draft().trim() ? "bg-fg text-bg" : "bg-active text-fg4"}`}
            aria-label="Remember"
          >
            <RemixIcon icon={ArrowUpIcon} size={16} />
          </button>
        </form>
      </div>
    </nav>
  )
}

export function MemoryError(props: { store: MemoryStore }) {
  return (
    <Show when={props.store.state.error}>
      <p
        class="mx-2.5 rounded-control bg-bad-wash px-3 py-2 text-label text-bad"
        role="alert"
        data-component="memory-error"
      >
        {props.store.state.error}{" "}
        <button type="button" class="underline" onClick={() => props.store.dismissError()}>
          Dismiss
        </button>
      </p>
    </Show>
  )
}

export function useMemoryStore() {
  const [store] = createResource(
    () => {
      const s = session()
      return s.status === "signed-in" ? s.user.id : null
    },
    async (userId) => {
      const s = await memoryFor(userId)
      if (!s.state.loaded) void s.load()
      return s
    },
  )
  return store
}
