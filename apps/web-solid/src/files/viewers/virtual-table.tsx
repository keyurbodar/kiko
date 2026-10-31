import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { SurfaceLoading } from "../chrome"
import { columnLabel } from "../delimited"

const ROW_HEIGHT = 29
const ROW_NUMBER = 56
const OVERSCAN = 8

export type VirtualTableProps = {
  name: string
  count: number
  columns: number
  header?: readonly string[] | undefined
  source?: boolean
  getRows: (page: number) => readonly (readonly string[])[] | undefined
  loadPage?: (page: number) => void
  pageRows: number
}

function columnWidth(
  header: readonly string[] | undefined,
  samples: readonly (readonly string[])[],
  index: number,
): number {
  let widest = header?.[index]?.length ?? 0
  for (const row of samples) widest = Math.max(widest, row[index]?.length ?? 0)
  return Math.max(96, Math.min(320, Math.round(widest * 7 + 28)))
}

export function VirtualTable(props: VirtualTableProps): JSX.Element {
  let scroller!: HTMLDivElement
  const [top, setTop] = createSignal(0)
  const [left, setLeft] = createSignal(0)
  const [height, setHeight] = createSignal(600)
  const [width, setWidth] = createSignal(900)
  const requested = new Set<number>()

  onMount(() => {
    const watch = new ResizeObserver(([entry]) => {
      if (!entry) return
      setHeight(entry.contentRect.height)
      setWidth(entry.contentRect.width)
    })
    watch.observe(scroller)
    setHeight(scroller.clientHeight)
    setWidth(scroller.clientWidth)
    onCleanup(() => watch.disconnect())
  })

  const dataStart = createMemo(() => (props.header ? 1 : 0))
  const bodyCount = createMemo(() => Math.max(0, props.count - dataStart()))
  const widths = createMemo(() => {
    const rows = props.getRows(0) ?? []
    const samples = rows.slice(dataStart(), dataStart() + 20)
    return Array.from({ length: props.columns }, (_, index) => columnWidth(props.header, samples, index))
  })
  const offsets = createMemo(() => {
    const result = [0]
    for (const size of widths()) result.push(result[result.length - 1]! + size)
    return result
  })
  const visibleColumns = createMemo(() => {
    if (props.columns <= 0) return []
    const offs = offsets()
    const candidates = offs.slice(0, props.columns)
    let first = candidates.findLastIndex((offset) => offset <= left() + ROW_NUMBER)
    first = Math.max(0, first - 1)
    let last = props.columns
    for (let index = first; index < props.columns; index++) {
      if (offs[index]! > left() + width() - ROW_NUMBER) {
        last = Math.min(props.columns, index + 2)
        break
      }
    }
    return Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index)
  })
  const firstLocal = createMemo(() =>
    Math.min(Math.max(0, Math.floor(top() / ROW_HEIGHT) - OVERSCAN), Math.max(0, bodyCount() - 1)),
  )
  const visibleRows = createMemo(() =>
    Math.min(bodyCount() - firstLocal(), Math.ceil(height() / ROW_HEIGHT) + OVERSCAN * 2),
  )
  const rowIndexes = createMemo(() =>
    Array.from({ length: Math.max(0, visibleRows()) }, (_, index) => dataStart() + firstLocal() + index),
  )

  createEffect(
    on([rowIndexes, () => props.count], () => {
      if (!props.loadPage) return
      const pages = new Set(
        rowIndexes().flatMap((index) => [Math.floor(index / props.pageRows), Math.floor((index + 1) / props.pageRows)]),
      )
      for (const page of pages) {
        if (requested.has(page) || props.getRows(page)) continue
        requested.add(page)
        props.loadPage(page)
      }
    }),
  )
  createEffect(
    on(
      () => props.name,
      () => requested.clear(),
    ),
  )

  const rowAt = (index: number) => props.getRows(Math.floor(index / props.pageRows))?.[index % props.pageRows]
  const spacer = createMemo(() => offsets()[visibleColumns()[0] ?? 0]!)
  const tableWidth = createMemo(() => (props.source ? 0 : Math.max(width(), offsets()[props.columns]! + ROW_NUMBER)))

  return (
    <div
      ref={scroller}
      class="relative min-h-0 flex-1 overflow-auto"
      role={props.source ? "region" : "table"}
      aria-label={props.name}
      aria-rowcount={bodyCount()}
      aria-colcount={props.source ? undefined : props.columns}
      onScroll={(event) => {
        setTop(event.currentTarget.scrollTop)
        setLeft(event.currentTarget.scrollLeft)
      }}
    >
      <div style={{ width: tableWidth() ? `${tableWidth()}px` : "100%", "min-width": "100%" }}>
        <Show when={!props.source}>
          <div
            role="row"
            class="sticky top-0 z-20 flex border-b border-[var(--stroke-tertiary)] bg-editor text-primary"
            style={{ height: `${ROW_HEIGHT}px` }}
          >
            <div
              class="sticky left-0 z-10 shrink-0 border-r border-[var(--stroke-tertiary)] bg-editor"
              style={{ width: `${ROW_NUMBER}px` }}
            />
            <div style={{ width: `${spacer()}px`, "flex-shrink": 0 }} />
            <For each={visibleColumns()}>
              {(column) => (
                <div
                  role="columnheader"
                  aria-colindex={column + 1}
                  class="shrink-0 overflow-hidden border-r border-[var(--stroke-tertiary)] px-2.5 text-ellipsis whitespace-pre"
                  style={{ width: `${widths()[column]}px`, "line-height": `${ROW_HEIGHT}px` }}
                  title={props.header?.[column] ?? columnLabel(column)}
                >
                  {props.header?.[column] ?? columnLabel(column)}
                </div>
              )}
            </For>
          </div>
        </Show>
        <div style={{ height: `${bodyCount() * ROW_HEIGHT}px`, position: "relative" }}>
          <div style={{ transform: `translateY(${firstLocal() * ROW_HEIGHT}px)` }}>
            <For each={rowIndexes()}>
              {(index) => {
                const row = () => rowAt(index)
                const local = index - dataStart()
                return (
                  <div
                    role={props.source ? undefined : "row"}
                    aria-rowindex={props.source ? undefined : index + 1}
                    data-preview-row={index}
                    class="flex border-b border-[var(--stroke-tertiary)]"
                    classList={{ "bg-secondary": local % 2 === 1 }}
                    style={{ height: `${ROW_HEIGHT}px` }}
                  >
                    <div
                      role={props.source ? undefined : "rowheader"}
                      class="sticky left-0 z-10 shrink-0 border-r border-[var(--stroke-tertiary)] bg-editor px-2 text-right text-tertiary select-none"
                      style={{ width: `${ROW_NUMBER}px`, "line-height": `${ROW_HEIGHT}px` }}
                      data-row-number={index + 1}
                    >
                      {index + 1}
                    </div>
                    <div style={{ width: `${spacer()}px`, "flex-shrink": 0 }} />
                    <For each={visibleColumns()}>
                      {(column) => {
                        const text = () => row()?.[column] ?? ""
                        return (
                          <div
                            role={props.source ? undefined : "cell"}
                            aria-colindex={props.source ? undefined : column + 1}
                            class="shrink-0 overflow-hidden border-r border-[var(--stroke-tertiary)] px-2.5 text-ellipsis whitespace-pre text-secondary"
                            classList={{ "font-mono": props.source }}
                            style={{ width: `${widths()[column]}px`, "line-height": `${ROW_HEIGHT}px` }}
                            title={text()}
                          >
                            {text()}
                          </div>
                        )
                      }}
                    </For>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
        <Show when={bodyCount() > 0 && !rowAt(dataStart())}>
          <div class="absolute inset-x-0 top-0 flex h-24 items-center justify-center">
            <SurfaceLoading />
          </div>
        </Show>
      </div>
    </div>
  )
}
