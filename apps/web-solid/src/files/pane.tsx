import type { FileOp } from "@kiko/protocol"
import { FileIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createMemo, createSignal, lazy, onCleanup, onMount, Show, Suspense } from "solid-js"
import { dropFileSurfaces, fileReveal, moveFileSurfaces, openFile, showFileInTab } from "../chat/side/surfaces"
import { room } from "../state/room"
import { user } from "../state/user"
import { createFile, forgetMade, withMade } from "./api"
import { FileBreadcrumbs } from "./breadcrumbs"
import { SUBHEADER } from "./chrome"
import { explorerOpen, setExplorerOpen } from "./prefs"
import { FileExplorerPane } from "./explorer/pane"
import { retainedBreadcrumbTrail } from "./explorer/path"
import { viewerKind, type ViewerKind } from "./kind"
import { buildIndex, HOME, inHome, ROOT, strip, where } from "./model"
import { fullSize, setFullSize } from "./prefs"
import { FileActions, FileWorkspace } from "./surface"
import { FileTree, type FileTreeHandle } from "./tree"
import { createFileView, setSourceFor } from "./view"

const FileDialog = lazy(() => import("./FileDialog"))

function useChatFiles(chatId: () => string) {
  const home = createMemo(() => withMade(HOME, user.homeFiles()).map((f) => ({ ...f, name: `${HOME}/${f.name}` })))
  const files = createMemo(() => [...withMade(chatId(), room.files()), ...home()])
  const folders = createMemo(() => [...room.folders(), HOME, ...user.homeFolders().map((f) => `${HOME}/${f}`)])
  const index = createMemo(() =>
    buildIndex(
      files().map((f) => f.name),
      folders(),
    ),
  )
  return { files, folders, index }
}

function ExplorerTree(props: {
  chatId: string
  active?: string | null
  revealId?: number
  focusSearch?: boolean
  onOpen?: (path: string) => void
  onOpenInNewTab?: (path: string) => void
  ref?: (handle: FileTreeHandle) => void
}) {
  createEffect(() => onCleanup(room.onFilesRefused((_, reason) => showToastV2({ title: reason, variant: "error" }))))
  createEffect(() => onCleanup(user.onHomeRefused((_, reason) => showToastV2({ title: reason, variant: "error" }))))
  const op = (o: FileOp) => {
    const paths = o.op === "rm" ? o.paths : o.op === "mv" ? [o.from, o.to] : [o.path]
    const home = paths.map(inHome)
    if (home.some((h) => h !== home[0]))
      return showToastV2({
        title: "Moving between home and this chat is a copy. Download it, then add it here",
        variant: "error",
      })
    if (paths.includes(HOME)) return showToastV2({ title: "Home stays where it is", variant: "error" })
    if (!home[0]) return room.fileOp(o)
    user.homeOp(
      o.op === "rm"
        ? { ...o, paths: o.paths.map(strip) }
        : o.op === "mv"
          ? { ...o, from: strip(o.from), to: strip(o.to) }
          : { ...o, path: strip(o.path) },
    )
  }
  const { files, folders } = useChatFiles(() => props.chatId)
  const make = (p: string) => {
    const at = where(props.chatId, p)
    void createFile(at.space, at.path).then((made) => {
      if (!made) return
      setSourceFor(p)
      props.onOpenInNewTab?.(p)
    })
  }

  return (
    <FileTree
      ref={props.ref}
      roomId={props.chatId}
      focusSearch={props.focusSearch}
      files={files()}
      folders={folders()}
      active={props.active}
      revealId={props.revealId}
      onOpen={props.onOpen}
      onOpenInNewTab={props.onOpenInNewTab}
      onNewFolder={(p) => op({ op: "mkdir", path: p })}
      onNewFile={make}
      onRename={(from, to) => {
        op({ op: "mv", from, to })
        moveFileSurfaces(props.chatId, from, to)
        const at = where(props.chatId, from)
        forgetMade(at.space, at.path)
      }}
      onMove={(from, to) => {
        op({ op: "mv", from, to })
        moveFileSurfaces(props.chatId, from, to)
        const at = where(props.chatId, from)
        forgetMade(at.space, at.path)
      }}
      onDelete={(p, paths) => {
        op({ op: "rm", paths: [p], recursive: paths.length !== 1 || paths[0] !== p })
        dropFileSurfaces(props.chatId, p)
        const at = where(props.chatId, p)
        forgetMade(at.space, at.path)
      }}
    />
  )
}

export function FilesTree(props: { chatId: string; focusSearch?: boolean }) {
  return (
    <aside class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="File explorer" data-component="file-explorer">
      <Show when={props.chatId} keyed>
        {(chatId) => (
          <ExplorerTree
            chatId={chatId}
            focusSearch={props.focusSearch}
            onOpen={(p) => openFile(chatId, p)}
            onOpenInNewTab={(p) => openFile(chatId, p)}
          />
        )}
      </Show>
    </aside>
  )
}

export function FileSurface(props: { chatId: string; path?: string }) {
  let root!: HTMLDivElement
  let row!: HTMLDivElement
  const [shown, setShown] = createSignal(props.path ?? "")
  const [trail, setTrail] = createSignal(props.path ?? "")
  const [rootWidth, setRootWidth] = createSignal(0)
  const [rowWidth, setRowWidth] = createSignal(0)
  const { files, index } = useChatFiles(() => props.chatId)
  const folderView = () => shown() === ROOT || index().folders.has(shown())
  const file = createMemo(() => files().find((f) => f.name === shown()))
  const revealId = () => fileReveal(props.chatId, shown())?.n ?? 0

  createEffect(() => {
    if (!file() && !folderView() && room.activeId() === props.chatId && room.filesLive() && user.synced())
      dropFileSurfaces(props.chatId, props.path ?? "")
  })

  const kind = createMemo<ViewerKind>(() => {
    const f = file()
    return f ? viewerKind(f) : "other"
  })
  const view = createFileView(props.chatId, shown, file, kind)
  const navigate = (to: string) => {
    setShown(to)
    setTrail((current) => retainedBreadcrumbTrail(current, to))
    if (props.path !== undefined) showFileInTab(props.chatId, to)
  }
  const wantsExplorer = () => explorerOpen() ?? rootWidth() >= 640
  const toggleExplorer = () => setExplorerOpen(!wantsExplorer())

  createEffect(() => {
    const path = props.path
    if (path === undefined) return
    setShown(path)
    setTrail((current) => retainedBreadcrumbTrail(current, path))
  })

  onMount(() => {
    const watch = (el: HTMLElement, set: (width: number) => void) => {
      const observer = new ResizeObserver(([entry]) => entry && set(entry.contentRect.width))
      observer.observe(el)
      return () => observer.disconnect()
    }
    onCleanup(watch(root, setRootWidth))
    if (row) onCleanup(watch(row, setRowWidth))
  })

  onCleanup(() => setFullSize(false))

  if (!shown())
    return (
      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
        data-component="files-pane-empty"
      >
        <RemixIcon icon={FileIcon} size={24} class="text-[var(--text-300)]" />
        <p class="type-ui text-fg">Open files appear here</p>
        <p class="type-label text-[var(--text-300)]">Pick a file in the tree, or drop one here.</p>
      </div>
    )

  const explorer = () => (
    <ExplorerTree
      chatId={props.chatId}
      active={shown()}
      revealId={revealId()}
      onOpen={navigate}
      onOpenInNewTab={(p) => openFile(props.chatId, p)}
    />
  )

  return (
    <div
      ref={root}
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      data-component={folderView() ? "files-folder" : "files-pane"}
    >
      <div class={SUBHEADER} data-component="file-header">
        <FileBreadcrumbs
          current={shown()}
          trail={trail()}
          index={index()}
          unsaved={view.unsaved()}
          onNavigateFolder={navigate}
          onOpenFile={navigate}
        />
        <Show when={!folderView() && file()} keyed>
          {(f) => (
            <FileActions
              view={view}
              chatId={props.chatId}
              path={shown()}
              file={f}
              kind={kind()}
              onExpand={() => setFullSize(true)}
              explorer={{ open: wantsExplorer(), onToggle: toggleExplorer }}
            />
          )}
        </Show>
      </div>
      <Show
        when={!folderView()}
        fallback={<div class="flex min-h-0 flex-1 flex-col overflow-hidden">{explorer()}</div>}
      >
        <div ref={row} class="flex min-h-0 flex-1 overflow-hidden">
          <Show
            when={!fullSize()}
            fallback={
              <div
                class="flex min-w-0 flex-1 items-center justify-center p-6 text-center text-label text-fg3"
                data-component="file-full-size-note"
              >
                Open full size. Close it to return here.
              </div>
            }
          >
            <FileWorkspace chatId={props.chatId} path={shown()} file={file()} kind={kind()} view={view} />
          </Show>
          <Show when={fullSize()}>
            <Suspense>
              <FileDialog chatId={props.chatId} path={shown()} file={file()} kind={kind()} />
            </Suspense>
          </Show>
          <Show when={wantsExplorer() && !fullSize()}>
            <FileExplorerPane rowWidth={rowWidth()}>{explorer()}</FileExplorerPane>
          </Show>
        </div>
      </Show>
    </div>
  )
}
