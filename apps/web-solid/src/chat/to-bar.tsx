import type { Agent, RoomId } from "@yuki/protocol"
import { createEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js"
import { closeChat } from "../sidebar/actions"
import { agentList, BUILTIN_AGENT, groupTitle } from "../lib/chats"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { addOp } from "./members/model"
import { pickerMatches, toChips } from "./to-bar-model"
import { pickFor, setPickFor } from "./to-bar-state"

/*
 * The "to:" row of a temporary chat, just above its composer until the first message is sent (architecture section 7.11). A chip for each
 * agent in it, then a round (+) that opens a search of the user's agents. Picking one adds it to
 * the room; with two agents the chat becomes a group and joins the list. In an empty chat the
 * human can take yuki off first, and then picking one agent opens that agent's own chat instead.
 *
 *   arrows   move through the results
 *   enter    pick
 *   escape   close the search
 */
export function ToBar(props: { roomId: RoomId }) {
  const navigate = useNavigate()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [at, setAt] = createSignal(0)
  /** yuki taken off an empty chat. Only this bar knows; the room keeps yuki until something is sent. */
  const [yukiOff, setYukiOff] = createSignal(false)
  createEffect(
    on(
      () => props.roomId,
      (id) => {
        setYukiOff(false)
        // "new group" asked for the search to be open on arrival.
        setOpen(pickFor() === id)
        if (pickFor() === id) setPickFor(null)
      },
    ),
  )

  const empty = () => useApp.activeMessages().length === 0
  createEffect(() => {
    if (!empty()) setYukiOff(false)
  })
  const agents = createMemo(() => agentList(useApp.agents()))
  const chips = createMemo(() =>
    toChips({ members: useApp.roomMembers(), chatAgents: useApp.chat(props.roomId)?.agents ?? [], agents: agents(), yukiOff: yukiOff(), empty: empty() }),
  )
  const results = createMemo(() => pickerMatches(agents(), chips().map((c) => c.slug), query()))
  createEffect(on(results, () => setAt(0)))

  const idOf = (slug: string) => agents().find((a) => a.slug === slug)?.id ?? slug

  function pick(agent: Agent) {
    setOpen(false)
    setQuery("")
    const others = chips()
    // yuki is off and nobody else is here: this is a direct chat, and the agent has only one.
    if (yukiOff() && others.length === 0) {
      if (agent.id === BUILTIN_AGENT.id) return void setYukiOff(false)
      const dm = useApp.openDm(agent)
      if (!dm) return
      closeChat(props.roomId, useApp.activeThreadId(), () => {})
      navigate(`/chat/${dm}`)
      return
    }
    if (agent.id === BUILTIN_AGENT.id && yukiOff()) return void setYukiOff(false)
    useApp.memberOp(addOp(agent))
    const next = [...others.map((c) => ({ id: idOf(c.slug), name: c.name })), { id: agent.id, name: agent.name }]
    if (next.length > 1) useApp.keepChat(props.roomId, groupTitle(next.map((a) => a.name)), next.map((a) => a.id))
  }

  function remove(slug: string) {
    if (slug === BUILTIN_AGENT.slug) setYukiOff(true)
    else useApp.memberOp({ op: "remove", slug: slug as never })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setAt((i) => Math.max(0, Math.min(results().length - 1, i + (event.key === "ArrowDown" ? 1 : -1))))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const agent = results()[at()]
      if (agent) pick(agent)
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  let root: HTMLDivElement | undefined
  createEventListener(document, "pointerdown", (event) => {
    if (open() && root && !root.contains(event.target as Node)) setOpen(false)
  })

  return (
    <div class="relative flex h-9 items-center gap-2 px-1 text-sm" data-component="to-bar" ref={(el) => (root = el)}>
      <span class="text-weak">To:</span>
      <For each={chips()}>
        {(chip) => (
          <span class="flex h-7 items-center gap-1.5 rounded-full bg-btn py-0 pr-1 pl-1 text-text" data-component="to-chip" data-slug={chip.slug}>
            <IdentityAvatar seed={chip.slug} size={20} />
            <span class="max-w-[160px] truncate">{chip.name}</span>
            <Show when={chip.removable} fallback={<span class="w-1" />}>
              <button
                type="button"
                class="grid size-5 place-items-center rounded-full text-weak hover:bg-[oklch(from_var(--accent)_l_c_h_/_12%)] hover:text-text"
                aria-label={`Remove ${chip.name}`}
                data-action="to-remove"
                onClick={() => remove(chip.slug)}
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
                  <path d="M1 1l6 6M7 1L1 7" />
                </svg>
              </button>
            </Show>
          </span>
        )}
      </For>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-full bg-btn text-text hover:bg-[oklch(from_var(--accent)_l_c_h_/_12%)]"
        aria-label="Add someone"
        aria-expanded={open()}
        data-action="to-add"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M6 1.5v9M1.5 6h9" />
        </svg>
      </button>
      <Show when={chips().length === 0}>
        <span class="text-weak">Add someone to message</span>
      </Show>
      <Show when={open()}>
        <div
          class="absolute bottom-full left-0 z-30 mb-1 flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-1 rounded-[calc(20px*var(--brm))] bg-menu p-3 shadow-menu"
          data-component="to-picker"
        >
          <label class="flex h-10 items-center gap-2 rounded-full bg-[var(--input-bg)] px-3 focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_22%,transparent)]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" class="shrink-0 text-weak" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              ref={(el) => queueMicrotask(() => el.focus())}
              class="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-weak"
              placeholder="Name, @username"
              aria-label="Search your agents"
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              data-component="to-search"
            />
          </label>
          <ul class="flex max-h-[320px] flex-col overflow-y-auto" role="listbox" aria-label="Agents">
            <For each={results()}>
              {(agent, i) => (
                <li
                  role="option"
                  aria-selected={at() === i()}
                  class="flex cursor-default items-center gap-3 rounded-xl px-2 py-1.5 data-[active]:bg-[oklch(from_var(--accent)_l_c_h_/_12%)]"
                  data-active={at() === i() ? "" : undefined}
                  data-component="to-result"
                  data-slug={agent.slug}
                  onMouseMove={() => setAt(i())}
                  onClick={() => pick(agent)}
                >
                  <IdentityAvatar seed={agent.slug} size={36} />
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate font-medium text-text">{agent.name}</span>
                    <span class="truncate text-xs text-weak">@{agent.slug}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
          <p class="px-2 py-3 text-center text-xs text-weak" data-component="to-hint">
            {query().trim() && results().length === 0 ? "No one by that name" : "Search by name or @username"}
          </p>
        </div>
      </Show>
    </div>
  )
}
