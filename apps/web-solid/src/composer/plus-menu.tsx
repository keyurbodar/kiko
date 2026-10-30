import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { type Glyph, RemixIcon } from "@kiko/ui/remix-icon"
import {
  AtIcon,
  CheckIcon,
  ChevronRightIcon,
  FolderIcon,
  GridIcon,
  PlusIcon,
  SkillsIcon,
  UploadIcon,
} from "@kiko/ui/icons"
import type { Token } from "./tokens"
import "./plus-menu.css"
import { TokenGlyph } from "./prompt-input/chip"

export type PlusPools = {
  files: (query: string) => readonly Token[]
  apps: () => readonly Token[]
  skills: () => readonly Token[]
  recipes: () => readonly Token[]
  agents: () => readonly Token[]
}

export type PlusMenuProps = {
  pools: PlusPools
  onInsert: (token: Token) => void
  onAddFiles: () => void
  onAddSomeone: () => void
  onManageSkills: () => void
  onConnectApp: () => void
  disabled?: boolean
}

type SubKind = "files" | "skills" | "apps" | "mention"

type Row =
  | { kind: "action"; id: string; label: string; hint?: string; icon: Glyph; run: () => void }
  | { kind: "sub"; id: string; label: string; icon: Glyph; sub: SubKind }
  | { kind: "rule"; id: string }

const HOVER_MS = 80
const LIST_LIMIT = 8
const PANEL_WIDTH = 244
const SUB_WIDTH = 264
const MOBILE_MAX = 480

const SUB_LABEL: Record<SubKind, string> = {
  files: "Kiko files",
  skills: "Skills",
  apps: "Apps",
  mention: "Mention someone",
}

const SUB_FOOTER: Record<SubKind, string | undefined> = {
  files: undefined,
  skills: "Manage skills",
  apps: "Connect an app",
  mention: undefined,
}

function matches(token: Token, query: string): boolean {
  if (!query) return true
  return token.title.toLowerCase().includes(query.toLowerCase())
}

function subTokens(kind: SubKind, pools: PlusPools, query: string): readonly Token[] {
  if (kind === "files") return pools.files(query)
  if (kind === "skills") return [...pools.skills(), ...pools.recipes()].filter((token) => matches(token, query))
  if (kind === "apps") return pools.apps().filter((token) => matches(token, query))
  return pools.agents().filter((token) => matches(token, query))
}

function MenuRow(props: {
  row: Row
  active: boolean
  open: SubKind | null
  onHover: () => void
  onLeave: () => void
  onRun: () => void
}) {
  const row = props.row
  if (row.kind === "rule") return <div class="composer-plus-rule" role="separator" />
  return (
    <button
      type="button"
      role="menuitem"
      class="composer-plus-row"
      aria-haspopup={row.kind === "sub" ? "menu" : undefined}
      aria-expanded={row.kind === "sub" && props.open === row.sub ? "true" : undefined}
      data-active={props.active ? "" : undefined}
      onPointerEnter={props.onHover}
      onPointerLeave={props.onLeave}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onRun}
    >
      <span class="composer-plus-glyph">
        <RemixIcon icon={row.icon} size={18} />
      </span>
      <span class="composer-plus-label">{row.label}</span>
      <Show when={row.kind === "action" ? row.hint : undefined}>
        {(hint) => <span class="composer-plus-hint">{hint()}</span>}
      </Show>
      <Show when={row.kind === "sub"}>
        <RemixIcon icon={ChevronRightIcon} size={16} class="composer-plus-more" />
      </Show>
    </button>
  )
}

function SubPanel(props: {
  kind: SubKind
  pools: PlusPools
  onPick: (token: Token) => void
  onBack: () => void
  onAddSomeone: () => void
  footer?: () => void
}) {
  const [query, setQuery] = createSignal("")
  const [index, setIndex] = createSignal(0)
  createEffect(on(query, () => setIndex(0)))
  const tokens = createMemo(() => subTokens(props.kind, props.pools, query()))
  const shown = () => tokens().slice(0, LIST_LIMIT)
  const move = (direction: number) => {
    const count = shown().length
    if (count > 0) setIndex((at) => (at + direction + count) % count)
  }
  const pick = (token: Token | undefined) => token && props.onPick(token)
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault()
      event.stopPropagation()
      props.onBack()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      event.stopPropagation()
      move(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      move(-1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      pick(shown()[index()])
    }
  }
  return (
    <div class="composer-plus-sub" role="menu" aria-label={SUB_LABEL[props.kind]}>
      <label class="composer-plus-search">
        <input
          ref={(element) => queueMicrotask(() => element.focus())}
          value={query()}
          aria-label={`Search ${SUB_LABEL[props.kind].toLowerCase()}`}
          placeholder={`Search ${SUB_LABEL[props.kind].toLowerCase()}`}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={key}
        />
      </label>
      <div class="composer-plus-list" data-kind={props.kind}>
        <Show
          when={shown().length > 0}
          fallback={<div class="composer-plus-empty">{query() ? "Nothing matches" : "Nothing here yet"}</div>}
        >
          <For each={shown()}>
            {(token, at) => (
              <button
                type="button"
                role="menuitem"
                class="composer-plus-row"
                data-kind={token.kind}
                data-active={at() === index() ? "" : undefined}
                onPointerDown={(event) => event.preventDefault()}
                onPointerEnter={() => setIndex(at())}
                onClick={() => pick(token)}
              >
                <span class="composer-plus-glyph">
                  <TokenGlyph token={token} size={18} />
                </span>
                <span class="composer-plus-label">{token.title}</span>
                <Show when={props.kind === "apps"}>
                  <RemixIcon icon={CheckIcon} size={16} class="composer-plus-check" />
                </Show>
                <Show when={token.hint}>
                  <span class="composer-plus-hint">{token.hint}</span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
      <Show when={props.kind === "mention"}>
        <button
          type="button"
          role="menuitem"
          class="composer-plus-row composer-plus-add"
          onPointerDown={(event) => event.preventDefault()}
          onClick={props.onAddSomeone}
        >
          <span class="composer-plus-glyph">
            <RemixIcon icon={PlusIcon} size={18} />
          </span>
          <span class="composer-plus-label">Add someone to this chat</span>
        </button>
      </Show>
      <Show when={SUB_FOOTER[props.kind]}>
        {(label) => (
          <button type="button" class="composer-plus-foot" onClick={() => props.footer?.()}>
            {label()}
          </button>
        )}
      </Show>
    </div>
  )
}

export function PlusMenu(props: PlusMenuProps) {
  const [open, setOpen] = createSignal(false)
  const [sub, setSub] = createSignal<SubKind | null>(null)
  const [active, setActive] = createSignal(0)
  const [anchor, setAnchor] = createSignal({ left: 8, bottom: 8 })
  const [flip, setFlip] = createSignal(false)
  let root: HTMLDivElement | undefined
  let trigger: HTMLButtonElement | undefined
  let hoverTimer: ReturnType<typeof setTimeout> | undefined

  const place = () => {
    const box = trigger?.closest<HTMLElement>(".composer-box")
    const rect = (box ?? trigger)?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ left: rect.left + 8, bottom: window.innerHeight - rect.top + 8 })
    setFlip(window.innerWidth > MOBILE_MAX && rect.left + 8 + PANEL_WIDTH + 6 + SUB_WIDTH + 8 > window.innerWidth)
  }

  const rows = createMemo((): Row[] => [
    { kind: "action", id: "upload", label: "Upload or add files", hint: "⌘U", icon: UploadIcon, run: props.onAddFiles },
    { kind: "sub", id: "kiko-files", label: "Kiko files", icon: FolderIcon, sub: "files" },
    { kind: "sub", id: "skills", label: "Skills", icon: SkillsIcon, sub: "skills" },
    { kind: "sub", id: "apps", label: "Apps", icon: GridIcon, sub: "apps" },
    { kind: "rule", id: "rule" },
    { kind: "sub", id: "mention", label: "Mention someone", icon: AtIcon, sub: "mention" },
  ])
  const selectable = createMemo(() =>
    rows().filter((row): row is Exclude<Row, { kind: "rule" }> => row.kind !== "rule"),
  )

  const close = (restoreFocus: boolean) => {
    clearTimeout(hoverTimer)
    setOpen(false)
    setSub(null)
    if (restoreFocus) trigger?.focus()
  }
  const run = (row: Row) => {
    if (row.kind === "action") {
      close(true)
      row.run()
    } else if (row.kind === "sub") {
      clearTimeout(hoverTimer)
      setSub(row.sub)
    }
  }
  const hover = (row: Row) => {
    clearTimeout(hoverTimer)
    if (row.kind === "rule") return
    setActive(selectable().indexOf(row))
    if (row.kind === "sub") hoverTimer = setTimeout(() => setSub(row.sub), HOVER_MS)
  }
  const back = () => {
    setSub(null)
    requestAnimationFrame(() => root?.focus())
  }
  const key = (event: KeyboardEvent) => {
    if (sub()) {
      if (event.key !== "Escape" && event.key !== "ArrowLeft") return
      event.preventDefault()
      back()
      return
    }
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const count = selectable().length
      if (count === 0) return
      setActive((at) => (at + (event.key === "ArrowDown" ? 1 : -1) + count) % count)
      return
    }
    if (event.key === "ArrowRight" || event.key === "Enter") {
      event.preventDefault()
      const row = selectable()[active()]
      if (row) run(row)
    }
  }
  const footer = () => {
    if (sub() === "skills") return props.onManageSkills
    if (sub() === "apps") return props.onConnectApp
    return undefined
  }

  createEffect(() => {
    if (!open()) return
    requestAnimationFrame(() => root?.focus())
    place()
    const box = trigger?.closest(".composer-box")
    const observer = box ? new ResizeObserver(place) : undefined
    if (box && observer) observer.observe(box)
    window.addEventListener("resize", place)
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (root?.contains(target) || trigger?.contains(target)) return
      close(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      close(true)
    }
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape)
    onCleanup(() => {
      observer?.disconnect()
      window.removeEventListener("resize", place)
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("keydown", escape)
    })
  })
  onCleanup(() => clearTimeout(hoverTimer))

  return (
    <span class="composer-plus">
      <button
        ref={trigger}
        type="button"
        class="composer-icon composer-plus-trigger"
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open()}
        data-component="composer-plus-button"
        data-hint="chat.attach"
        disabled={props.disabled}
        onClick={() => {
          if (open()) return close(false)
          place()
          setOpen(true)
        }}
      >
        <RemixIcon icon={PlusIcon} size={18} />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class="composer-plus-panel"
            ref={root}
            role="menu"
            aria-label="Add"
            tabIndex={-1}
            onKeyDown={key}
            data-sub={sub() ?? undefined}
            data-flip={flip() ? "" : undefined}
            style={{ "--plus-left": `${anchor().left}px`, "--plus-bottom": `${anchor().bottom}px` }}
          >
            <For each={rows()}>
              {(row) => (
                <MenuRow
                  row={row}
                  active={selectable()[active()]?.id === row.id}
                  open={sub()}
                  onHover={() => hover(row)}
                  onLeave={() => clearTimeout(hoverTimer)}
                  onRun={() => run(row)}
                />
              )}
            </For>
            <Show when={sub()}>
              {(kind) => (
                <SubPanel
                  kind={kind()}
                  pools={props.pools}
                  onPick={(token) => (close(true), props.onInsert(token))}
                  onBack={back}
                  onAddSomeone={() => (close(true), props.onAddSomeone())}
                  footer={footer()}
                />
              )}
            </Show>
          </div>
        </Portal>
      </Show>
    </span>
  )
}
