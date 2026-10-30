import { parseRichText } from "@kiko/protocol/markdown"
import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { CodeBlock } from "../../chat/rich/code/CodeBlock"
import { RichText } from "../../chat/rich/RichText"
import { SurfaceFailure, SurfaceLoading, SurfaceNotice } from "../chrome"

const MAX_NOTEBOOK_BYTES = 4 * 1024 * 1024
const PAGE = 20

type RawOutput = {
  output_type?: string
  text?: string | string[]
  ename?: string
  evalue?: string
  traceback?: string[]
  data?: Record<string, unknown>
}

type RawCell = {
  cell_type?: string
  source?: string | string[]
  execution_count?: number | null
  outputs?: RawOutput[]
}

type Cell = {
  kind: string
  source: string
  executionCount: number | null
  outputs: { kind: "text" | "image"; text: string }[]
}

type Notebook = { cells: Cell[]; language: string }

const text = (value: unknown): string => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.filter((line): line is string => typeof line === "string").join("")
  return ""
}

const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z\d+/]+={0,2}$/i

function outputsOf(raw: readonly RawOutput[]): Cell["outputs"] {
  const outputs: Cell["outputs"] = []
  for (const output of raw) {
    if (output.output_type === "stream") {
      const value = text(output.text)
      if (value) outputs.push({ kind: "text", text: value })
      continue
    }
    if (output.output_type === "error") {
      outputs.push({ kind: "text", text: [output.ename, output.evalue].filter(Boolean).join(": ") })
      continue
    }
    const data = output.data ?? {}
    const plain = text(data["text/plain"])
    if (plain) outputs.push({ kind: "text", text: plain })
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      const value = data[type]
      if (typeof value !== "string") continue
      const url = `data:${type};base64,${value.replace(/\s/g, "")}`
      if (IMAGE_DATA.test(url)) outputs.push({ kind: "image", text: url })
    }
  }
  return outputs
}

function parseNotebook(source: string): Notebook {
  let raw: { cells?: RawCell[]; metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } } }
  try {
    raw = JSON.parse(source) as typeof raw
  } catch {
    throw new Error("This notebook is not readable JSON.")
  }
  const cells = (raw.cells ?? []).map((cell) => ({
    kind: cell.cell_type ?? "code",
    source: text(cell.source),
    executionCount: typeof cell.execution_count === "number" ? cell.execution_count : null,
    outputs: outputsOf(cell.outputs ?? []),
  }))
  return {
    cells,
    language: raw.metadata?.kernelspec?.language ?? raw.metadata?.language_info?.name ?? "text",
  }
}

const EXTENSIONS: Record<string, string> = { python: "py", javascript: "js", typescript: "ts", julia: "jl", r: "r" }

function CellView(props: { cell: Cell; index: number; language: string }): JSX.Element {
  const label = () => (props.cell.kind === "markdown" ? "Markdown" : props.cell.kind === "code" ? "Code" : "Raw")
  return (
    <section
      aria-label={`Cell ${props.index + 1}`}
      class="min-w-0 overflow-hidden rounded-control"
      data-component="notebook-cell"
    >
      <div class="flex items-center gap-2 bg-raise px-3 py-1 text-hint text-fg3">
        <span class="flex-1">
          {label()} {props.index + 1}
        </span>
        <Show when={props.cell.executionCount !== null}>
          <span class="tabular-nums">In [{props.cell.executionCount}]</span>
        </Show>
      </div>
      <Show when={props.cell.kind === "markdown"}>
        <RichText tree={parseRichText(props.cell.source)} class="fv-markdown px-4 py-3" />
      </Show>
      <Show when={props.cell.kind !== "markdown" && props.cell.source.trim()}>
        <CodeBlock
          files={[
            {
              lang: props.cell.kind === "code" ? props.language : undefined,
              name: `cell.${EXTENSIONS[props.language] ?? props.language}`,
              text: props.cell.source,
            },
          ]}
        />
      </Show>
      <For each={props.cell.outputs}>
        {(output) => (
          <Show
            when={output.kind === "image"}
            fallback={
              <pre class="overflow-x-auto border-t border-[var(--line)] px-4 py-2 font-mono text-hint whitespace-pre-wrap text-fg2">
                {output.text}
              </pre>
            }
          >
            <img
              src={output.text}
              alt={`Cell ${props.index + 1} output`}
              class="max-h-96 max-w-full border-t border-[var(--line)] object-contain p-4"
            />
          </Show>
        )}
      </For>
    </section>
  )
}

export default function NotebookViewer(props: { name: string; src: string; size: number }): JSX.Element {
  const [source, setSource] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [visible, setVisible] = createSignal(PAGE)
  const notebook = createMemo(() => (source() === null ? null : parseNotebook(source()!)))

  createEffect(() => {
    const src = props.src
    const size = props.size
    setSource(null)
    setError(null)
    setVisible(PAGE)
    if (size > MAX_NOTEBOOK_BYTES) {
      setError("Notebook previews support files up to 4 MB.")
      return
    }
    void fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error("This notebook could not be loaded.")
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength > MAX_NOTEBOOK_BYTES) throw new Error("Notebook previews support files up to 4 MB.")
        try {
          setSource(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        } catch {
          setError("This notebook is not UTF-8 text.")
        }
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "This notebook could not be loaded."),
      )
  })

  return (
    <Show when={!error()} fallback={<SurfaceFailure message={error() ?? ""} />}>
      <Show when={notebook()} fallback={<SurfaceLoading />}>
        {(loaded) => (
          <div class="flex min-h-0 flex-1 flex-col" data-component="file-notebook">
            <div class="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border-100)] px-3 text-hint text-fg3">
              <span class="flex-1 tabular-nums">
                {loaded().cells.length.toLocaleString()} cells, {loaded().language}
              </span>
            </div>
            <SurfaceNotice>Saved outputs only. Code is never executed.</SurfaceNotice>
            <div class="min-h-0 flex-1 overflow-auto">
              <div class="mx-auto flex max-w-4xl flex-col gap-4 px-5 py-6">
                <For each={loaded().cells.slice(0, visible())}>
                  {(cell, index) => <CellView cell={cell} index={index()} language={loaded().language} />}
                </For>
                <Show when={visible() < loaded().cells.length}>
                  <button
                    type="button"
                    class="self-center rounded-control px-3 py-1.5 text-hint text-fg2 hover:bg-hover"
                    onClick={() => setVisible((count) => count + PAGE)}
                  >
                    Show more cells ({loaded().cells.length - visible()} remaining)
                  </button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </Show>
  )
}
