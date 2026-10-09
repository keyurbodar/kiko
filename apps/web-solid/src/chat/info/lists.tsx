import type { CatalogItem } from "@kiko/protocol"
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js"
import { stillOf, urls, useApp } from "../../lib/store"
import type { MediaItem } from "../../lib/types"
import { createMediaViewer } from "../media/mediaViewer"
import { peekLinkPreview, resolveLinkPreview } from "../lib/linkPreview"
import type { createCatalog } from "./catalog"
import { EDGE } from "./sections"

type Catalog = ReturnType<typeof createCatalog>
type Link = Extract<CatalogItem, { kind: "link" }>
type Media = Extract<CatalogItem, { kind: "media" }>

const rowClass = "flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[13px] text-text hover:bg-[color-mix(in_oklab,var(--text)_5%,transparent)]"

// Link titles, from the shared preview resolver and its bounded cache. A page that cannot be
// previewed keeps its site name and path. The signal lives as long as the row that shows it.
function titleOf(url: string): () => string | undefined {
  const known = peekLinkPreview(url)
  const [title, setTitle] = createSignal<string | undefined>(known?.title?.trim() || undefined)
  if (known === undefined)
    void resolveLinkPreview(url)
      .then((page) => setTitle(page?.title?.trim() || undefined))
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
      <span class="grid size-7 shrink-0 place-items-center rounded-md bg-[color-mix(in_oklab,var(--text)_7%,transparent)] text-[12px] text-weak uppercase" aria-hidden="true">
        {props.link.site.slice(0, 1)}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate">{title() ?? `${props.link.site}${path()}`}</span>
        <span class="block truncate text-[12px] text-[color-mix(in_oklab,var(--text)_40%,transparent)]">{props.link.site}</span>
      </span>
    </a>
  )
}

function Empty(props: { loaded: boolean; text: string }) {
  return (
    <Show when={props.loaded}>
      <p class="px-3 py-2 text-[12px] text-[color-mix(in_oklab,var(--text)_45%,transparent)]">{props.text}</p>
    </Show>
  )
}

export function LinksList(props: { catalog: Catalog }) {
  const links = () => props.catalog.items().filter((i): i is Link => i.kind === "link")
  return (
    <div data-component="info-links">
      <For each={links()}>{(l) => <LinkRow link={l} />}</For>
      <Empty loaded={props.catalog.loaded() && !links().length} text="No links yet" />
      <MoreButton catalog={props.catalog} />
    </div>
  )
}

function MoreButton(props: { catalog: Catalog }) {
  return (
    <Show when={props.catalog.hasMore()}>
      <button type="button" class={`${rowClass} justify-center text-weak`} data-action="more" onClick={() => void props.catalog.more()}>
        Show more
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
              aria-label={`Open ${m.file.name}`}
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
                <span class="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[10px] text-white">Video</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      {viewer.view}
    </>
  )
}

export function MediaList(props: { catalog: Catalog }) {
  return (
    <div data-component="info-media-list">
      <Grid catalog={props.catalog} />
      <Empty loaded={props.catalog.loaded() && !props.catalog.items().length} text="No photos or videos yet" />
      <MoreButton catalog={props.catalog} />
    </div>
  )
}

type SharedKind = "media" | "links"
const KIND_LABELS: Record<SharedKind, string> = { media: "Media", links: "Links" }

/*
 * What the chat has shared, as horizontal tabs. A tab shows only when its kind has something,
 * so a chat with nothing shared shows no section at all. Files are not here: they are the
 * panel's own files tab, the one place they open.
 */
export function SharedContent(props: { media: Catalog; links: Catalog }) {
  const kinds = (): SharedKind[] => {
    const list: SharedKind[] = []
    if (props.media.items().some((i) => i.kind === "media")) list.push("media")
    if (props.links.items().some((i) => i.kind === "link")) list.push("links")
    return list
  }
  const [picked, setPicked] = createSignal<SharedKind>("media")
  const shown = () => (kinds().includes(picked()) ? picked() : kinds()[0])
  createEffect(() => {
    const k = shown()
    if (k && k !== picked()) setPicked(k)
  })
  return (
    <Show when={kinds().length}>
      <section class={`border-t ${EDGE} px-2 pt-3 pb-4`} data-component="info-shared">
        {/* The section's label is its tabs: each kind a label of its own, the open one brighter. */}
        <div class="flex items-center gap-3 px-2 pb-2" role="tablist" aria-label="Shared">
          <For each={kinds()}>
            {(kind) => (
              <button
                type="button"
                role="tab"
                class="text-[11px] font-medium tracking-wide text-[color-mix(in_oklab,var(--text)_40%,transparent)] uppercase hover:text-[color-mix(in_oklab,var(--text)_75%,transparent)] aria-selected:text-[color-mix(in_oklab,var(--text)_75%,transparent)]"
                aria-selected={shown() === kind}
                data-tab={kind}
                onClick={() => setPicked(kind)}
              >
                {KIND_LABELS[kind]}
              </button>
            )}
          </For>
        </div>
        <Switch>
          <Match when={shown() === "media"}>
            <MediaList catalog={props.media} />
          </Match>
          <Match when={shown() === "links"}>
            <LinksList catalog={props.links} />
          </Match>
        </Switch>
      </section>
    </Show>
  )
}
