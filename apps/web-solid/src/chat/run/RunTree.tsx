import type { RunStep } from "@kiko/protocol"
import { ChevronRightIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show, untrack, type JSX } from "solid-js"
import { unwrap } from "solid-js/store"
import { useApp } from "../../lib/store"
import { fixedSurface, openFile, openSurface } from "../side/surfaces"
import { findFile } from "../ui/find-file"
import { GLYPH } from "./glyphs"
import { isLive, type TreeRow, treeOf } from "./run-tree-rows"
import "./run-tree.css"

const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())

const MAX_OPENED = 100

function setOpen(key: string, value: boolean) {
  const next = new Set(opened())
  next.delete(key)
  if (value) next.add(key)
  if (next.size > MAX_OPENED) next.delete(next.values().next().value as string)
  setOpened(next)
}

type Fold = "gone" | "open" | "grow" | "shut"

const foldMs = (element: HTMLElement) => Math.max(0, ...getComputedStyle(element).transitionDuration.split(",").map((s) => Number.parseFloat(s) * 1000 || 0))

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

function Detail(props: { row: TreeRow; loading: boolean }) {
  const detail = () => props.row.detail!
  return (
    <div class="run-tree-detail">
      <Show when={detail().lines}>{(lines) => <For each={lines()}>{(line) => <p class="run-tree-note">{line}</p>}</For>}</Show>
      <Show when={!detail().lines}>
        <Show
          when={detail().input || detail().output}
          fallback={<p class="run-tree-note">{detail().running ? "Running…" : props.loading ? "Loading output…" : "No output."}</p>}
        >
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

function Row(props: { row: TreeRow; open: boolean; loading: boolean; onOpen: (row: TreeRow) => void }) {
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
        aria-expanded={props.row.detail ? props.open : undefined}
        title={props.row.target && !props.row.target.folder ? `Open ${props.row.target.path}` : undefined}
        onClick={() => props.onOpen(props.row)}
      >
        <Label text={props.row.label} running={props.row.running} />
        <Show when={icon()}>{(glyph) => <RemixIcon icon={GLYPH[glyph()]} size={12} class="run-tree-icon" data-failed={glyph() === "alert-circle" ? "" : undefined} />}</Show>
      </button>
      <Show when={props.open && props.row.detail}>
        <Detail row={props.row} loading={props.loading} />
      </Show>
    </Show>
  )
}

export function RunTree(props: { windowKey: string;  count?: number }): JSX.Element {
  const steps = createMemo(() => unwrap(useApp.runSteps(props.windowKey)) as readonly RunStep[])
  const working = () => useApp.runLive(props.windowKey)
  const live = createMemo(() => isLive(steps(), working()))
  const openKey = () => `${useApp.activeThreadId() ?? ""}|${props.windowKey}|${live() ? "live" : "done"}`
  const open = createMemo(() => opened().has(openKey()))
  const tree = createMemo(() => treeOf(steps(), { working: working(), open: open(), count: props.count, fetching: useApp.runFetching(props.windowKey) }))

  createEffect(() => {
    if (open() && !live()) untrack(() => useApp.loadRunSteps(props.windowKey))
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

  const [shownRows, setShownRows] = createSignal<ReadonlySet<string>>(new Set())
  const openDetail = (row: TreeRow) => {
    setShownRows((current) => {
      const next = new Set(current)
      if (!next.delete(row.id)) next.add(row.id)
      return next
    })
    useApp.loadRunSteps(props.windowKey)
  }
  const openRow = (row: TreeRow) => {
    const chat = useApp.activeThreadId()
    const target = row.target
    if (chat && target) {
      const found = target.folder ? null : findFile(target.path)
      if (found?.kind === "file") return openFile(chat, found.path)
      if (target.folder || found?.kind === "many") return openSurface(chat, fixedSurface("files"))
    }
    openDetail(row)
  }

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
            <Index each={tree().folded}>{(row) => <Row row={row()} open={shownRows().has(row().id)} loading={useApp.runFetching(props.windowKey)} onOpen={openRow} />}</Index>
          </div>
        </div>
      </Show>
      <Index each={tree().shown}>{(row) => <Row row={row()} open={shownRows().has(row().id)} loading={useApp.runFetching(props.windowKey)} onOpen={openRow} />}</Index>
    </div>
  )
}
