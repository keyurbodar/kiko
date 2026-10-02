import { useParams } from "@solidjs/router"
import { createEffect, createMemo, Show } from "solid-js"
import { withMade } from "../../files/api"
import { FileViewer } from "../../files/viewer"
import { useApp } from "../../lib/store"

/*
 * The files route. The sidebar column holds the chat picker and the file tree; this panel shows
 * the file the URL names (`/files/<room>/<path>`), as an editor, a media view, or a download.
 */
const decode = (raw: string) => {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export default function FilesRoute() {
  const params = useParams<{ chatId?: string; path?: string }>()
  createEffect(() => {
    const id = params.chatId
    if (id && id !== useApp.activeThreadId()) useApp.selectThread(id)
  })
  const path = createMemo(() => (params.path ? decode(params.path) : ""))
  const roomId = () => params.chatId ?? ""
  const files = createMemo(() => withMade(roomId(), useApp.activeFiles()))
  return (
    <Show
      when={path()}
      fallback={
        <div class="grid min-h-0 flex-1 place-items-center text-sm text-weak" data-component="files-empty">
          pick a file
        </div>
      }
    >
      {/* Keyed by path, so each file gets a fresh editor. */}
      <Show when={path()} keyed>
        {(p) => <FileViewer roomId={roomId()} path={p} files={files()} />}
      </Show>
    </Show>
  )
}
