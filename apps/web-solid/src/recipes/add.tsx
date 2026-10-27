import type { RecipeCard } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChevronRightIcon, SearchIcon } from "@kiko/ui/icons"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar, IdentityAvatar } from "../lib/IdentityAvatar"
import { room } from "../state/room"
import { RecipeIcon } from "./icon"
import { addOwnChat, addToTarget, isAdded, isOwning, isWaiting, type RecipeTarget, targetsForChat } from "./state"

type Option =
  | { kind: "chat"; key: string; roomId: string; name: string; targets: RecipeTarget[] }
  | { kind: "member"; key: string; target: RecipeTarget }
  | { kind: "own"; key: "own" }

export function AddPicker(props: { card: RecipeCard; roomId?: string | null; navigate: (roomId: string) => void }) {
  const [query, setQuery] = createSignal("")
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [picked, setPicked] = createSignal<string | null>(null)

  const added = (o: Option) =>
    o.kind === "member"
      ? isAdded(props.card.slug, o.target)
      : o.kind === "chat"
        ? o.targets.length > 0 && o.targets.every((t) => isAdded(props.card.slug, t))
        : false

  const options = createMemo<Option[]>(() => {
    const q = query().trim().toLowerCase()
    const here = props.roomId ?? undefined
    const chats = room
      .bots()
      .filter((b) => !q || b.name.toLowerCase().includes(q))
      .sort((a, b) => (a.id === here ? -1 : b.id === here ? 1 : 0))
    const out: Option[] = []
    for (const chat of chats) {
      const targets = targetsForChat(chat.id)
      out.push({ kind: "chat", key: chat.id, roomId: chat.id, name: chat.name, targets })
      if (targets.length > 1 && expanded() === chat.id)
        for (const target of targets) out.push({ kind: "member", key: `${chat.id}:${target.agent}`, target })
    }
    out.push({ kind: "own", key: "own" })
    return out
  })

  const cursor = () => {
    const i = options().findIndex((o) => o.key === picked())
    return i === -1
      ? Math.max(
          0,
          options().findIndex((o) => !added(o)),
        )
      : i
  }
  const setCursor = (i: number) => setPicked(options()[i]?.key ?? null)

  const choose = (o: Option) => {
    if (added(o)) return
    if (o.kind === "own") return addOwnChat(props.card, props.navigate)
    if (o.kind === "member") return addToTarget(props.card, o.target, props.navigate)
    if (o.targets.length === 1) return addToTarget(props.card, o.targets[0], props.navigate)
    setExpanded((open) => (open === o.roomId ? null : o.roomId))
  }

  const move = (step: number) => {
    const list = options()
    for (let i = 1; i <= list.length; i++) {
      const next = (cursor() + step * i + list.length) % list.length
      if (!added(list[next]!)) return setCursor(next)
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      move(e.key === "ArrowDown" ? 1 : -1)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const o = options()[cursor()]
      if (o) choose(o)
    }
  }

  return (
    <div class="flex flex-col gap-1.5" data-component="recipe-picker">
      <label class="mb-1 flex h-9 items-center gap-2 rounded-full bg-panel px-3.5 text-fg3">
        <RemixIcon icon={SearchIcon} size={16} />
        <input
          class="min-w-0 flex-1 bg-transparent text-label text-fg outline-none placeholder:text-fg3"
          placeholder={`Add ${props.card.title} to…`}
          aria-label={`Choose a chat for ${props.card.title}`}
          value={query()}
          autofocus
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setPicked(null)
          }}
          onKeyDown={onKey}
        />
      </label>
      <Show when={isWaiting(props.card.slug)}>
        <p class="px-2 text-hint text-fg3">Checking your apps…</p>
      </Show>
      <div class="flex max-h-[min(360px,50dvh)] flex-col gap-0.5 overflow-y-auto" role="listbox" aria-label="Chats">
        <For each={options()}>
          {(o, i) => (
            <>
              <Show when={o.kind === "own" && i() > 0}>
                <div class="mx-2 my-1.5 h-px bg-line" />
              </Show>
              <button
                type="button"
                role="option"
                aria-selected={cursor() === i()}
                disabled={added(o)}
                class={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-pop px-2 py-1.5 text-left disabled:cursor-default",
                  o.kind === "member" && "pl-11",
                  cursor() === i() && !added(o) && "bg-panel",
                )}
                data-option={o.key}
                onMouseEnter={() => !added(o) && setCursor(i())}
                onClick={() => choose(o)}
              >
                <Switch>
                  <Match when={o.kind === "chat" && o}>
                    {(c) => (
                      <>
                        <ChatAvatar faces={room.chatFaces(c().roomId)} size={30} />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-label font-medium text-fg">{c().name}</span>
                          <Show when={c().targets.length > 1}>
                            <span class="block truncate text-hint text-fg3">
                              {expanded() === c().roomId ? "Choose who" : `${c().targets.length} agents`}
                            </span>
                          </Show>
                        </span>
                      </>
                    )}
                  </Match>
                  <Match when={o.kind === "member" && o}>
                    {(m) => (
                      <>
                        <IdentityAvatar seed={m().target.agent} size={26} />
                        <span class="min-w-0 flex-1 truncate text-label text-fg">{m().target.name}</span>
                      </>
                    )}
                  </Match>
                  <Match when={o.kind === "own"}>
                    <RecipeIcon recipe={props.card} size={30} />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-label font-medium text-fg">
                        New chat with {props.card.agent.name}
                      </span>
                      <span class="block truncate text-hint text-fg3">
                        {isOwning(props.card.slug) ? "Making the chat…" : "An agent just for this"}
                      </span>
                    </span>
                  </Match>
                </Switch>
                <span class="shrink-0 text-hint text-fg3">
                  <Show when={!added(o)} fallback="Added">
                    <Show when={o.kind === "chat" && o.targets.length > 1}>
                      <RemixIcon
                        icon={ChevronRightIcon}
                        size={16}
                        class={expanded() === (o as { roomId?: string }).roomId ? "rotate-90" : ""}
                      />
                    </Show>
                    <Show when={cursor() === i() && !(o.kind === "chat" && o.targets.length > 1)}>
                      <kbd class="rounded-control border border-line px-1.5 py-px font-sans text-hint">↵</kbd>
                    </Show>
                  </Show>
                </span>
              </button>
            </>
          )}
        </For>
      </div>
    </div>
  )
}
