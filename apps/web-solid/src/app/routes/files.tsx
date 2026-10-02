import { useParams } from "@solidjs/router"
import { createEffect, createMemo, Show } from "solid-js"
import { withMade } from "../../files/api"
import { FileViewer } from "../../files/viewer"
import { useApp } from "../../lib/store"
import { setDrawerOpen } from "../drawer"

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
          <div class="flex flex-col items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" class="text-accent" aria-hidden="true">
              <path d="M1.5 4.5v8h11l2-5.5H4l-2.5 5.5M1.5 4.5v-1h4l1.5 1.5h5.5V7" />
            </svg>
            <span>pick a file from the tree to open it</span>
            {/* Below 768 px the file list is the sidebar drawer, so say where it is and open it in one tap. */}
            <button
              type="button"
              class="h-10 rounded-[10px] bg-[var(--btn-bg)] px-4 text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:hidden"
              data-action="open-files"
              onClick={() => setDrawerOpen(true)}
            >
              browse files
            </button>
          </div>
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
