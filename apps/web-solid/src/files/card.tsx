import type { AgentSlug, FileRef } from "@kiko/protocol"
import { parseRichText } from "@kiko/protocol/markdown"
import { fileTone } from "@kiko/ui/file-icon"
import { DownloadIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { RichText } from "../chat/rich/RichText"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { fileSrc } from "../state/room"
import { agoText } from "./edited"
import { loadPreview, previewNow } from "./preview/build"
import type { Preview, Rows } from "./preview/model"
import { type FileType, TYPE_NAMES } from "./type"
import { TypeIcon } from "./type-icon"
import "./card.css"

export type CardFile = {
  space: string
  file: FileRef
  name: string
  type: FileType
  madeBy: AgentSlug | null
  maker: string | null
  at: number | null
  where: string
}

const GREY = ["#6f7480", "#9ea3ae"] as const

export function toneOf(name: string): string {
  const [light, dark] = fileTone(name) ?? GREY
  return `light-dark(${light}, ${dark})`
}

const callbacks = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | undefined

function whenSeen(el: Element, run: () => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        callbacks.get(entry.target)?.()
        callbacks.delete(entry.target)
      }
    },
    { rootMargin: "240px" },
  )
  callbacks.set(el, run)
  observer.observe(el)
  return () => {
    callbacks.delete(el)
    observer?.unobserve(el)
  }
}

const urls = new WeakMap<Blob, string>()
const urlOf = (blob: Blob) => {
  const known = urls.get(blob)
  if (known) return known
  const url = URL.createObjectURL(blob)
  urls.set(blob, url)
  return url
}

function Fit(props: { width: number; children: JSX.Element }) {
  let box!: HTMLDivElement
  const [scale, setScale] = createSignal(0)
  onMount(() => {
    const watch = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / props.width))
    watch.observe(box)
    onCleanup(() => watch.disconnect())
  })
  return (
    <div ref={box} class="absolute inset-0 overflow-hidden">
      <div
        class="origin-top-left"
        style={{
          width: `${props.width}px`,
          transform: `scale(${scale()})`,
          visibility: scale() ? undefined : "hidden",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

function Table(props: { rows: Rows }) {
  return (
    <table class="file-card-table">
      <tbody>
        <For each={props.rows}>
          {(row, i) => (
            <tr data-head={i() === 0 ? "" : undefined}>
              <For each={row}>{(cell) => <td>{cell}</td>}</For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  )
}

const pick = <K extends Preview["kind"]>(preview: Preview, kind: K) =>
  preview.kind === kind ? (preview as Extract<Preview, { kind: K }>) : undefined

function Drawn(props: { preview: Preview }) {
  return (
    <Switch>
      <Match when={pick(props.preview, "markdown")}>
        {(p) => (
          <Fit width={360}>
            <RichText tree={parseRichText(p().text)} class="file-card-md" />
          </Fit>
        )}
      </Match>
      <Match when={pick(props.preview, "html")}>
        {(p) => (
          <Fit width={1024}>
            <iframe
              class="file-card-frame"
              sandbox=""
              srcdoc={p().html}
              title=""
              tabIndex={-1}
              loading="lazy"
              width={1024}
              height={768}
            />
          </Fit>
        )}
      </Match>
      <Match when={pick(props.preview, "table")}>{(p) => <Table rows={p().rows} />}</Match>
      <Match when={pick(props.preview, "lines")}>
        {(p) => (
          <pre class="file-card-lines" data-mono={p().mono ? "" : undefined}>
            {p().lines.join("\n")}
          </pre>
        )}
      </Match>
      <Match when={pick(props.preview, "picture")}>
        {(p) => <img class="file-card-picture" src={urlOf(p().blob)} alt="" draggable={false} />}
      </Match>
    </Switch>
  )
}

function Sheet(props: { entry: CardFile; compact: boolean }) {
  let el!: HTMLSpanElement
  const [preview, setPreview] = createSignal<Preview | undefined>(previewNow(props.entry.file))
  const [fresh, setFresh] = createSignal(false)
  const [broken, setBroken] = createSignal(false)
  onMount(() => {
    if (preview() || props.entry.type === "image") return
    onCleanup(
      whenSeen(
        el,
        () =>
          void loadPreview(props.entry.space, props.entry.file, props.entry.type)
            .then((got) => {
              setFresh(got.fresh)
              setPreview(got.preview)
            })
            .catch(() => setPreview({ kind: "none" })),
      ),
    )
  })
  const drawn = () => {
    if (props.entry.type === "image") return !broken()
    const p = preview()
    return p === undefined || p.kind !== "none"
  }
  return (
    <span
      ref={el}
      class="file-card-sheet"
      data-kind={props.entry.type === "image" ? "image" : (preview()?.kind ?? "loading")}
      data-drawn={drawn() ? "" : undefined}
      data-fresh={fresh() ? "" : undefined}
      inert
      aria-hidden="true"
    >
      <Show
        when={drawn()}
        fallback={<TypeIcon type={props.entry.type} size={props.compact ? 28 : 40} class="file-card-icon" />}
      >
        <Show
          when={props.entry.type === "image"}
          fallback={<Show when={preview()}>{(p) => <Drawn preview={p()} />}</Show>}
        >
          <img
            class="file-card-picture"
            src={fileSrc(props.entry.space, props.entry.file.id)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
          />
        </Show>
      </Show>
    </span>
  )
}

export function FileCard(props: {
  entry: CardFile
  onOpen: () => void
  compact?: boolean
  attrs?: Record<string, string | undefined>
}) {
  const madeBy = () => (props.entry.maker ? `${props.entry.maker} made it in ${props.entry.where}` : props.entry.where)
  return (
    <div
      class="file-card group/card"
      data-compact={props.compact ? "" : undefined}
      style={{ "--tone": toneOf(props.entry.name) }}
      data-type={props.entry.type}
      {...props.attrs}
    >
      <button
        type="button"
        class="file-card-hit"
        aria-label={props.entry.name}
        aria-description={madeBy()}
        title={madeBy()}
        onClick={() => props.onOpen()}
      >
        <span class="file-card-plate">
          <Sheet entry={props.entry} compact={props.compact ?? false} />
        </span>
        <span class="file-card-text">
          <span class="file-card-name type-label truncate text-fg">{props.entry.name}</span>
          <span class="file-card-meta type-hint flex min-w-0 items-center gap-1.5 text-[var(--text-300)]">
            <Show when={props.entry.madeBy}>
              {(slug) => <IdentityAvatar seed={slug()} size={props.compact ? 14 : 16} class="shrink-0" />}
            </Show>
            <span class="truncate">
              {props.entry.at === null ? TYPE_NAMES[props.entry.type] : agoText(props.entry.at)}
            </span>
          </span>
        </span>
      </button>
      <a
        class="file-card-action"
        href={fileSrc(props.entry.space, props.entry.file.id)}
        download={props.entry.name}
        aria-label={`Save ${props.entry.name}`}
        title="Save"
        data-action="save-file"
      >
        <RemixIcon icon={DownloadIcon} size={16} />
      </a>
    </div>
  )
}
