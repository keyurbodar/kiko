import type { FileRef } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CheckIcon, GridIcon, MenuIcon, SettingsIcon } from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createMemo, createSignal, For, lazy, Show, Suspense } from "solid-js"
import { PageFrame, PageSearch, PageTabs, SkeletonRows, ToolButton } from "../customize/page-ui"
import { formatBytes } from "../chat/info/format"
import { cn } from "../lib/cn"
import { fileSrc, room } from "../state/room"
import { user } from "../state/user"
import { withMade } from "./api"
import { viewerKind, type ViewerKind } from "./kind"
import { saveDropped, isFresh, type DropResult } from "./drop"
import { DropZone } from "./drop-zone"
import { HOME, inHome, isHidden, strip, where } from "./model"
import { setFullSize } from "./prefs"
import { type FileGroup, fileType, type FileType, GROUP_LABELS, groupOf, TYPE_NAMES } from "./type"
import { TypeIcon } from "./type-icon"

function reportDrop(result: DropResult) {
  const count = result.saved.length
  if (count > 0)
    showToastV2({ title: `Saved ${count === 1 ? "1 file" : `${count} files`} to ${HOME}`, variant: "success" })
  const [first] = result.failed
  if (first)
    showToastV2({
      title: result.failed.length === 1 ? first.name : `${result.failed.length} files not saved`,
      description: result.failed.length === 1 ? first.reason : `${first.name}: ${first.reason}`,
      variant: "error",
    })
}

const FileDialog = lazy(() => import("./FileDialog"))

type Entry = { path: string; name: string; folder: string; file: FileRef; type: FileType; group: FileGroup | null }
type Sort = "name" | "size" | "type"
type View = "grid" | "list"
type Filter = "all" | FileGroup

const SORTS: readonly { value: Sort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
  { value: "type", label: "Type" },
]

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)
const dirName = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")

function entryOf(path: string, file: FileRef): Entry {
  const type = fileType(file)
  const dir = dirName(path)
  return { path, name: baseName(path), folder: dir === "" ? "" : dir, file, type, group: groupOf(type) }
}

const compare: Record<Sort, (a: Entry, b: Entry) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  size: (a, b) => b.file.size - a.file.size || a.name.localeCompare(b.name),
  type: (a, b) => TYPE_NAMES[a.type].localeCompare(TYPE_NAMES[b.type]) || a.name.localeCompare(b.name),
}

function Thumb(props: { entry: Entry; space: string }) {
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={props.entry.type === "image" && !failed()}
      fallback={
        <TypeIcon
          type={props.entry.type}
          size={44}
          class="transition-transform duration-[var(--dur-pop)] ease-[var(--ease-kiko)] group-hover:scale-105"
        />
      }
    >
      <img
        src={fileSrc(props.space, props.entry.file.id)}
        alt=""
        loading="lazy"
        draggable={false}
        class="size-full object-cover"
        onError={() => setFailed(true)}
      />
    </Show>
  )
}

export default function FilesPage() {
  const [filter, setFilter] = createSignal<Filter>("all")
  const [sort, setSort] = createSignal<Sort>("name")
  const [view, setView] = createSignal<View>("grid")
  const [query, setQuery] = createSignal("")
  const [opened, setOpened] = createSignal<string | null>(null)

  const chatId = () => room.activeId() ?? user.kikoChatId() ?? ""
  const entries = createMemo<Entry[]>(() => {
    const home = withMade(HOME, user.homeFiles()).map((f) => entryOf(`${HOME}/${f.name}`, f))
    const own = room.activeId() ? room.files().map((f) => entryOf(f.name, f)) : []
    return [...home, ...own].filter((e) => !isHidden(e.path))
  })
  const groups = createMemo(() => {
    const present = new Set(entries().flatMap((e) => (e.group ? [e.group] : [])))
    return (Object.keys(GROUP_LABELS) as FileGroup[]).filter((g) => present.has(g))
  })
  const shown = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean)
    const current = filter()
    return entries()
      .filter(
        (e) =>
          (current === "all" || e.group === current) &&
          words.every((w) => `${e.path} ${TYPE_NAMES[e.type]}`.toLowerCase().includes(w)),
      )
      .sort(compare[sort()])
  })
  const tab = () => (filter() === "all" || groups().includes(filter() as FileGroup) ? filter() : "all")
  const file = createMemo(() => entries().find((e) => e.path === opened()))
  const kind = createMemo<ViewerKind>(() => {
    const f = file()
    return f ? viewerKind(f.file) : "other"
  })
  const dropFiles = async (files: File[]) => {
    const taken = new Set(
      entries()
        .filter((e) => inHome(e.path))
        .map((e) => strip(e.path)),
    )
    reportDrop(await saveDropped(HOME, files, taken))
  }
  const space = (e: Entry) => where(chatId(), e.path).space
  const open = (path: string) => {
    setFullSize(false)
    setOpened(path)
  }

  return (
    <DropZone folder={HOME} onFiles={(files) => void dropFiles(files)}>
      <PageFrame title="Files">
        <div class="flex flex-col gap-6 pt-4" data-component="files-page">
          <div class="flex items-center justify-between gap-3">
            <PageTabs<Filter>
              label="Show"
              value={tab()}
              onChange={setFilter}
              options={[{ value: "all", label: "All" }, ...groups().map((g) => ({ value: g, label: GROUP_LABELS[g] }))]}
              data-component="files-filter"
            />
            <div class="flex items-center gap-1">
              <PageSearch label="Search files" query={query()} onQuery={setQuery} />
              <MenuV2 gutter={4} placement="bottom-end">
                <MenuV2.Trigger
                  class="grid size-8 cursor-pointer place-items-center rounded-[9px] text-fg2 transition-[background-color,color,transform] duration-[var(--dur-hover)] hover:bg-hover hover:text-fg active:scale-[0.97]"
                  aria-label="Sort files"
                  data-action="sort-files"
                >
                  <RemixIcon icon={SettingsIcon} size={17} />
                </MenuV2.Trigger>
                <MenuV2.Portal>
                  <MenuV2.Content class="z-[80]">
                    <For each={SORTS}>
                      {(s) => (
                        <MenuV2.Item onSelect={() => setSort(s.value)}>
                          <span class="flex w-full items-center justify-between gap-6">
                            {s.label}
                            <Show when={sort() === s.value}>
                              <RemixIcon icon={CheckIcon} size={14} />
                            </Show>
                          </span>
                        </MenuV2.Item>
                      )}
                    </For>
                  </MenuV2.Content>
                </MenuV2.Portal>
              </MenuV2>
              <ToolButton
                label={view() === "grid" ? "Show as list" : "Show as grid"}
                icon={view() === "grid" ? MenuIcon : GridIcon}
                onClick={() => setView(view() === "grid" ? "list" : "grid")}
              />
            </div>
          </div>

          <Show when={user.synced() || entries().length} fallback={<SkeletonRows count={4} grid />}>
            <Show
              when={shown().length}
              fallback={
                <p class="px-6 py-16 text-center text-[15px] text-fg2" data-component="files-empty">
                  <Show when={entries().length} fallback="No files yet. Files your agents make show up here.">
                    Nothing matches.
                  </Show>
                </p>
              }
            >
              <Show
                when={view() === "grid"}
                fallback={
                  <div class="flex flex-col gap-0.5" data-component="files-list">
                    <For each={shown()}>
                      {(e) => (
                        <button
                          type="button"
                          class="group flex h-12 cursor-pointer items-center gap-3 rounded-pop px-3 text-left outline-none transition-colors duration-[var(--dur-hover)] hover:bg-hover focus-visible:bg-hover"
                          data-file={e.path}
                          data-fresh={isFresh(e.path) ? "" : undefined}
                          onClick={() => open(e.path)}
                        >
                          <TypeIcon type={e.type} size={24} />
                          <span class="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{e.name}</span>
                          <span class="hidden w-40 truncate text-[13px] text-fg4 @min-[640px]/page:block">
                            {e.folder}
                          </span>
                          <span class="hidden w-24 text-[13px] text-fg3 @min-[640px]/page:block">
                            {TYPE_NAMES[e.type]}
                          </span>
                          <span class="w-16 text-right text-[13px] text-fg4">{formatBytes(e.file.size)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                }
              >
                <div
                  class="grid grid-cols-2 gap-3 @min-[640px]/page:grid-cols-3 @min-[900px]/page:grid-cols-4"
                  data-component="files-grid"
                >
                  <For each={shown()}>
                    {(e) => (
                      <button
                        type="button"
                        class={cn(
                          "group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl bg-panel text-left outline-none",
                          "transition-[background-color,transform] duration-[var(--dur-hover)] hover:bg-raise active:scale-[0.98] focus-visible:bg-raise",
                        )}
                        data-file={e.path}
                        data-fresh={isFresh(e.path) ? "" : undefined}
                        onClick={() => open(e.path)}
                      >
                        <span class="relative grid aspect-[16/10] w-full place-items-center overflow-hidden bg-raise">
                          <Thumb entry={e} space={space(e)} />
                        </span>
                        <span class="flex min-w-0 flex-col px-3.5 py-3">
                          <span class="truncate text-[13.5px] leading-5 font-semibold text-fg">{e.name}</span>
                          <span class="truncate text-[12.5px] leading-[18px] text-fg3">
                            {formatBytes(e.file.size)}
                            {e.folder ? `, ${e.folder}` : ""}
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
        <Show when={file()} keyed>
          {(f) => (
            <Suspense>
              <FileDialog chatId={chatId()} path={f.path} file={f.file} kind={kind()} onClose={() => setOpened(null)} />
            </Suspense>
          )}
        </Show>
      </PageFrame>
    </DropZone>
  )
}
