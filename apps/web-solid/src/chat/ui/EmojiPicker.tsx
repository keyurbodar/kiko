import { Cat, Flag, Hash, Lightbulb, type LucideIcon, Plane, Pizza, Search, Smile, Trophy, User, X } from "lucide-solid"
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { groupedEmojis, searchEmojis, type EmojiEntry } from "../lib/emojiData"
import "../interactions.css"

export interface EmojiPickerProps {
  onSelect: (entry: EmojiEntry) => void
  class?: string
}

/** Eight 36px cells fit the 320px surface without a fractional last column. */
const CELLS_PER_ROW = 8

/** One icon per group, keyed by emojibase's own group number. */
const GROUP_ICONS: Readonly<Record<number, LucideIcon>> = {
  0: Smile,
  1: User,
  3: Cat,
  4: Pizza,
  5: Plane,
  6: Trophy,
  7: Lightbulb,
  8: Hash,
  9: Flag,
}

function chunk(entries: readonly EmojiEntry[]): EmojiEntry[][] {
  const rows: EmojiEntry[][] = []
  for (let index = 0; index < entries.length; index += CELLS_PER_ROW) {
    rows.push(entries.slice(index, index + CELLS_PER_ROW))
  }
  return rows
}

interface CellProps {
  entry: EmojiEntry
  onHover: (entry: EmojiEntry) => void
  onSelect: (entry: EmojiEntry) => void
}

const Cell: Component<CellProps> = (props) => (
  <button
    type="button"
    class="chat-emoji-picker__cell"
    data-emoji={props.entry.emoji}
    aria-label={props.entry.label}
    onPointerEnter={() => props.onHover(props.entry)}
    onFocus={() => props.onHover(props.entry)}
    onClick={() => props.onSelect(props.entry)}
  >
    {props.entry.emoji}
  </button>
)

/**
 * The picker surface. With an empty query it is the grouped menu; with one it is
 * a flat run of matches. The footer always describes the cell under the
 * pointer, so a name is never a guess.
 */
export function EmojiPicker(props: EmojiPickerProps) {
  const [query, setQuery] = createSignal("")
  const [hovered, setHovered] = createSignal<EmojiEntry | undefined>()
  const [activeGroup, setActiveGroup] = createSignal<number | undefined>()
  const [viewport, setViewport] = createSignal<HTMLDivElement>()

  const groups = createMemo(() => groupedEmojis())
  const results = createMemo(() => searchEmojis(query()))
  const searching = createMemo(() => query().trim() !== "")
  const preview = createMemo(() => hovered() ?? results()[0] ?? groups()[0]?.emojis[0])

  const jumpToGroup = (group: number) => {
    setQuery("")
    const scroller = viewport()
    const target = scroller?.querySelector<HTMLElement>(`[data-group="${group}"]`)
    if (!scroller || !target) return
    scroller.scrollTop = target.offsetTop
    setActiveGroup(group)
  }

  /** The tab that is lit is the last group scrolled past, not the last clicked. */
  const trackGroup = () => {
    const scroller = viewport()
    if (!scroller) return
    let current: number | undefined
    for (const group of groups()) {
      const element = scroller.querySelector<HTMLElement>(`[data-group="${group.group}"]`)
      if (element && element.offsetTop - scroller.scrollTop <= 8) current = group.group
    }
    setActiveGroup(current)
  }

  return (
    <div
      class={`chat-emoji-picker ${props.class ?? ""}`}
      data-component="chat-emoji-picker"
      role="dialog"
      aria-label="emoji"
    >
      <div class="chat-emoji-picker__search">
        <Search size={13} class="chat-emoji-picker__search-icon" aria-hidden="true" />
        <input
          class="chat-emoji-picker__input"
          type="text"
          value={query()}
          placeholder="search emoji"
          aria-label="search emoji"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setHovered(undefined)
            const scroller = viewport()
            if (scroller) scroller.scrollTop = 0
          }}
        />
        <Show when={searching()}>
          <button
            type="button"
            class="chat-emoji-picker__clear"
            aria-label="clear search"
            onClick={() => {
              setQuery("")
              setHovered(undefined)
            }}
          >
            <X size={13} />
          </button>
        </Show>
      </div>

      {/*
        This row is a scroll-spy indicator, not a tab widget: every group is in
        the DOM at once and nothing is ever hidden, so `role="tablist"` with
        `role="tab"` and no tabpanel was claiming a widget that does not exist.
        A plain group of buttons with `aria-current` on the group the viewport
        is actually in says the same thing truthfully, and clicking one still
        scrolls the list to it.
      */}
      <div class="chat-emoji-picker__tabs" role="group" aria-label="emoji categories">
        <For each={groups()}>
          {(group) => {
            const Icon = GROUP_ICONS[group.group]
            const selected = () => !searching() && activeGroup() === group.group
            return (
              <button
                type="button"
                class="chat-emoji-picker__tab"
                classList={{ "chat-emoji-picker__tab--active": selected() }}
                aria-current={selected() ? "true" : undefined}
                aria-label={group.label}
                title={group.label}
                onClick={() => jumpToGroup(group.group)}
              >
                <Icon size={14} />
              </button>
            )
          }}
        </For>
      </div>

      <div class="chat-emoji-picker__viewport" ref={setViewport} onScroll={trackGroup}>
        <Show
          when={searching()}
          fallback={
            <For each={groups()}>
              {(group) => (
                <section class="chat-emoji-picker__group" data-group={group.group}>
                  <h3 class="chat-emoji-picker__group-label">{group.label}</h3>
                  <For each={chunk(group.emojis)}>
                    {(row) => (
                      <div class="chat-emoji-picker__row">
                        <For each={row}>
                          {(entry) => <Cell entry={entry} onHover={setHovered} onSelect={props.onSelect} />}
                        </For>
                      </div>
                    )}
                  </For>
                </section>
              )}
            </For>
          }
        >
          <Show when={results().length > 0} fallback={<p class="chat-emoji-picker__empty">no emoji matches that</p>}>
            <div class="chat-emoji-picker__rows">
              <For each={chunk(results())}>
                {(row) => (
                  <div class="chat-emoji-picker__row">
                    <For each={row}>
                      {(entry) => <Cell entry={entry} onHover={setHovered} onSelect={props.onSelect} />}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      <div class="chat-emoji-picker__preview" aria-hidden="true">
        <Show when={preview()}>
          {(entry) => (
            <>
              <span class="chat-emoji-picker__preview-emoji">{entry().emoji}</span>
              <span class="chat-emoji-picker__preview-text">
                <span class="chat-emoji-picker__preview-label">{entry().label}</span>
                <span class="chat-emoji-picker__preview-name">{entry().shortcodes[0] ?? entry().hexcode}</span>
              </span>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
