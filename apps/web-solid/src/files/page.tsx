import { RemixIcon } from "@kiko/ui/remix-icon"
import { FilterHorizontalIcon, GridIcon, MenuIcon, PlusIcon, UploadIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { getRouteApi } from "@tanstack/solid-router"
import { createEffect, createMemo, createSignal, For, lazy, onMount, Show, Suspense } from "solid-js"
import {
  PageFrame,
  PageSearch,
  PageTabs,
  primaryButton,
  secondaryButton,
  SkeletonRows,
  ToolButton,
  toolButton,
} from "../customize/page-ui"
import { formatBytes } from "../chat/info/format"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { cn } from "../lib/cn"
import { agentDisplayName } from "../lib/names"
import { fileSrc, room } from "../state/room"
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
type Who = "all" | "yours" | "agents"
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

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)
const dirName = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

function entryOf(f: LibraryFile): Entry {
  const type = fileType(f.file)
  return { ...f, name: baseName(f.path), folder: dirName(f.path), type, group: groupOf(type) }
}

const compare: Record<Sort, (a: Entry, b: Entry) => number> = {
  recent: (a, b) => b.at - a.at || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  size: (a, b) => b.file.size - a.file.size || a.name.localeCompare(b.name),
  type: (a, b) => TYPE_NAMES[a.type].localeCompare(TYPE_NAMES[b.type]) || a.name.localeCompare(b.name),
}

const chatName = (roomId: string | null) =>
  roomId === null ? null : (room.chatById(roomId)?.name ?? user.chat(roomId)?.title ?? null)

function origin(e: Entry): string {
  const where = chatName(e.roomId)
  if (e.madeBy) {
    const who = agentDisplayName(e.madeBy, user.agents())
    return where ? `${who} made it in ${where}` : `${who} made it`
  }
  if (where) return `In ${where}`
  return e.folder === HOME ? "In your files" : `In ${e.folder.slice(HOME.length + 1)}`
}

function Thumb(props: { entry: Entry }) {
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={props.entry.type === "image" && !failed()}
      fallback={
        <TypeIcon
          type={props.entry.type}
          size={44}
          class="transition-transform duration-(--dur-pop) ease-kiko group-hover:scale-105"
        />
      }
    >
      <img
        src={fileSrc(props.entry.space, props.entry.file.id)}
        alt=""
        loading="lazy"
        draggable={false}
        class="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </Show>
  )
}

function Maker(props: { entry: Entry }) {
  return <Show when={props.entry.madeBy}>{(slug) => <IdentityAvatar seed={slug()} size={20} class="shrink-0" />}</Show>
}

function FolderArt() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true" class="text-fg3">
      <path
        d="M14 30a6 6 0 0 1 6-6h17l7 8h32a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6V30Z"
        fill="var(--active)"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linejoin="round"
      />
      <path d="M14 42h68" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
      <path d="M40 58h16M48 50v16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    </svg>
  )
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
        <RemixIcon icon={UploadIcon} size={15} />
        Upload
      </button>
    </>
  )
}

function Empty(props: { onFiles: (files: File[]) => void }) {
  return (
    <div class="flex flex-col items-center gap-2 px-6 py-14 text-center" data-component="files-empty">
      <FolderArt />
      <p class="type-row mt-2 text-fg">Nothing here yet</p>
      <p class="type-label text-fg3">Drop files anywhere on this page, or upload them.</p>
      <div class="mt-3">
        <Upload onFiles={props.onFiles} primary />
      </div>
    </div>
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
        <RemixIcon icon={FilterHorizontalIcon} size={17} />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="z-[80] min-w-48">
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
        <RemixIcon icon={PlusIcon} size={15} />
        New
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="z-[80] min-w-40">
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
          <button
            type="button"
            class={cn(
              "files-card group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-card bg-panel text-left outline-none",
              "transition-[background-color,transform] duration-(--dur-hover) hover:bg-hover active:scale-[0.98] focus-visible:bg-hover",
            )}
            data-file={e.path}
            data-fresh={isFresh(e.path) ? "" : undefined}
            onClick={() => props.open(e.key)}
          >
            <span class="relative grid aspect-[16/10] w-full place-items-center overflow-hidden bg-raise">
              <Thumb entry={e} />
            </span>
            <span class="flex min-w-0 flex-col gap-1 px-3.5 py-3">
              <span class="type-row truncate text-fg">{e.name}</span>
              <span class="flex min-w-0 items-center gap-1.5">
                <Maker entry={e} />
                <span class="type-label truncate text-fg3">{origin(e)}</span>
              </span>
            </span>
          </button>
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
            class="group flex h-12 cursor-pointer items-center gap-3 rounded-row px-3 text-left outline-none transition-colors duration-(--dur-hover) hover:bg-hover focus-visible:bg-hover"
            data-file={e.path}
            data-fresh={isFresh(e.path) ? "" : undefined}
            onClick={() => props.open(e.key)}
          >
            <TypeIcon type={e.type} size={24} />
            <span class="type-row min-w-0 flex-1 truncate text-fg">{e.name}</span>
            <span class="type-label hidden w-56 min-w-0 items-center gap-1.5 text-fg3 @min-[640px]/page:flex">
              <Maker entry={e} />
              <span class="truncate">{origin(e)}</span>
            </span>
            <span class="type-label hidden w-24 text-fg3 @min-[640px]/page:block">{TYPE_NAMES[e.type]}</span>
            <span class="type-hint w-16 text-right text-fg4">{formatBytes(e.file.size)}</span>
          </button>
        )}
      </For>
    </div>
  )
}

const route = getRouteApi("/files")

export default function FilesPage() {
  const asked = route.useSearch({ select: (search) => search.open })
  const [who, setWho] = createSignal<Who>("all")
  const [kind, setKind] = createSignal<Kind>("all")
  const [sort, setSort] = createSignal<Sort>("recent")
  const [view, setView] = createSignal<View>("grid")
  const [query, setQuery] = createSignal("")
  const [opened, setOpened] = createSignal<string | null>(null)
  onMount(library.use)

  const entries = createMemo(() => library.files().map(entryOf))
  const counts = createMemo(() => {
    const agents = entries().filter((e) => e.madeBy !== null).length
    return { agents, yours: entries().length - agents }
  })
  const whoTabs = createMemo(() => counts().agents > 0 && counts().yours > 0)
  const kinds = createMemo(() => {
    const present = new Set(entries().flatMap((e) => (e.group ? [e.group] : [])))
    return (Object.keys(GROUP_LABELS) as FileGroup[]).filter((g) => present.has(g))
  })
  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    const author = whoTabs() ? who() : "all"
    const type = kind() === "all" || kinds().includes(kind() as FileGroup) ? kind() : "all"
    return entries()
      .filter(
        (e) =>
          (author === "all" || (author === "agents") === (e.madeBy !== null)) &&
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
            <Show when={whoTabs()} fallback={<span />}>
              <PageTabs<Who>
                label="Show"
                value={who()}
                onChange={setWho}
                options={[
                  { value: "all", label: "All" },
                  { value: "yours", label: "Yours" },
                  { value: "agents", label: "Made by agents" },
                ]}
                data-component="files-filter"
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
                fallback={<p class="type-ui px-6 py-16 text-center text-fg3">Nothing matches.</p>}
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
