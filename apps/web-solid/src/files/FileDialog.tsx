import { fileName, type FileRef } from "@kiko/protocol"
import { FileIcon } from "@kiko/ui/file-icon"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon } from "@kiko/ui/icons"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { Show } from "solid-js"
import { SUBHEADER } from "./chrome"
import type { ViewerKind } from "./kind"
import { setFullSize } from "./prefs"
import { FileActions, FileWorkspace } from "./surface"
import { createFileView } from "./view"

export default function FileDialog(props: {
  chatId: string
  path: string
  file: FileRef | undefined
  kind: ViewerKind
  onClose?: () => void
}) {
  const view = createFileView(
    props.chatId,
    () => props.path,
    () => props.file,
    () => props.kind,
  )
  return (
    <ModalV2
      open
      onOpenChange={(open: boolean) => {
        if (open) return
        setFullSize(false)
        props.onClose?.()
      }}
    >
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="h-[88vh] w-[min(64rem,92vw)] flex-col overflow-hidden rounded-sheet bg-bg shadow-2xl"
          data-component="file-dialog"
        >
          <div class={`${SUBHEADER} h-11 min-h-11`}>
            <FileIcon node={{ path: props.path, type: "file" }} class="size-5" />
            <ModalV2.Title class="min-w-0 flex-1 truncate text-label font-medium text-fg">
              {fileName(props.path)}
            </ModalV2.Title>
            <Show when={props.file} keyed>
              {(file) => (
                <FileActions view={view} chatId={props.chatId} path={props.path} file={file} kind={props.kind} />
              )}
            </Show>
            <ModalV2.Close
              aria-label="Close full size file"
              data-action="close-file-dialog"
              class="grid size-7 shrink-0 place-items-center rounded-control text-fg2 transition-colors duration-(--dur-hover) hover:bg-hover hover:text-fg"
            >
              <RemixIcon icon={CloseIcon} size={14} />
            </ModalV2.Close>
          </div>
          <div class="flex min-h-0 flex-1 overflow-hidden">
            <FileWorkspace chatId={props.chatId} path={props.path} file={props.file} kind={props.kind} view={view} />
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
