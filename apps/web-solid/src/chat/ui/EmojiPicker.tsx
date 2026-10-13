import { HugeIcon } from "@kiko/ui/huge-icon"
import { SearchIcon } from "@kiko/ui/icons"
import { createMemo, createResource, createSelector, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import {
  EMOJI_SECTIONS,
  gridMove,
  loadEmoji,
  recentEmoji,
  recordRecent,
  searchEmoji,
  type GridAt,
} from "../../lib/emoji-data"

/**
 * The emoji picker: a search pill, then recents and the emojibase groups as
 * grids of the platform's own glyphs. Arrow keys move through the grid from the
 * search field, Enter picks, and Escape is the caller's to close on.
 */
export interface EmojiPickerProps {
  /** Receives the emoji's own characters. The pick is already recorded as recent. */
  onSelect: (emoji: string) => void
  class?: string
}

const COLUMNS = 8
const CELL = 40
const HEADING = 32

interface Cell {
  readonly emoji: string
  readonly label: string
}

interface Section {
  readonly title: string
  readonly cells: readonly Cell[]
}

const key = (at: GridAt) => `${at.section}:${at.index}`

export function EmojiPicker(props: EmojiPickerProps): JSX.Element {
  const [data] = createResource(loadEmoji)
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal<GridAt | null>(null)
  const isActive = createSelector(() => {
    const at = active()
    return at === null ? "" : key(at)
  })
  // Recents and the first group paint at once. The rest mount one section a frame.
  const [mounted, setMounted] = createSignal(2)
  onMount(() => {
    let frame = 0
    const step = () => {
      setMounted((count) => count + 1)
      if (mounted() < EMOJI_SECTIONS.length + 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    onCleanup(() => cancelAnimationFrame(frame))
  })

  const labels = createMemo(() => new Map((data() ?? []).map((entry) => [entry.emoji, entry.annotation])))
  const sections = createMemo<readonly Section[]>(() => {
    const entries = data() ?? []
    const text = query().trim()
    if (text !== "") {
      return [
        {
          title: "Results",
          cells: searchEmoji(entries, text, Infinity).map((match) => ({ emoji: match.entry.emoji, label: match.entry.annotation })),
        },
      ]
    }
    return [
      { title: "Recently used", cells: recentEmoji().map((emoji) => ({ emoji, label: labels().get(emoji) ?? emoji })) },
      ...EMOJI_SECTIONS.map((section) => ({
        title: section.title,
        cells: entries
          .filter((entry) => section.groups.includes(entry.group))
          .map((entry) => ({ emoji: entry.emoji, label: entry.annotation })),
      })),
    ]
  })

  let scroller: HTMLDivElement | undefined
  const reveal = (at: GridAt) => {
    setMounted(Number.POSITIVE_INFINITY)
    queueMicrotask(() =>
      scroller?.querySelector(`[data-at="${key(at)}"]`)?.scrollIntoView({ block: "nearest" }),
    )
  }
  const pick = (emoji: string) => {
    recordRecent(emoji)
    props.onSelect(emoji)
  }
  const cellAt = (at: GridAt | null) => (at === null ? undefined : sections()[at.section]?.cells[at.index])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const at = active()
    if (event.key === "Enter") {
      const cell = cellAt(at) ?? (query().trim() ? cellAt({ section: 0, index: 0 }) : undefined)
      if (!cell) return
      event.preventDefault()
      pick(cell.emoji)
      return
    }
    const arrow = event.key === "ArrowDown" || event.key === "ArrowUp"
    // Left and right edit the search text until the grid has a cell lit.
    const sideways = (event.key === "ArrowLeft" || event.key === "ArrowRight") && at !== null
    if (!arrow && !sideways) return
    event.preventDefault()
    const sizes = sections().map((section) => section.cells.length)
    const first = sizes.findIndex((size) => size > 0)
    if (first < 0) return
    const next = at === null ? { section: first, index: 0 } : gridMove(sizes, at, event.key, COLUMNS)
    setActive(next)
    reveal(next)
  }

  const onPointerMove = (event: PointerEvent) => {
    const at = (event.target as HTMLElement).closest<HTMLElement>("[data-at]")?.dataset.at
    if (at === undefined) return
    const [section, index] = at.split(":").map(Number)
    if (active()?.section !== section || active()?.index !== index) setActive({ section: section!, index: index! })
  }

  return (
    <div
      class={cn(
        "flex h-[400px] w-[340px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[20px] bg-menu text-text shadow-popover",
        props.class,
      )}
      data-component="emoji-picker"
    >
      <div class="px-2.5 pt-2.5 pb-1">
        <label class="flex h-10 items-center gap-2 rounded-full bg-[var(--input-bg)] px-3 focus-within:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_22%,transparent)]">
          <HugeIcon icon={SearchIcon} size={16} class="shrink-0 text-weak" />
          <input
            ref={(element) => queueMicrotask(() => element.focus({ preventScroll: true }))}
            class="min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-weak"
            placeholder="Search"
            aria-label="Search emoji"
            autocomplete="off"
            spellcheck={false}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value)
              setActive(event.currentTarget.value.trim() ? { section: 0, index: 0 } : null)
              scroller?.scrollTo({ top: 0 })
            }}
            onKeyDown={onKeyDown}
            data-component="emoji-search"
          />
        </label>
      </div>
      <div
        ref={scroller}
        class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onClick={(event) => {
          const at = (event.target as HTMLElement).closest<HTMLElement>("[data-emoji]")?.dataset.emoji
          if (at) pick(at)
        }}
      >
        <Show
          when={sections().some((section) => section.cells.length > 0) || (query().trim() === "" && data.loading)}
          fallback={
            <p class="py-10 text-center text-sm text-weak" data-component="emoji-empty">
              No emoji found
            </p>
          }
        >
          <For each={sections()}>
            {(section, index) => (
              <Show when={index() < mounted() && section.cells.length > 0}>
                <section
                  style={{
                    "content-visibility": "auto",
                    "contain-intrinsic-size": `auto ${HEADING + Math.ceil(section.cells.length / COLUMNS) * CELL}px`,
                  }}
                  data-component="emoji-section"
                >
                  <h3 class="flex h-8 items-center px-1.5 text-[15px] font-semibold text-text">{section.title}</h3>
                  <div class="grid grid-cols-8" role="listbox" aria-label={section.title}>
                    <For each={section.cells}>
                      {(cell, at) => (
                        <button
                          type="button"
                          tabIndex={-1}
                          role="option"
                          class="grid size-10 cursor-default place-items-center rounded-[10px] p-0 font-emoji text-[28px] leading-none data-[active]:bg-[var(--selected-bg)]"
                          data-at={`${index()}:${at()}`}
                          data-emoji={cell.emoji}
                          data-active={isActive(`${index()}:${at()}`) ? "" : undefined}
                          aria-selected={isActive(`${index()}:${at()}`)}
                          aria-label={cell.label}
                        >
                          {cell.emoji}
                        </button>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
