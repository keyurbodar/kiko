import type { FileOp } from "@kiko/protocol"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createMemo, lazy, onCleanup, Show, Suspense } from "solid-js"
import { dropFileSurfaces, moveFileSurfaces, openFile } from "../chat/side/surfaces"
import { room } from "../state/room"
import { user } from "../state/user"
import { createFile, forgetMade, withMade } from "./api"
import { FileBreadcrumbs } from "./breadcrumbs"
import { SUBHEADER } from "./chrome"
import { viewerKind, type ViewerKind } from "./kind"
import { buildIndex, HOME, inHome, strip, where } from "./model"
import { fullSize, setFullSize } from "./prefs"
import { FileActions, FileBody } from "./surface"
import { FileTree } from "./tree"
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

export function FilesTree(props: { chatId: string }) {
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
      openFile(props.chatId, p)
    })
  }

  return (
    <aside
      class="flex min-h-0 min-w-0 flex-1 flex-col px-2 pt-1 pb-2"
      aria-label="File explorer"
      data-component="file-explorer"
    >
      <Show when={props.chatId} keyed>
        {(chatId) => (
          <FileTree
            roomId={chatId}
            files={files()}
            folders={folders()}
            onNewFolder={(p) => op({ op: "mkdir", path: p })}
            onOpen={(p) => openFile(props.chatId, p)}
            onNewFile={make}
            onRename={(from, to) => {
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
        )}
      </Show>
    </aside>
  )
}

export function FileSurface(props: { chatId: string; path: string }) {
  const { files, index } = useChatFiles(() => props.chatId)
  const file = createMemo(() => files().find((f) => f.name === props.path))
  const kind = createMemo<ViewerKind>(() => {
    const f = file()
    return f ? viewerKind(f) : "other"
  })
  const view = createFileView(props.chatId, () => props.path, file, kind)
  onCleanup(() => setFullSize(false))

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-component="files-pane">
      <div class={SUBHEADER} data-component="file-header">
        <FileBreadcrumbs
          path={props.path}
          index={index()}
          unsaved={view.unsaved()}
          onOpen={(to) => openFile(props.chatId, to)}
        />
        <Show when={file()} keyed>
          {(f) => (
            <FileActions
              view={view}
              chatId={props.chatId}
              path={props.path}
              file={f}
              kind={kind()}
              onExpand={() => setFullSize(true)}
            />
          )}
        </Show>
      </div>
      <div class="flex min-h-0 flex-1 overflow-hidden">
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
          <FileBody chatId={props.chatId} path={props.path} file={file()} kind={kind()} view={view} />
        </Show>
        <Show when={fullSize()}>
          <Suspense>
            <FileDialog chatId={props.chatId} path={props.path} file={file()} kind={kind()} />
          </Suspense>
        </Show>
      </div>
    </div>
  )
}
