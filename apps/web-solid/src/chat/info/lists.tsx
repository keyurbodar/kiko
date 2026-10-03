import type { CatalogItem } from "@kiko/protocol"
import { createSignal, For, Show } from "solid-js"
import { stillOf, urls, useApp } from "../../lib/store"
import type { MediaItem } from "../../lib/types"
import { createMediaViewer } from "../media/mediaViewer"
import { peekLinkPreview, resolveLinkPreview } from "../lib/linkPreview"
import type { createCatalog } from "./catalog"
import { Card } from "./sections"
import { pushInfo } from "./state"

type Catalog = ReturnType<typeof createCatalog>
type Link = Extract<CatalogItem, { kind: "link" }>
type Media = Extract<CatalogItem, { kind: "media" }>

const rowClass = "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-text hover:bg-nav-hover"

// Link titles, from the shared preview resolver and its bounded cache. A page that cannot be
// previewed keeps its site name and path. The signal lives as long as the row that shows it.
function titleOf(url: string): () => string | undefined {
  const known = peekLinkPreview(url)
  const [title, setTitle] = createSignal<string | undefined>(known?.title?.trim().toLowerCase() || undefined)
  if (known === undefined)
    void resolveLinkPreview(url)
      .then((page) => setTitle(page?.title?.trim().toLowerCase() || undefined))
      .catch(() => {})
  return title
}

function LinkRow(props: { link: Link }) {
  const title = titleOf(props.link.url)
  const path = () => {
    try {
      const u = new URL(props.link.url)
      return `${u.pathname}${u.search}`.replace(/^\/$/, "")
    } catch {
      return ""
    }
  }
  return (
    <a
      class={rowClass}
      href={props.link.url}
      target="_blank"
      rel="noopener noreferrer"
      data-component="info-link"
      data-url={props.link.url}
    >
      <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-btn text-xs text-weak" aria-hidden="true">
        {props.link.site.slice(0, 1)}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate">{title() ?? `${props.link.site}${path()}`}</span>
        <span class="block truncate text-xs text-weak">{props.link.site}</span>
      </span>
    </a>
  )
}

function Empty(props: { loaded: boolean; text: string }) {
  return (
    <Show when={props.loaded}>
      <p class="px-2 py-2 text-sm text-weak">{props.text}</p>
    </Show>
  )
}

export function LinksList(props: { catalog: Catalog }) {
  const links = () => props.catalog.items().filter((i): i is Link => i.kind === "link")
  return (
    <div data-component="info-links">
      <For each={links()}>{(l) => <LinkRow link={l} />}</For>
      <Empty loaded={props.catalog.loaded() && !links().length} text="no links yet" />
      <MoreButton catalog={props.catalog} />
    </div>
  )
}

function MoreButton(props: { catalog: Catalog }) {
  return (
    <Show when={props.catalog.hasMore()}>
      <button type="button" class={`${rowClass} justify-center text-weak`} data-action="more" onClick={() => void props.catalog.more()}>
        show more
      </button>
    </Show>
  )
}

const mediaItem = (roomId: string, m: Media): MediaItem => ({
  kind: m.file.type.startsWith("video/") ? "video" : "photo",
  src: urls.file(roomId, m.file.id),
  width: m.file.width ?? 1600,
  height: m.file.height ?? 900,
  alt: m.file.name,
})

function Grid(props: { catalog: Catalog; max?: number }) {
  const viewer = createMediaViewer()
  const media = () => props.catalog.items().filter((i): i is Media => i.kind === "media")
  const shown = () => (props.max ? media().slice(0, props.max) : media())
  const roomId = () => useApp.room()?.state.roomId ?? ""
  return (
    <>
      <div class="grid grid-cols-4 gap-1 p-1" data-component="info-media-grid">
        <For each={shown()}>
          {(m, index) => (
            <button
              type="button"
              class="relative aspect-square overflow-hidden rounded-md bg-btn"
              data-component="info-media"
              data-thumb
              aria-label={`open ${m.file.name}`}
              onClick={() => viewer.open(media().map((x) => mediaItem(roomId(), x)), index())}
            >
              <svg class="absolute inset-0 m-auto text-faint" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 3.5h12v9H2zM2 10.5l3.5-3 3 2.5 2-1.5 3.5 3" />
              </svg>
              <Show when={stillOf(roomId(), m.file)}>
                {(src) => (
                  <img
                    class="relative size-full object-cover"
                    src={src()}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                  />
                )}
              </Show>
              <Show when={m.file.type.startsWith("video/")}>
                <span class="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">video</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      {viewer.view}
    </>
  )
}

export function MediaCard(props: { catalog: Catalog }) {
  const count = () => props.catalog.items().length
  return (
    <Card id="media" title="media" hint={count() ? String(count()) : undefined} onOpen={() => pushInfo({ kind: "media" })}>
      <Grid catalog={props.catalog} max={8} />
      <Show when={!count()}>
        <Empty loaded={props.catalog.loaded()} text="no photos or videos yet" />
      </Show>
    </Card>
  )
}

export function MediaList(props: { catalog: Catalog }) {
  return (
    <div data-component="info-media-list">
      <Grid catalog={props.catalog} />
      <Empty loaded={props.catalog.loaded() && !props.catalog.items().length} text="no photos or videos yet" />
      <MoreButton catalog={props.catalog} />
    </div>
  )
}
