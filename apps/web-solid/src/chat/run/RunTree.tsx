import type { RunStep } from "@kiko/protocol"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createMemo, createSignal, Index, on, onCleanup, Show, untrack, type JSX } from "solid-js"
import { unwrap } from "solid-js/store"
import { useApp } from "../../lib/store"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { findFile } from "../ui/find-file"
import { GLYPH } from "./glyphs"
import { preloadRunPanel, registerRunAnchor, toggleRun } from "./run-panel-state"
import { isLive, type TreeRow, treeOf } from "./run-tree-rows"
import "./run-tree.css"

/*
 * What an agent did for a bubble, drawn in the thread as a small muted tree hung under it: under
 * the bubble that opens the steps, or under the typing bubble while the agent still makes them. A
 * live tree shows its newest rows and the running one shines; a finished one is a single sentence
 * the reader can open. A row that wrote or read a file opens that file beside the chat; any other
 * row opens the run panel, which hangs beside the tree. Which rows to draw is `run-tree-rows.ts`;
 * this file only draws them.
 */

/**
 * The trees the reader opened, by room, window, and whether the window was live. A tree that leaves
 * the virtual window comes back as it was left, and a tree opened while the agent worked starts
 * closed once the work is done. A session cache, like the long message fold.
 */
const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())

/** The reader opens a few trees, not hundreds. Past this the earliest opened closes again. */
const MAX_OPENED = 100

function setOpen(key: string, value: boolean) {
  const next = new Set(opened())
  next.delete(key)
  if (value) next.add(key)
  if (next.size > MAX_OPENED) next.delete(next.values().next().value as string)
  setOpened(next)
}

/** The folded rows: not in the page, open, growing open from nothing, or shutting. */
type Fold = "gone" | "open" | "grow" | "shut"

/** How long the fold takes to grow or shut, from its CSS. Zero under reduced motion. */
const foldMs = (element: HTMLElement) => Math.max(0, ...getComputedStyle(element).transitionDuration.split(",").map((s) => Number.parseFloat(s) * 1000 || 0))

/**
 * A label that shines while its step runs, and only while it is on screen. The shine's code and look
 * load with the first label that runs: a finished transcript never needs them.
 */
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

/** A step, a worker, or a note. A click opens the file it touched, else the run panel, whose chunk loads on hover. The wait for the rest only shines. */
function Row(props: { row: TreeRow; onOpen: (row: TreeRow, element: HTMLElement) => void }) {
  const icon = () => props.row.icon
  return (
    <Show
      when={props.row.kind !== "loading"}
      fallback={
        <div class="run-tree-row" data-kind="loading">
          <Label text={props.row.label} running />
        </div>
      }
    >
      <button
        type="button"
        class="run-tree-row"
        data-kind={props.row.kind}
        data-file={props.row.target ? "" : undefined}
        aria-haspopup={props.row.target ? undefined : "dialog"}
        title={props.row.target && !props.row.target.folder ? `Open ${props.row.target.path}` : undefined}
        onPointerEnter={preloadRunPanel}
        onFocus={preloadRunPanel}
        onClick={(event) => props.onOpen(props.row, event.currentTarget)}
      >
        <Label text={props.row.label} running={props.row.running} />
        <Show when={icon()}>{(glyph) => <RemixIcon icon={GLYPH[glyph()]} size={12} class="run-tree-icon" data-failed={glyph() === "alert-circle" ? "" : undefined} />}</Show>
      </button>
    </Show>
  )
}

export function RunTree(props: { windowKey: string; /** The steps the bubble says it opens. Absent under the typing bubble. */ count?: number }): JSX.Element {
  const steps = createMemo(() => unwrap(useApp.runSteps(props.windowKey)) as readonly RunStep[])
  const working = () => useApp.runLive(props.windowKey)
  const live = createMemo(() => isLive(steps(), working()))
  const openKey = () => `${useApp.activeThreadId() ?? ""}|${props.windowKey}|${live() ? "live" : "done"}`
  const open = createMemo(() => opened().has(openKey()))
  const tree = createMemo(() => treeOf(steps(), { working: working(), open: open(), count: props.count, fetching: useApp.runFetching(props.windowKey) }))

  // An open finished tree asks the room for the steps it lacks. Never on render alone, so scrolling
  // the thread sends no request per message.
  createEffect(() => {
    if (open() && !live()) untrack(() => useApp.loadRunSteps(props.windowKey))
  })

  // The folded rows are in the page while open and while they shut. Only the reader's own click
  // moves them: a tree that mounts open, or that finished work closes, changes at once.
  const [fold, setFold] = createSignal<Fold>(untrack(open) ? "open" : "gone")
  let clicked = false
  let list: HTMLDivElement | undefined
  createEffect(
    on(
      open,
      (isOpen) => {
        const moves = clicked
        clicked = false
        if (isOpen) return void setFold(moves ? "grow" : "open")
        const ms = moves && list ? foldMs(list) : 0
        if (ms === 0) return void setFold("gone")
        setFold("shut")
        const timer = setTimeout(() => setFold("gone"), ms)
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

  // The tree is the panel's anchor, and where focus goes back on close when the row that opened the
  // panel is gone: the typing row's tree, once the bubble lands.
  let root!: HTMLDivElement
  createEffect(() => onCleanup(registerRunAnchor(props.windowKey, root)))
  const openPanel = (row: HTMLElement) => {
    toggleRun(props.windowKey, row)
    useApp.loadRunSteps(props.windowKey)
  }
  // A file the call wrote or read opens beside the chat, and a folder opens the file tree. A file the
  // chat no longer has, and every other call, opens the step's details in the run panel instead.
  const openRow = (row: TreeRow, element: HTMLElement) => {
    const chat = useApp.activeThreadId()
    const target = row.target
    if (chat && target) {
      const found = target.folder ? null : findFile(target.path)
      if (found?.kind === "file") return openFile(chat, found.path)
      if (target.folder || found?.kind === "many") return openSurface(chat, fixedSurface("files"))
    }
    openPanel(element)
  }

  return (
    <div ref={root} class="run-tree" tabindex="-1" data-component="run-tree">
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
            <Index each={tree().folded}>{(row) => <Row row={row()} onOpen={openRow} />}</Index>
          </div>
        </div>
      </Show>
      <Index each={tree().shown}>{(row) => <Row row={row()} onOpen={openRow} />}</Index>
    </div>
  )
}
