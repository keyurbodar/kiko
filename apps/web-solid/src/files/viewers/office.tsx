import { ChevronLeftIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { TabsPill, TabsV2 as Tabs } from "@kiko/ui/v2/tabs-v2"
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { SurfaceAction, SurfaceFailure, SurfaceLoading, SurfaceNotice } from "../chrome"
import { formatBytes } from "./format"
import {
  OFFICE_MAX_BYTES,
  type DocxModel,
  type OfficeBlock,
  type OfficeImage,
  type OfficeKind,
  type OfficeModel,
  type OfficeRequest,
  type OfficeResult,
  type PptxModel,
  type SheetModel,
  type XlsxModel,
} from "./office-model"
import { VirtualTable } from "./virtual-table"

function Block(props: { block: OfficeBlock; urls: ReadonlyMap<string, string> }): JSX.Element {
  return (
    <Switch>
      <Match when={props.block.kind === "heading" ? (props.block as { level: number; text: string }) : null}>
        {(heading) => (
          <h2
            class="font-semibold text-fg"
            style={{ "font-size": `${Math.max(13, 22 - heading().level * 2)}px`, "line-height": 1.3 }}
          >
            {heading().text}
          </h2>
        )}
      </Match>
      <Match when={props.block.kind === "paragraph" ? (props.block as { text: string }) : null}>
        {(paragraph) => <p class="whitespace-pre-wrap text-ui leading-relaxed text-fg2">{paragraph().text}</p>}
      </Match>
      <Match when={props.block.kind === "list" ? (props.block as { ordered: boolean; items: string[] }) : null}>
        {(list) => (
          <Switch>
            <Match when={list().ordered}>
              <ol class="list-decimal space-y-1 pl-5 text-ui leading-relaxed text-fg2">
                <For each={list().items}>{(item) => <li>{item}</li>}</For>
              </ol>
            </Match>
            <Match when={!list().ordered}>
              <ul class="list-disc space-y-1 pl-5 text-ui leading-relaxed text-fg2">
                <For each={list().items}>{(item) => <li>{item}</li>}</For>
              </ul>
            </Match>
          </Switch>
        )}
      </Match>
      <Match when={props.block.kind === "table" ? (props.block as { rows: string[][] }) : null}>
        {(table) => (
          <div class="overflow-x-auto">
            <table class="w-full border-separate border-spacing-0 text-hint">
              <tbody>
                <For each={table().rows}>
                  {(row) => (
                    <tr>
                      <For each={row}>
                        {(cell) => (
                          <td class="border border-[var(--line)] px-2.5 py-1.5 align-top whitespace-pre-wrap text-fg2">
                            {cell}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        )}
      </Match>
      <Match when={props.block.kind === "image" ? (props.block as { path: string }) : null}>
        {(image) => (
          <Show when={props.urls.get(image().path)}>
            {(url) => <img src={url()} alt="" class="max-w-full rounded-control" loading="lazy" />}
          </Show>
        )}
      </Match>
    </Switch>
  )
}

function Docx(props: { blocks: readonly OfficeBlock[]; urls: ReadonlyMap<string, string> }): JSX.Element {
  return (
    <div class="min-h-0 flex-1 overflow-auto bg-panel">
      <div class="mx-auto flex max-w-[72ch] flex-col gap-3 px-6 py-6">
        <For each={props.blocks}>{(block) => <Block block={block} urls={props.urls} />}</For>
      </div>
    </div>
  )
}

function Presentation(props: { slides: PptxModel["slides"]; urls: ReadonlyMap<string, string> }): JSX.Element {
  const [page, setPage] = createSignal(0)
  const slide = () => props.slides[Math.min(page(), props.slides.length - 1)]
  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="file-presentation">
      <div class="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-[var(--border-100)] px-2 text-hint text-fg3">
        <SurfaceAction
          label="Previous slide"
          icon={ChevronLeftIcon}
          action="slide-previous"
          disabled={page() === 0}
          onPress={() => setPage((value) => Math.max(0, value - 1))}
        />
        <span class="flex-1 text-center tabular-nums" aria-live="polite">
          Slide {page() + 1} of {props.slides.length}
        </span>
        <SurfaceAction
          label="Next slide"
          icon={ChevronRightIcon}
          action="slide-next"
          disabled={page() + 1 >= props.slides.length}
          onPress={() => setPage((value) => Math.min(props.slides.length - 1, value + 1))}
        />
      </div>
      <div class="min-h-0 flex-1 overflow-auto bg-panel px-6 py-6">
        <Show when={slide()}>
          {(current) => (
            <div class="mx-auto flex aspect-video w-full max-w-[860px] flex-col gap-2 overflow-hidden rounded-control bg-white p-8 text-black">
              <For each={current().blocks}>{(block) => <Block block={block} urls={props.urls} />}</For>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

function Sheet(props: { sheets: readonly SheetModel[]; name: string; truncated: boolean }): JSX.Element {
  const [active, setActive] = createSignal(props.sheets[0]?.name ?? "")
  const sheet = createMemo(() => props.sheets.find((item) => item.name === active()) ?? props.sheets[0])
  const pageRows = 64
  const columnCount = createMemo(() =>
    Math.max(1, sheet()?.rows.reduce((widest, row) => Math.max(widest, row.length), 0) ?? 1),
  )
  const getRows = (index: number) => sheet()?.rows.slice(index * pageRows, (index + 1) * pageRows)
  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="file-sheet">
      <Show when={props.sheets.length > 1}>
        <div class="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border-100)] px-2">
          <Tabs value={active()} onChange={(next: string) => setActive(next)} class="min-w-0">
            <Tabs.List class="flex gap-1 overflow-x-auto" aria-label="Sheets">
              <TabsPill />
              <For each={props.sheets}>
                {(item) => (
                  <Tabs.Trigger
                    value={item.name}
                    class="shrink-0 rounded-control px-2.5 py-1 text-hint text-fg2 data-[selected]:bg-active data-[selected]:text-fg"
                  >
                    {item.name}
                  </Tabs.Trigger>
                )}
              </For>
            </Tabs.List>
          </Tabs>
        </div>
      </Show>
      <Show when={props.truncated || sheet()?.truncated}>
        <SurfaceNotice>Cell values only. Large sheets are cut to the preview limits.</SurfaceNotice>
      </Show>
      <Show when={sheet()}>
        {(current) => (
          <VirtualTable
            name={`${props.name}: ${current().name}`}
            count={current().rows.length}
            columns={columnCount()}
            header={current().rows[0]}
            getRows={getRows}
            pageRows={pageRows}
          />
        )}
      </Show>
      <div
        role="status"
        class="flex h-8 shrink-0 items-center border-t border-[var(--border-100)] px-3 text-hint text-fg3 tabular-nums"
      >
        {Math.max(0, (sheet()?.rows.length ?? 0) - 1).toLocaleString()} rows, {columnCount().toLocaleString()} columns
      </div>
    </div>
  )
}

export default function OfficeViewer(props: {
  src: string
  name: string
  kind: OfficeKind
  size: number
}): JSX.Element {
  const [model, setModel] = createSignal<OfficeModel | null>(null)
  const [urls, setUrls] = createSignal<ReadonlyMap<string, string>>(new Map())
  const [error, setError] = createSignal<string | null>(null)
  const [attempt, setAttempt] = createSignal(0)
  const docx = createMemo(() => (model()?.kind === "docx" ? (model() as DocxModel) : null))
  const pptx = createMemo(() => (model()?.kind === "pptx" ? (model() as PptxModel) : null))
  const xlsx = createMemo(() => (model()?.kind === "xlsx" ? (model() as XlsxModel) : null))

  createEffect(
    on(
      () => [props.src, props.kind, props.size, attempt()] as const,
      () => {
        setModel(null)
        setError(null)
        if (props.size > OFFICE_MAX_BYTES) {
          setError("Preview limited to files under 25 MB.")
          return
        }
        const worker = new Worker(new URL("./office.worker.ts", import.meta.url), { type: "module" })
        worker.addEventListener("message", (event: MessageEvent<OfficeResult>) => {
          const result = event.data
          if (result.type === "error") setError(result.message)
          else setModel(result.model)
          worker.terminate()
        })
        worker.addEventListener("error", () => {
          setError("The document viewer stopped.")
          worker.terminate()
        })
        worker.postMessage(
          { type: "open", kind: props.kind, src: props.src, size: props.size } satisfies OfficeRequest,
          [],
        )
        onCleanup(() => worker.terminate())
      },
    ),
  )

  createEffect(
    on(model, (value) => {
      const created = new Map<string, string>()
      for (const image of value && "images" in value ? (value.images as OfficeImage[]) : [])
        created.set(image.path, URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.type })))
      setUrls(created)
      onCleanup(() => {
        for (const url of created.values()) URL.revokeObjectURL(url)
      })
    }),
  )

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="file-office">
      <Switch>
        <Match when={error()}>
          <SurfaceFailure message={error() ?? ""} onRetry={() => setAttempt((count) => count + 1)} />
        </Match>
        <Match when={docx()}>{(value) => <Docx blocks={value().blocks} urls={urls()} />}</Match>
        <Match when={pptx()}>{(value) => <Presentation slides={value().slides} urls={urls()} />}</Match>
        <Match when={xlsx()}>
          {(value) => <Sheet sheets={value().sheets} name={props.name} truncated={value().truncated} />}
        </Match>
        <Match when={!model()}>
          <SurfaceLoading />
        </Match>
      </Switch>
      <Show when={model()?.truncated}>
        <SurfaceNotice>Preview limited. Save the file to read the full document.</SurfaceNotice>
      </Show>
      <div class="flex h-8 min-h-8 shrink-0 items-center justify-end border-t border-[var(--border-100)] px-3 text-hint text-fg3">
        {formatBytes(props.size)}
      </div>
    </div>
  )
}
