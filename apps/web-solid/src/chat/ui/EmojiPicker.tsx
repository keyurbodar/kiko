import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { Emoji, twemojiSources } from "../../lib/emoji"

/**
 * The emoji picker, as `<emoji-picker>`.
 *
 * `emoji-picker-element` is a web component, so this file is only a themed
 * wrapper plus a footer. The search, the categories, the skin-tone picker and
 * the lazy grid are the package's, and none of them is ours to maintain.
 *
 * Three things are ours, and each replaced something that did not work.
 *
 * The DATA is self-hosted from `public/` rather than the package's default
 * jsdelivr URL, so the picker works offline and a failing network cannot leave
 * a reader with an empty grid.
 *
 * The package is imported dynamically, so opening a message menu costs nothing
 * until someone actually asks for the picker.
 *
 * The theme goes on the ELEMENT, not on a wrapper: the element's own `:host`
 * rules declare the same custom properties, and a value declared on an element
 * always beats one merely inherited from its parent. Theming a wrapper does
 * nothing at all, which is why the first attempt came out in the library's own
 * green-grey.
 */
export interface EmojiPickerProps {
  /** Receives the emoji's own characters, ready to drop into a message. */
  onSelect: (emoji: string) => void
  class?: string
}

/** Importing the package registers the element; the promise is shared. */
let registered: Promise<void> | undefined
function ensureRegistered(): Promise<void> {
  registered ??= import("emoji-picker-element").then(() => undefined)
  return registered
}

/**
 * Warm the picker before anyone asks for it.
 *
 * The element is ~100kB of JavaScript plus a 430kB emoji database, and both were
 * being fetched at the moment the reader pressed `+`, so the panel opened onto
 * an empty box and filled in a beat later. Kat's appears at once. Starting the
 * module import and the data fetch when the message menu opens gives the network
 * the whole time the reader spends deciding to react, and both are cached, so
 * this costs nothing when the picker is never used.
 */
let warmed: Promise<unknown> | undefined
export function preloadEmojiPicker(): void {
  warmed ??= Promise.all([
    ensureRegistered(),
    fetch("/emoji-picker-data.json").catch(() => undefined),
  ])
}

/**
 * The kat palette in the element's own vocabulary, read from the `:host`
 * defaults it ships. A plain string rather than an object, because custom
 * properties are not in `CSSProperties` and an object would need a cast.
 */
const THEME = [
  "font-family:var(--font-family-sans)",
  "font-size:var(--font-sm)",
  "--emoji-font-family:var(--font-family-sans)",
  "--emoji-size:1.25rem",
  "--emoji-padding:0.375rem",
  "--num-columns:8",
  // No borders in this system, so the sizes are zero rather than matching
  // hairlines.
  "--border-size:0px",
  "--border-radius:calc(16px * var(--brm))",
  "--input-border-size:0px",
  "--input-border-radius:calc(10px * var(--brm))",
  "--skintone-border-radius:calc(8px * var(--brm))",
  "--background:var(--menu-bg)",
  "--border-color:transparent",
  "--indicator-color:var(--accent)",
  "--outline-color:var(--accent)",
  "--outline-size:2px",
  "--input-border-color:transparent",
  "--input-font-color:var(--text)",
  "--input-placeholder-color:var(--text-faint)",
  "--category-font-color:var(--text-muted)",
  "--category-font-size:var(--font-sm)",
  "--button-hover-background:var(--hover-bg)",
  "--button-active-background:var(--hover-bg)",
  // The element is 400px tall by default and the panel is anchored to a row.
  "height:360px",
].join(";")

/** What the footer shows: the glyph, the annotation, and its shortcode. */
type HoveredCell = {
  readonly emoji: string
  readonly label: string
  readonly shortcode: string
}

/**
 * The element labels every cell as `😀, grinning face, grinning,
 * grinning_face` - glyph, annotation, then its emojibase shortcodes. That is
 * already exactly what the footer needs, and it comes from the package's own
 * emojibase build, so the app keeps no emoji database of its own.
 */
function readCell(cell: Element): HoveredCell | undefined {
  const label = cell.getAttribute("aria-label")
  if (label === null) return undefined
  const [emoji, name, ...shortcodes] = label.split(",").map((part) => part.trim())
  if (name === undefined || emoji === undefined || name === "" || name === emoji) {
    return undefined
  }
  return {
    emoji,
    label: name,
    shortcode: shortcodes[0] ?? name.toLowerCase().replace(/ /g, "_"),
  }
}

/**
 * The element draws every cell as TEXT, so the grid would show the platform's
 * emoji while the chips and quick-reaction row in the same menu show Twemoji -
 * two different sets side by side. There is no renderer hook to override, so
 * the shadow root is rewritten instead: each cell's emoji becomes the same
 * `<img>` our `Emoji` renders.
 *
 * The grid is lazy, so this follows it rather than running once. Batched to a
 * frame, because the element inserts a whole category at a time and one walk
 * per batch is far cheaper than one per node.
 */
function drawTwemoji(root: ParentNode): void {
  const cells = root.querySelectorAll<HTMLElement>("button[id^='emo-']")
  for (const cell of cells) {
    if (cell.dataset.twemoji === "done") continue
    const emoji = cell.textContent?.trim() ?? ""
    const sources = twemojiSources(emoji)
    if (sources.length === 0) continue
    cell.dataset.twemoji = "done"
    cell.textContent = ""
    const image = document.createElement("img")
    image.src = sources[0]
    image.alt = ""
    image.setAttribute("aria-hidden", "true")
    image.loading = "lazy"
    image.decoding = "async"
    image.draggable = false
    image.style.width = "var(--emoji-size, 1.25rem)"
    image.style.height = "var(--emoji-size, 1.25rem)"
    // The element's own click handler tests `event.target` for its `emoji`
    // class and reads the id off that same node, so an <img> inside the cell
    // becomes the target and every click is discarded before it begins. Making
    // the artwork transparent to the pointer puts the target back on the
    // button. The handler reads the id rather than the text, which is why
    // emptying the cell costs nothing.
    image.style.pointerEvents = "none"
    // Twemoji's asset set disagrees with its own naming rule in a few places, so
    // a miss walks to the next spelling. Only when every spelling is gone is the
    // character drawn instead: a missing file is a missing glyph, and the
    // platform's own glyph beats a broken-image box.
    image.addEventListener("error", () => {
      const attempt = Number(image.dataset.attempt ?? "0") + 1
      const next = sources[attempt]
      if (next !== undefined) {
        image.dataset.attempt = String(attempt)
        image.src = next
        return
      }
      image.replaceWith(document.createTextNode(cell.getAttribute("aria-label") ?? ""))
    })
    cell.append(image)
  }
}

export function EmojiPicker(props: EmojiPickerProps): JSX.Element {
  const [ready, setReady] = createSignal(false)
  const [picker, setPicker] = createSignal<HTMLElement>()
  const [hovered, setHovered] = createSignal<HoveredCell | undefined>()

  onMount(() => {
    void ensureRegistered().then(() => setReady(true))
  })

  createEffect(() => {
    const target = picker()
    if (!ready() || target === undefined) return

    // A real DOM listener rather than a JSX handler: the event is dispatched
    // inside the element's own shadow root, and `on:emoji-click` in JSX reads
    // as a namespaced event instead of this one.
    const onPick = (event: Event) => {
      const unicode = (event as CustomEvent<{ unicode?: string }>).detail?.unicode
      if (unicode) props.onSelect(unicode)
    }
    target.addEventListener("emoji-click", onPick)
    onCleanup(() => target.removeEventListener("emoji-click", onPick))

    // Hover is delegated from the shadow root rather than bound per cell: the
    // grid renders lazily and its cells come and go, so a per-cell listener
    // would be attached to nodes that no longer exist.
    const root = target.shadowRoot
    if (root === null) return
    const cellOf = (event: Event) =>
      (event.target as Element | null)?.closest?.("button[id]") ?? null
    const onOver = (event: Event) => {
      const cell = cellOf(event)
      setHovered(cell === null ? undefined : readCell(cell))
    }
    const onOut = (event: Event) => {
      if (cellOf(event) !== null) setHovered(undefined)
    }
    root.addEventListener("mouseover", onOver)
    root.addEventListener("mouseout", onOut)
    // The footer opens on the first emoji rather than on nothing. kat's picker
    // shows a populated preview the instant it appears, and an empty bar that
    // only fills once the pointer happens to cross a cell reads as unfinished.
    // Seeded rather than "hovered": a real hover still takes over, and this only
    // speaks while nothing has been hovered.
    const seed = () => {
      if (hovered() !== undefined) return
      const first = root.querySelector<HTMLElement>("button[id^='emo-']")
      if (first !== null) setHovered(readCell(first))
    }
    // The grid fills in as the reader scrolls, so the substitution has to
    // follow it. Batched to a frame: the element inserts a whole category at
    // once, and one walk per batch is far cheaper than one per node.
    let queued = false
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        drawTwemoji(root)
        seed()
      })
    })
    observer.observe(root, { childList: true, subtree: true })
    drawTwemoji(root)
    seed()
    onCleanup(() => observer.disconnect())
    onCleanup(() => {
      root.removeEventListener("mouseover", onOver)
      root.removeEventListener("mouseout", onOut)
    })
  })

  return (
    <div class={cn("flex flex-col bg-menu", props.class)}>
      <Show when={ready()}>
        <emoji-picker
          ref={setPicker}
          data-source="/emoji-picker-data.json"
          style={THEME}
        />
      </Show>
      {/* The footer is ours because the element has no slot for one. It states
          the same two facts kat does: the annotation, and the shortcode that
          names it. */}
      <div
        class="flex min-h-[52px] items-center gap-2.5 px-3 shadow-[inset_0_1px_0_0_oklch(from_var(--text)_l_c_h_/_6%)]"
        aria-live="polite"
      >
        <Show when={hovered()}>
          {(cell) => (
            <>
              {/* Artwork, like the grid above it. The platform glyph here would
                  put the two sets side by side in the same panel. */}
              <Emoji emoji={cell().emoji} class="size-6 shrink-0" eager />
              <span class="flex min-w-0 flex-col gap-px">
                <span class="truncate text-md font-medium lowercase">{cell().label}</span>
                <span class="truncate text-xs text-weak">:{cell().shortcode}:</span>
              </span>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
