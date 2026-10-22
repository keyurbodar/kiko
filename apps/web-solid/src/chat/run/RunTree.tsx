import type { RunStep } from "@kiko/protocol"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show, untrack, type JSX } from "solid-js"
import { unwrap } from "solid-js/store"
import { cn } from "../../lib/cn"
import { useApp } from "../../lib/store"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { findFile } from "../ui/find-file"
import { GLYPH } from "./glyphs"
import { type DetailStatus, isLive, type RowDetail, type TreeRow, treeOf } from "./run-tree-rows"
import "./run-tree.css"

const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
const [asked, setAsked] = createSignal<ReadonlySet<string>>(new Set())

const MAX_OPENED = 100

const PILL =
  "cursor-pointer rounded-full border border-border/70 bg-background px-2.5 py-1 text-foreground hover:bg-accent"

function withKey(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  next.add(key)
  if (next.size > MAX_OPENED) next.delete(next.values().next().value as string)
  return next
}

function setOpen(key: string, value: boolean) {
  setOpened((current) => {
    const next = new Set(current)
    next.delete(key)
    return value ? withKey(next, key) : next
  })
}

function keysUnder(keys: ReadonlySet<string>, prefix: string): Set<string> {
  const out = new Set<string>()
  for (const key of keys) if (key.startsWith(prefix)) out.add(key.slice(prefix.length))
  return out
}

type Fold = "gone" | "open" | "grow" | "shut"

const foldMs = (element: HTMLElement) => Math.max(0, ...getComputedStyle(element).transitionDuration.split(",").map((s) => Number.parseFloat(s) * 1000 || 0))

function foldOf(isOpen: boolean, moves: boolean, list: HTMLDivElement | undefined): { fold: Fold; ms: number } {
  if (isOpen) return { fold: moves ? "grow" : "open", ms: 0 }
  const ms = moves && list ? foldMs(list) : 0
  return { fold: ms === 0 ? "gone" : "shut", ms }
}

function Label(props: { text: string; running: boolean }) {
  let element!: HTMLSpanElement
  const running = createMemo(() => props.running)
  createEffect(() => {
    if (!running()) return
    let off: (() => void) | undefined
    let stopped = false
    void import("./visible-animation").then(({ observeVisibleAnimation }) => {
      if (!stopped) off = observeVisibleAnimation(element)
    })
    onCleanup(() => {
      stopped = true
      off?.()
    })
  })
  return (
    <span ref={element} class={running() ? "run-tree-label motion-shine" : "run-tree-label"}>
      {props.text}
    </span>
  )
}

function Retry(props: { onRetry: () => void }) {
  return (
    <button type="button" class={PILL} onClick={() => props.onRetry()}>
      Retry
    </button>
  )
}

function DetailEmpty(props: { detail: RowDetail; onRetry: () => void }) {
  const text = () => (props.detail.running ? "Running…" : props.detail.status === "ready" ? "No output." : "Loading output…")
  return (
    <Show when={props.detail.status === "error"} fallback={<p class="run-tree-note">{text()}</p>}>
      <p class="run-tree-note">
        Output unavailable · <Retry onRetry={props.onRetry} />
      </p>
    </Show>
  )
}

function Detail(props: { detail: RowDetail; child: boolean; onRetry: () => void }) {
  const detail = () => props.detail
  return (
    <div class={cn("run-tree-detail", props.child && "ml-3")}>
      <Show when={detail().lines}>{(lines) => <For each={lines()}>{(line) => <p class="run-tree-note">{line}</p>}</For>}</Show>
      <Show when={!detail().lines}>
        <Show when={detail().input || detail().output} fallback={<DetailEmpty detail={detail()} onRetry={props.onRetry} />}>
          <div class="run-tree-block">
            <Show when={detail().input}>{(input) => <pre class="run-tree-mono run-tree-input">{input()}</pre>}</Show>
            <Show when={detail().output}>
              {(output) => (
                <pre class="run-tree-mono run-tree-output" data-failed={detail().failed ? "" : undefined}>
                  {output()}
                </pre>
              )}
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function StatusRow(props: { row: TreeRow; onRetry: () => void }) {
  return (
    <div class="run-tree-row" data-kind={props.row.kind}>
      <Label text={props.row.label} running={props.row.kind === "loading"} />
      <Show when={props.row.kind === "error"}>
        <Retry onRetry={props.onRetry} />
      </Show>
    </div>
  )
}

function Row(props: { row: TreeRow; open: boolean; onOpen: (row: TreeRow) => void; onRetry: () => void }) {
  const detail = () => props.row.detail
  const expandable = () => props.row.expand !== undefined || detail() !== undefined
  return (
    <Show when={props.row.kind !== "loading" && props.row.kind !== "error"} fallback={<StatusRow row={props.row} onRetry={props.onRetry} />}>
      <button
        type="button"
        class={cn("run-tree-row", props.row.child && "ml-3")}
        data-kind={props.row.kind}
        data-file={props.row.target ? "" : undefined}
        aria-expanded={expandable() ? props.open : undefined}
        title={props.row.target && !props.row.target.folder ? `Open ${props.row.target.path}` : undefined}
        onClick={() => props.onOpen(props.row)}
      >
        <Label text={props.row.label} running={props.row.running} />
        <Show when={props.row.icon}>
          {(glyph) => <RemixIcon icon={GLYPH[glyph()]} size={12} class="run-tree-icon" data-failed={glyph() === "alert-circle" ? "" : undefined} />}
        </Show>
      </button>
      <Show when={props.open && detail()}>{(shown) => <Detail detail={shown()} child={props.row.child} onRetry={props.onRetry} />}</Show>
    </Show>
  )
}

export function RunTree(props: { windowKey: string; count?: number }): JSX.Element {
  const steps = createMemo(() => unwrap(useApp.runSteps(props.windowKey)) as readonly RunStep[])
  const working = () => useApp.runLive(props.windowKey)
  const live = createMemo(() => isLive(steps(), working()))
  const openKey = () => `${useApp.activeThreadId() ?? ""}|${props.windowKey}`
  const workerKey = (id: string) => `${openKey()}|${id}`
  const open = createMemo(() => opened().has(openKey()))
  const workers = createMemo(() => keysUnder(opened(), `${openKey()}|`))

  const detailStatus = createMemo<DetailStatus>(() => {
    if (steps().length >= (props.count ?? 0)) return "ready"
    if (useApp.runFetching(props.windowKey)) return "loading"
    return asked().has(openKey()) ? "error" : "idle"
  })

  const request = (force = false) => {
    const key = openKey()
    setAsked((current) => (current.has(key) ? current : withKey(current, key)))
    useApp.loadRunSteps(props.windowKey, force)
  }

  const tree = createMemo(() => treeOf(steps(), { working: working(), open: open(), count: props.count, detail: detailStatus(), workers: workers() }))

  createEffect(() => {
    if (open() && !live()) untrack(request)
  })

  const [fold, setFold] = createSignal<Fold>(untrack(open) ? "open" : "gone")
  let clicked = false
  let list: HTMLDivElement | undefined
  createEffect(
    on(
      open,
      (isOpen) => {
        const moves = clicked
        clicked = false
        const next = foldOf(isOpen, moves, list)
        setFold(next.fold)
        if (next.fold !== "shut") return
        const timer = setTimeout(() => setFold("gone"), next.ms)
        onCleanup(() => clearTimeout(timer))
      },
      { defer: true },
    ),
  )

  const toggle = () => {
    clicked = true
    setOpen(openKey(), !open())
    clicked = false
  }

  const [shownRows, setShownRows] = createSignal<ReadonlySet<string>>(new Set())
  const toggleDetail = (row: TreeRow) => {
    setShownRows((current) => {
      const next = new Set(current)
      if (!next.delete(row.id)) next.add(row.id)
      return next
    })
    request()
  }
  const openRow = (row: TreeRow) => {
    const chat = useApp.activeThreadId()
    const target = row.target
    if (chat && target) {
      const found = target.folder ? null : findFile(target.path)
      if (found?.kind === "file") return openFile(chat, found.path)
      if (target.folder || found?.kind === "many") return openSurface(chat, fixedSurface("files"))
    }
    if (row.expand !== undefined) return setOpen(workerKey(row.expand), !opened().has(workerKey(row.expand)))
    toggleDetail(row)
  }
  const isRowOpen = (row: TreeRow) => (row.expand === undefined ? shownRows().has(row.id) : opened().has(workerKey(row.expand)))

  return (
    <div class="run-tree" data-component="run-tree">
      <Show when={tree().head}>
        {(head) => (
          <button type="button" class="run-tree-row" data-kind={head().kind} aria-expanded={head().open} onClick={toggle}>
            <span class="run-tree-label">{head().label}</span>
            <Show when={head().failed}>
              <RemixIcon icon={GLYPH["alert-circle"]} size={12} class="run-tree-icon" data-failed="" />
            </Show>
            <span class="run-tree-chevron motion-run-chevron" data-open={head().open ? "" : undefined} aria-hidden="true">
              <RemixIcon icon={ChevronRightIcon} size={12} />
            </span>
          </button>
        )}
      </Show>
      <Show when={fold() !== "gone"}>
        <div ref={list} class="run-tree-fold motion-run-fold" data-grow={fold() === "grow" ? "" : undefined} data-shut={fold() === "shut" ? "" : undefined}>
          <div>
            <Index each={tree().folded}>{(row) => <Row row={row()} open={isRowOpen(row())} onOpen={openRow} onRetry={() => request(true)} />}</Index>
          </div>
        </div>
      </Show>
      <Index each={tree().shown}>{(row) => <Row row={row()} open={isRowOpen(row())} onOpen={openRow} onRetry={() => request(true)} />}</Index>
    </div>
  )
}
