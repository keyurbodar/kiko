import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { SurfaceFailure, SurfaceLoading, SurfaceNotice } from "../chrome"
import type { ArchiveEntry, ArchiveRequest, ArchiveResult } from "./archive"
import { formatBytes } from "./format"
import { hexRow, hexRowCount } from "./hex"

const HEX_MAX_BYTES = 4 * 1024 * 1024
const HEX_ROW_HEIGHT = 20
const OVERSCAN = 8

function HexView(props: { bytes: Uint8Array; size: number }): JSX.Element {
  let scroller!: HTMLDivElement
  const [top, setTop] = createSignal(0)
  const [height, setHeight] = createSignal(600)
  const rows = createMemo(() => hexRowCount(Math.min(props.bytes.length, props.size)))
  const perRow = 16

  onMount(() => {
    const watch = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height))
    watch.observe(scroller)
    setHeight(scroller.clientHeight)
    onCleanup(() => watch.disconnect())
  })

  const first = createMemo(() => Math.max(0, Math.floor(top() / HEX_ROW_HEIGHT) - OVERSCAN))
  const visible = createMemo(() => Math.min(rows() - first(), Math.ceil(height() / HEX_ROW_HEIGHT) + OVERSCAN * 2))

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="file-hex">
      <Show when={props.size > props.bytes.length}>
        <SurfaceNotice>
          Showing the first {formatBytes(props.bytes.length)} of a {formatBytes(props.size)} file.
        </SurfaceNotice>
      </Show>
      <div
        ref={scroller}
        class="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs text-secondary"
        role="region"
        aria-label="File bytes"
        onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      >
        <div style={{ height: `${rows() * HEX_ROW_HEIGHT}px`, position: "relative" }}>
          <div style={{ transform: `translateY(${first() * HEX_ROW_HEIGHT}px)` }}>
            <For each={Array.from({ length: Math.max(0, visible()) }, (_, index) => first() + index)}>
              {(index) => {
                const row = () => hexRow(props.bytes, index * perRow, perRow)
                return (
                  <div
                    class="flex whitespace-pre"
                    style={{ height: `${HEX_ROW_HEIGHT}px`, "line-height": `${HEX_ROW_HEIGHT}px` }}
                  >
                    <span class="w-20 shrink-0 text-tertiary select-none" data-hex-offset={row().offset}>
                      {row().offset}
                    </span>
                    <span class="shrink-0" data-hex-bytes>
                      {row().hex}
                    </span>
                    <span class="ml-4 shrink-0 text-tertiary">{row().ascii}</span>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </div>
      <div
        role="status"
        class="flex h-8 shrink-0 items-center border-t border-[var(--stroke-tertiary)] px-3 text-xs text-tertiary"
      >
        {formatBytes(props.size)}
      </div>
    </div>
  )
}

function ArchiveList(props: { entries: readonly ArchiveEntry[]; size: number; name: string }): JSX.Element {
  const sorted = createMemo(() =>
    [...props.entries].sort(
      (left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name),
    ),
  )
  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="file-archive">
      <div class="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--stroke-tertiary)] px-3 text-xs text-tertiary">
        <span class="min-w-0 flex-1 truncate">{props.name}</span>
        <span class="shrink-0">
          {props.entries.length.toLocaleString()} entries, {formatBytes(props.size)}
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full border-separate border-spacing-0 text-xs">
          <thead class="sticky top-0 z-10 bg-editor text-tertiary">
            <tr>
              <th class="border-b border-[var(--stroke-tertiary)] px-3 py-1.5 text-left">Name</th>
              <th class="w-24 border-b border-[var(--stroke-tertiary)] px-3 py-1.5 text-right">Size</th>
              <th class="w-28 border-b border-[var(--stroke-tertiary)] px-3 py-1.5 text-right">Modified</th>
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(entry) => (
                <tr class="even:bg-secondary">
                  <td class="max-w-0 truncate px-3 py-1.5 text-primary" title={entry.name}>
                    {entry.name}
                  </td>
                  <td class="px-3 py-1.5 text-right text-tertiary">{formatBytes(entry.size)}</td>
                  <td class="px-3 py-1.5 text-right text-tertiary">
                    {entry.modified ? new Date(entry.modified).toLocaleDateString() : "—"}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function BinaryViewer(props: {
  src: string
  name: string
  kind: "archive" | "hex"
  size: number
}): JSX.Element {
  const [entries, setEntries] = createSignal<ArchiveEntry[] | null>(null)
  const [archiveSize, setArchiveSize] = createSignal(0)
  const [bytes, setBytes] = createSignal<Uint8Array | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(
    on(
      () => [props.src, props.kind] as const,
      () => {
        setEntries(null)
        setBytes(null)
        setError(null)
        if (props.kind === "archive") {
          const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), { type: "module" })
          worker.addEventListener("message", (event: MessageEvent<ArchiveResult>) => {
            const result = event.data
            if (result.type === "error") setError(result.message)
            else {
              setEntries(result.entries)
              setArchiveSize(result.size)
            }
            worker.terminate()
          })
          worker.addEventListener("error", () => setError("The archive viewer stopped."))
          worker.postMessage({ type: "open", src: props.src } satisfies ArchiveRequest, [])
          onCleanup(() => worker.terminate())
          return
        }
        if (props.size === 0) {
          setBytes(new Uint8Array())
          return
        }
        const controller = new AbortController()
        void fetch(props.src, {
          headers: { range: `bytes=0-${HEX_MAX_BYTES - 1}` },
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("This file could not be loaded.")
            const loaded = new Uint8Array(await response.arrayBuffer())
            setBytes(loaded.subarray(0, HEX_MAX_BYTES))
          })
          .catch((cause: unknown) => {
            if (!controller.signal.aborted)
              setError(cause instanceof Error ? cause.message : "This file could not be loaded.")
          })
        onCleanup(() => controller.abort())
      },
    ),
  )

  return (
    <Show when={!error()} fallback={<SurfaceFailure message={error() ?? ""} />}>
      <Show when={props.kind === "archive" ? entries() : bytes()} fallback={<SurfaceLoading />}>
        <Show
          when={props.kind === "archive" && entries()}
          fallback={<HexView bytes={bytes() ?? new Uint8Array()} size={props.size} />}
        >
          {(list) => <ArchiveList entries={list()} size={archiveSize()} name={props.name} />}
        </Show>
      </Show>
    </Show>
  )
}
