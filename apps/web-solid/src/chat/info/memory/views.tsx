import type { LifeLine } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  ArrowUpIcon,
  ChevronDownIcon,
  MemoryIcon,
  MessageIcon,
  PinFillIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
  UnpinIcon,
  UserIcon,
} from "@kiko/ui/icons"
import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { ModelPicker } from "../../../settings/model-picker"
import { session } from "../../../app/session"
import { IdentityAvatar } from "../../../lib/IdentityAvatar"
import { agentDisplayName } from "../../../lib/names"
import { room } from "../../../state/room"
import { memoryFor } from "./instance"
import { ago, matching, mergeResults, ordered, originOf, replacedMark } from "./lines"
import type { MemoryStore } from "./store"

const quiet = "rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
const action = "grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-control hover:text-foreground"

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
              <RemixIcon icon={MessageIcon} size={13} class="shrink-0" />
              <span class="truncate">{title()}</span>
            </>
          )}
        </Match>
        <Match when={true}>
          <RemixIcon icon={UserIcon} size={13} class="shrink-0" />
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
      class="group/row rounded-lg px-2.5 py-2 hover:bg-accent focus-within:bg-accent"
      data-component="memory-line"
      data-pos={l().pos}
      data-pinned={l().pinned ? "" : undefined}
    >
      <button
        type="button"
        class={`block w-full text-left text-md leading-snug ${open() ? "" : "line-clamp-3"} ${replacedMark(l()) ? "text-muted-foreground line-through" : "text-foreground"}`}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {sentence(l().text)}
      </button>
      <div class="mt-1 flex h-6 items-center gap-1.5 text-xs text-muted-foreground">
        <Show when={l().pinned}>
          <RemixIcon icon={PinFillIcon} size={12} class="shrink-0" aria-label="Pinned" aria-hidden={false} />
        </Show>
        <Origin line={l()} />
        <Show when={replacedMark(l())}>{(mark) => <span class="rounded bg-control px-1 text-xs">{mark()}</span>}</Show>
        <span class="ml-auto shrink-0 tabular-nums text-secondary-label group-hover/row:hidden group-focus-within/row:hidden">
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
              <Show when={l().pinned} fallback={<RemixIcon icon={PinIcon} size={13} />}>
                <RemixIcon icon={UnpinIcon} size={13} />
              </Show>
            </button>
            <button
              type="button"
              class={sure() ? "h-6 rounded-md px-1.5 text-xs text-error hover:bg-error-surface" : action}
              data-action="redact"
              aria-label={sure() ? "Remove for good" : "Remove"}
              title="Remove"
              onClick={() => (sure() ? props.store.redact(l().pos) : setSure(true))}
              onBlur={() => setSure(false)}
            >
              <Show when={sure()} fallback={<RemixIcon icon={TrashIcon} size={13} />}>
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
        <h3 class="flex items-center gap-1.5 px-2.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
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
      <Show when={id()} fallback={<span class="py-0.5 text-sm leading-snug text-muted-foreground">{props.text}</span>}>
        <button
          type="button"
          class="py-0.5 text-left text-sm leading-snug text-muted-foreground hover:text-foreground"
          data-component="memory-summary"
          onClick={() => void props.store.zoom(id()!)}
        >
          {props.text}
        </button>
        <Show when={opened()}>
          <div class="ml-3 border-l border-border pl-2">
            <For each={opened()}>{(t) => <ViewLine text={t} store={props.store} />}</For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function MemoryModelRow(props: { store: MemoryStore }) {
  const [open, setOpen] = createSignal(false)
  const current = () => {
    const m = props.store.state.model
    return m ? `${m.provider}/${m.modelId}` : undefined
  }
  return (
    <div class="flex h-8 items-center gap-2" data-component="memory-model">
      <span class="flex-1 text-sm text-muted-foreground">Summaries written by</span>
      <ModelPicker
        current={current()}
        open={open()}
        onOpenChange={setOpen}
        onPick={(ref) => {
          const at = ref.indexOf("/")
          void props.store.setModel({ provider: ref.slice(0, at), modelId: ref.slice(at + 1) })
        }}
        class="max-w-44 truncate rounded-md px-1.5 py-0.5 text-sm text-foreground hover:bg-accent"
      >
        {current()?.split("/").slice(1).join("/") ?? "Kiko's model"}
      </ModelPicker>
      <Show when={current()}>
        <button type="button" class={quiet} onClick={() => void props.store.setModel(null)}>
          Reset
        </button>
      </Show>
    </div>
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
  return (
    <nav class="flex min-h-0 flex-1 flex-col" aria-label="Memory" data-component="memory-list">
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-none px-2.5 pb-3">
        <label class="sticky top-0 z-10 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-secondary px-2.5 text-muted-foreground focus-within:text-foreground">
          <RemixIcon icon={SearchIcon} size={14} />
          <input
            type="search"
            class="h-full min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-muted-foreground"
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
        <Section title="Pinned" icon lines={sections().pinned} store={props.store} />
        <Section title={searching() ? "Results" : "Remembered"} lines={sections().recent} store={props.store} />
        <Show when={!searching() && s().next !== null}>
          <button type="button" class={`${quiet} self-center`} onClick={() => void props.store.more()}>
            Show older
          </button>
        </Show>
        <Show when={empty() && searching()}>
          <p class="px-1 py-6 text-center text-sm text-muted-foreground">Nothing matches "{query().trim()}"</p>
        </Show>
        <Show when={empty() && !searching()}>
          <div class="flex flex-col items-center gap-1 px-4 py-10 text-center" data-component="memory-empty">
            <RemixIcon icon={MemoryIcon} size={20} class="mb-1 text-muted-foreground" />
            <p class="text-md text-foreground">Nothing remembered yet</p>
            <p class="text-sm text-muted-foreground">
              Talk to Kiko about people, places, and how you like things done. It keeps the lasting parts here.
            </p>
          </div>
        </Show>
      </div>
      <div class="flex shrink-0 flex-col gap-2 border-t border-border px-2.5 py-2.5">
        <section class="flex flex-col rounded-lg bg-secondary px-2.5 py-1" data-component="memory-view">
          <Show when={s().view.length}>
            <button
              type="button"
              class="flex h-8 items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
              aria-expanded={reading()}
              onClick={() => setReading(!reading())}
            >
              <span class="flex-1">What every agent reads</span>
              <span class="tabular-nums">
                {s().view.length} {s().view.length === 1 ? "line" : "lines"}
              </span>
              <RemixIcon icon={ChevronDownIcon} size={13} class={reading() ? "rotate-180" : ""} />
            </button>
            <Show when={reading()}>
              <div class="flex max-h-48 flex-col overflow-y-auto pb-1">
                <For each={s().view}>{(t) => <ViewLine text={t} store={props.store} />}</For>
              </div>
            </Show>
          </Show>
          <MemoryModelRow store={props.store} />
        </section>
        <form
          class="flex h-10 items-center gap-2 rounded-full border border-border bg-secondary pr-1 pl-4"
          data-component="memory-note"
          onSubmit={(e) => {
            e.preventDefault()
            const input = e.currentTarget.elements.namedItem("note") as HTMLInputElement
            if (!input.value.trim()) return
            void props.store.note(input.value)
            input.value = ""
          }}
        >
          <input
            name="note"
            class="min-w-0 flex-1 bg-transparent text-md text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Tell Kiko something to remember"
            aria-label="Add a memory"
            maxLength={280}
          />
          <button
            type="submit"
            class="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
            aria-label="Remember"
          >
            <RemixIcon icon={ArrowUpIcon} size={15} />
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
        class="mx-2.5 rounded-md bg-error-surface px-3 py-2 text-sm text-error"
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
