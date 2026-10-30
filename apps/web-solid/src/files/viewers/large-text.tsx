import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { SurfaceFailure, SurfaceNotice } from "../chrome"
import { MAX_BYTES, PAGE_ROWS, type TextRequest, type TextResult } from "./large-text-model"
import { VirtualTable } from "./virtual-table"

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function LargeTextViewer(props: {
  name: string
  src: string
  size: number
  delimiter: "," | "\t" | null
}): JSX.Element {
  const [meta, setMeta] = createSignal<Extract<TextResult, { type: "meta" }> | null>(null)
  const [pages, setPages] = createSignal<ReadonlyMap<number, readonly (readonly string[])[]>>(new Map())
  const [error, setError] = createSignal<string | null>(null)
  const requested = new Set<number>()
  let worker: Worker | undefined

  const close = () => {
    worker?.terminate()
    worker = undefined
    requested.clear()
  }
  onCleanup(close)

  createEffect(() => {
    const src = props.src
    const size = props.size
    const delimiter = props.delimiter
    close()
    setMeta(null)
    setPages(new Map())
    setError(null)
    const engine = new Worker(new URL("./large-text.worker.ts", import.meta.url), { type: "module" })
    worker = engine
    engine.addEventListener("message", (event: MessageEvent<TextResult>) => {
      const result = event.data
      if (result.type === "error") setError(result.message)
      else if (result.type === "meta") setMeta(result)
      else {
        requested.delete(result.index)
        setPages((old) => {
          const next = new Map(old)
          next.set(result.index, result.rows)
          if (next.size > 24) next.delete([...next.keys()].find((key) => key !== 0) ?? -1)
          return next
        })
      }
    })
    engine.addEventListener("error", () => setError("The text viewer stopped."))
    engine.postMessage({ type: "open", src, size, delimiter } satisfies TextRequest, [])
    onCleanup(() => {
      engine.terminate()
      if (worker === engine) worker = undefined
    })
  })

  const getRows = (page: number) => pages().get(page)
  const loadPage = (page: number) => {
    if (requested.has(page)) return
    requested.add(page)
    const message: TextRequest = { type: "page", index: page }
    worker?.postMessage(message, [])
  }
  const header = createMemo(() => (props.delimiter ? getRows(0)?.[0] : undefined))
  const rows = createMemo(() => Math.max(0, (meta()?.count ?? 0) - (props.delimiter ? 1 : 0)))
  const columns = createMemo(() => (props.delimiter ? Math.max(1, meta()?.columns ?? 1) : 1))
  const truncated = createMemo(() => (meta() ? !meta()!.complete : false))

  return (
    <Show when={!error()} fallback={<SurfaceFailure message={error() ?? ""} />}>
      <div class="flex min-h-0 flex-1 flex-col" data-component="file-large-text">
        <Show when={truncated()}>
          <SurfaceNotice>
            Showing the first {formatSize(MAX_BYTES)} of a {formatSize(meta()?.size ?? 0)} file. Save it to read the
            whole file.
          </SurfaceNotice>
        </Show>
        <Show
          when={meta()}
          fallback={
            <div role="status" class="flex min-h-0 flex-1 items-center justify-center text-hint text-fg3">
              Reading file
            </div>
          }
        >
          {(info) => (
            <>
              <Show when={info().count > 0}>
                <VirtualTable
                  name={props.name}
                  count={info().count}
                  columns={columns()}
                  header={header()}
                  source={!props.delimiter}
                  getRows={getRows}
                  loadPage={loadPage}
                  pageRows={PAGE_ROWS}
                />
              </Show>
              <Show when={info().count === 0}>
                <div class="flex min-h-0 flex-1 items-center justify-center p-6 text-hint text-fg3">
                  This file is empty.
                </div>
              </Show>
              <div
                role="status"
                class="flex h-8 shrink-0 items-center border-t border-[var(--border-100)] px-3 text-hint text-fg3"
              >
                {rows().toLocaleString()} {props.delimiter ? "rows" : "lines"}
                {props.delimiter ? `, ${columns().toLocaleString()} columns` : ""}
              </div>
            </>
          )}
        </Show>
      </div>
    </Show>
  )
}
