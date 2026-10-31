import { fileName } from "@kiko/protocol"
import { EmptyState } from "../settings/kit"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { FilterHorizontalIcon, GridIcon, MenuIcon, PlusIcon, UploadIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { getRouteApi } from "@tanstack/solid-router"
import { createEffect, createMemo, createSignal, For, lazy, onMount, Show, Suspense } from "solid-js"
import {
  PageFrame,
  PageSearch,
  primaryButton,
  secondaryButton,
  SkeletonRows,
  ToolButton,
  toolButton,
} from "../customize/page-ui"
import { formatBytes } from "../chat/info/format"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { user } from "../state/user"
import { putFile, rememberMade } from "./api"
import { viewerKind, type ViewerKind } from "./kind"
import { saveDropped, isFresh, type DropResult, uniqueName } from "./drop"
import { DropZone } from "./drop-zone"
import { library } from "./library"
import type { LibraryFile } from "./library-model"
import { HOME } from "./model"
import { setFullSize } from "./prefs"
import { type FileGroup, fileType, type FileType, GROUP_LABELS, groupOf, TYPE_NAMES } from "./type"
import { TypeIcon } from "./type-icon"
import { type CardFile, FileCard, toneOf } from "./card"
import { agoText } from "./edited"
import { authorFacets, byAuthor, knownAuthor, type Author } from "./author"
import { AuthorMenu } from "./author-menu"

function reportDrop(result: DropResult) {
  const count = result.saved.length
  if (count > 0)
    showToastV2({ title: `Saved ${count === 1 ? "1 file" : `${count} files`} to your files`, variant: "success" })
  const [first] = result.failed
  if (first)
    showToastV2({
      title: result.failed.length === 1 ? first.name : `${result.failed.length} files not saved`,
      description: result.failed.length === 1 ? first.reason : `${first.name}: ${first.reason}`,
      variant: "error",
    })
}

const FileDialog = lazy(() => import("./FileDialog"))

type Entry = LibraryFile & { name: string; folder: string; type: FileType; group: FileGroup | null }
type Sort = "recent" | "name" | "size" | "type"
type View = "grid" | "list"
type Kind = "all" | FileGroup

const SORTS: readonly { value: Sort; label: string }[] = [
  { value: "recent", label: "Newest" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "type", label: "Type" },
]

const BLANKS = [
  { label: "Doc", name: "Untitled.md", type: "text/markdown", body: "" },
  { label: "Sheet", name: "Untitled.csv", type: "text/csv", body: "Name,Notes\n" },
  { label: "List", name: "List.md", type: "text/markdown", body: "- [ ] \n" },
] as const

const dirName = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

function entryOf(f: LibraryFile): Entry {
  const type = fileType(f.file)
  return { ...f, name: fileName(f.path), folder: dirName(f.path), type, group: groupOf(type) }
}

const compare: Record<Sort, (a: Entry, b: Entry) => number> = {
  recent: (a, b) => b.at - a.at || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  size: (a, b) => b.file.size - a.file.size || a.name.localeCompare(b.name),
  type: (a, b) => TYPE_NAMES[a.type].localeCompare(TYPE_NAMES[b.type]) || a.name.localeCompare(b.name),
}

const chatName = (roomId: string | null) =>
  roomId === null ? null : (room.chatById(roomId)?.name ?? user.chat(roomId)?.title ?? null)

function place(e: Entry): string {
  const where = chatName(e.roomId)
  if (where) return where
  return e.folder === HOME ? "your files" : e.folder.slice(HOME.length + 1)
}

function cardOf(e: Entry): CardFile {
  return {
    space: e.space,
    file: e.file,
    name: e.name,
    type: e.type,
    madeBy: e.madeBy,
    maker: e.madeBy ? agentDisplayName(e.madeBy, user.agents()) : null,
    at: e.at,
    where: place(e),
  }
}

function Maker(props: { entry: Entry }) {
  return <Show when={props.entry.madeBy}>{(slug) => <IdentityAvatar seed={slug()} size={18} class="shrink-0" />}</Show>
}

function Upload(props: { onFiles: (files: File[]) => void; primary?: boolean }) {
  let input!: HTMLInputElement
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        class="hidden"
        data-action="upload-files-input"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          e.currentTarget.value = ""
          if (files.length) props.onFiles(files)
        }}
      />
      <button
        type="button"
        class={props.primary ? primaryButton : secondaryButton}
        data-action="upload-files"
        onClick={() => input.click()}
      >
        <RemixIcon icon={UploadIcon} size={16} />
        Upload
      </button>
    </>
  )
}

function Empty(props: { onFiles: (files: File[]) => void }) {
  return (
    <EmptyState
      art="folder"
      title="No files yet"
      line="Files from chats and uploads land here. Drop some anywhere on this page."
      action={<Upload onFiles={props.onFiles} primary />}
      data-component="files-empty"
    />
  )
}

function SortMenu(props: {
  sort: Sort
  onSort: (sort: Sort) => void
  kind: Kind
  kinds: readonly FileGroup[]
  onKind: (kind: Kind) => void
}) {
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger class={toolButton} aria-label="Sort and filter files" data-action="sort-files">
        <RemixIcon icon={FilterHorizontalIcon} size={16} />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-48">
          <MenuV2.Group>
            <MenuV2.GroupLabel>Sort by</MenuV2.GroupLabel>
            <MenuV2.RadioGroup value={props.sort} onChange={(v) => props.onSort(v as Sort)}>
              <For each={SORTS}>{(s) => <MenuV2.RadioItem value={s.value}>{s.label}</MenuV2.RadioItem>}</For>
            </MenuV2.RadioGroup>
          </MenuV2.Group>
          <Show when={props.kinds.length > 1}>
            <MenuV2.Separator />
            <MenuV2.Group>
              <MenuV2.GroupLabel>Show</MenuV2.GroupLabel>
              <MenuV2.RadioGroup value={props.kind} onChange={(v) => props.onKind(v as Kind)}>
                <For each={["all" as const, ...props.kinds]}>
                  {(k) => <MenuV2.RadioItem value={k}>{k === "all" ? "Every type" : GROUP_LABELS[k]}</MenuV2.RadioItem>}
                </For>
              </MenuV2.RadioGroup>
            </MenuV2.Group>
          </Show>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function NewMenu(props: { onNew: (blank: (typeof BLANKS)[number]) => void }) {
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <MenuV2.Trigger class={primaryButton} data-action="new-file">
        <RemixIcon icon={PlusIcon} size={16} />
        New
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-40">
          <For each={BLANKS}>{(b) => <MenuV2.Item onSelect={() => props.onNew(b)}>{b.label}</MenuV2.Item>}</For>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function GridView(props: { shown: readonly Entry[]; open: (key: string) => void }) {
  return (
    <div
      class="grid grid-cols-2 gap-3 @min-[640px]/page:grid-cols-3 @min-[900px]/page:grid-cols-4"
      data-component="files-grid"
    >
      <For each={props.shown}>
        {(e) => (
          <FileCard
            entry={cardOf(e)}
            onOpen={() => props.open(e.key)}
            attrs={{ "data-file": e.path, "data-fresh": isFresh(e.path) ? "" : undefined }}
          />
        )}
      </For>
    </div>
  )
}

function ListView(props: { shown: readonly Entry[]; open: (key: string) => void }) {
  return (
    <div class="flex flex-col gap-0.5" data-component="files-list">
      <For each={props.shown}>
        {(e) => (
          <button
            type="button"
            class="group flex h-12 cursor-pointer items-center gap-3 rounded-base px-3 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-tertiary focus-visible:bg-tertiary"
            data-file={e.path}
            data-fresh={isFresh(e.path) ? "" : undefined}
            onClick={() => props.open(e.key)}
          >
            <span
              class="grid size-8 shrink-0 place-items-center rounded-base transition-colors duration-(--duration-fast)"
              style={{ background: `color-mix(in oklab, ${toneOf(e.name)} 14%, var(--bg-editor))` }}
            >
              <TypeIcon type={e.type} size={16} />
            </span>
            <span class="type-base min-w-0 flex-1 truncate text-primary">{e.name}</span>
            <span
              class="type-sm hidden w-56 min-w-0 items-center gap-1.5 text-tertiary @min-[640px]/page:flex"
              title={
                e.madeBy ? `${agentDisplayName(e.madeBy, user.agents())} made it in ${place(e)}` : `In ${place(e)}`
              }
            >
              <Maker entry={e} />
              <span class="truncate">{agoText(e.at)}</span>
            </span>
            <span class="type-sm hidden w-24 text-tertiary @min-[640px]/page:block">{TYPE_NAMES[e.type]}</span>
            <span class="type-xs w-16 text-right text-quaternary">{formatBytes(e.file.size)}</span>
          </button>
        )}
      </For>
    </div>
  )
}

const route = getRouteApi("/_chat/files")

export default function FilesPage() {
  const asked = route.useSearch({ select: (search) => search.open })
  const [author, setAuthor] = createSignal<Author>("all")
  const [kind, setKind] = createSignal<Kind>("all")
  const [sort, setSort] = createSignal<Sort>("recent")
  const [view, setView] = createSignal<View>("grid")
  const [query, setQuery] = createSignal("")
  const [opened, setOpened] = createSignal<string | null>(null)
  onMount(library.use)

  const entries = createMemo(() => library.files().map(entryOf))
  const facets = createMemo(() => authorFacets(entries()))
  const kinds = createMemo(() => {
    const present = new Set(entries().flatMap((e) => (e.group ? [e.group] : [])))
    return (Object.keys(GROUP_LABELS) as FileGroup[]).filter((g) => present.has(g))
  })
  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    const from = knownAuthor(author(), facets())
    const type = kind() === "all" || kinds().includes(kind() as FileGroup) ? kind() : "all"
    return entries()
      .filter(
        (e) =>
          byAuthor(from, e) &&
          (type === "all" || e.group === type) &&
          words.every((w) => `${e.path} ${chatName(e.roomId) ?? ""} ${TYPE_NAMES[e.type]}`.toLowerCase().includes(w)),
      )
      .sort(compare[sort()])
  })
  const file = createMemo(() => entries().find((e) => e.key === opened()))
  const kindOf = createMemo<ViewerKind>(() => {
    const f = file()
    return f ? viewerKind(f.file) : "other"
  })
  let handled: string | undefined
  createEffect(() => {
    const path = asked()
    if (!path || path === handled) return
    const hit = entries().find((e) => e.path === path)
    if (!hit) return
    handled = path
    open(hit.key)
  })
  const homeNames = () => new Set(entries().flatMap((e) => (e.roomId === null ? [e.file.name] : [])))
  const saveFiles = async (files: File[]) => reportDrop(await saveDropped(HOME, files, homeNames()))
  const createBlank = async (blank: (typeof BLANKS)[number]) => {
    const name = uniqueName(blank.name, homeNames())
    const saved = await putFile(HOME, name, blank.body, blank.type, "none")
    if (saved.kind !== "saved")
      return void showToastV2({
        title: `Could not create ${name}`,
        description: saved.kind === "error" ? saved.message : undefined,
        variant: "error",
      })
    rememberMade(HOME, saved.file)
    open(`${HOME}:${name}`)
  }
  function open(key: string) {
    setFullSize(false)
    setOpened(key)
  }

  return (
    <DropZone folder={HOME} onFiles={(files) => void saveFiles(files)}>
      <PageFrame title="Files">
        <div class="flex flex-col gap-6 pt-4" data-component="files-page">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <Show when={facets().agents.length || facets().chats.length} fallback={<span />}>
              <AuthorMenu
                value={knownAuthor(author(), facets())}
                facets={facets()}
                total={entries().length}
                onChange={setAuthor}
              />
            </Show>
            <div class="flex items-center gap-1">
              <PageSearch label="Search files" query={query()} onQuery={setQuery} />
              <SortMenu sort={sort()} onSort={setSort} kind={kind()} kinds={kinds()} onKind={setKind} />
              <ToolButton
                label={view() === "grid" ? "Show as list" : "Show as grid"}
                icon={view() === "grid" ? MenuIcon : GridIcon}
                onClick={() => setView(view() === "grid" ? "list" : "grid")}
              />
              <span class="ml-1 flex items-center gap-2">
                <Upload onFiles={(files) => void saveFiles(files)} />
                <NewMenu onNew={(blank) => void createBlank(blank)} />
              </span>
            </div>
          </div>

          <Show
            when={entries().length || (user.synced() && !library.loading())}
            fallback={<SkeletonRows count={4} grid />}
          >
            <Show when={entries().length} fallback={<Empty onFiles={(files) => void saveFiles(files)} />}>
              <Show
                when={shown().length}
                fallback={
                  <EmptyState
                    art="search"
                    title="No results"
                    line="Try another name, or clear the filter."
                    data-component="files-no-match"
                  />
                }
              >
                <Show when={view() === "grid"} fallback={<ListView shown={shown()} open={open} />}>
                  <GridView shown={shown()} open={open} />
                </Show>
              </Show>
            </Show>
          </Show>
        </div>
        <Show when={file()} keyed>
          {(f) => (
            <Suspense>
              <FileDialog
                chatId={f.roomId ?? user.kikoChatId() ?? ""}
                path={f.path}
                file={f.file}
                kind={kindOf()}
                onClose={() => setOpened(null)}
              />
            </Suspense>
          )}
        </Show>
      </PageFrame>
    </DropZone>
  )
}
