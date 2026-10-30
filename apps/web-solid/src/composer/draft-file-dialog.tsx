import { FileIcon } from "@kiko/ui/file-icon"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon, TrashIcon } from "@kiko/ui/icons"
import { ModalV2 } from "@kiko/ui/v2/modal-v2"
import { createResource, Match, Show, Suspense, Switch } from "solid-js"
import { formatBytes } from "../chat/info/format"
import { PREVIEW_BYTES } from "../files/api"
import { NoPreview, SUBHEADER, SurfaceFailure, SurfaceLoading } from "../files/chrome"
import { TEXT_KINDS, viewerKind } from "../files/kind"
import type { PromptInputV2Attachment } from "./prompt-input/types"

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-control text-fg2 transition-colors duration-(--dur-hover) hover:bg-hover hover:text-fg"

function DraftText(props: { url: string }) {
  const [text] = createResource(
    () => props.url,
    async (url) => (await (await fetch(url)).blob()).slice(0, PREVIEW_BYTES).text(),
  )
  return (
    <Show when={!text.error} fallback={<SurfaceFailure message="Unable to read this file." />}>
      <pre
        class="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-code whitespace-pre-wrap break-words text-fg"
        data-component="draft-file-text"
      >
        {text()}
      </pre>
    </Show>
  )
}

export default function DraftFileDialog(props: {
  part: PromptInputV2Attachment
  onRemove: () => void
  onClose: () => void
}) {
  const kind = () => viewerKind({ name: props.part.filename, type: props.part.mime })
  return (
    <ModalV2 open onOpenChange={(open: boolean) => !open && props.onClose()}>
      <ModalV2.Portal>
        <ModalV2.Overlay />
        <ModalV2.Content
          class="h-[min(85vh,52rem)] w-[min(56rem,92vw)] flex-col overflow-hidden rounded-hero bg-bg shadow-2xl"
          data-component="draft-file-dialog"
          onOpenAutoFocus={(event: Event) => {
            const close = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-action="close-draft-file"]',
            )
            if (!close) return
            event.preventDefault()
            close.focus()
          }}
        >
          <div class={`${SUBHEADER} h-11 min-h-11`}>
            <FileIcon node={{ path: props.part.filename, type: "file" }} class="size-5" />
            <ModalV2.Title class="min-w-0 flex-1 truncate text-label font-medium text-fg">
              {props.part.filename}
            </ModalV2.Title>
            <span class="shrink-0 text-hint text-fg3">{formatBytes(props.part.size)}</span>
            <button
              type="button"
              aria-label="Remove from draft"
              data-action="remove-draft-file"
              class={ICON_BUTTON}
              onClick={() => props.onRemove()}
            >
              <RemixIcon icon={TrashIcon} size={16} />
            </button>
            <ModalV2.Close aria-label="Close preview" data-action="close-draft-file" class={ICON_BUTTON}>
              <RemixIcon icon={CloseIcon} size={16} />
            </ModalV2.Close>
          </div>
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Suspense fallback={<SurfaceLoading />}>
              <Switch fallback={<NoPreview name={props.part.filename} href={props.part.blob.url} />}>
                <Match when={TEXT_KINDS.has(kind()) || kind() === "mermaid"}>
                  <DraftText url={props.part.blob.url} />
                </Match>
                <Match when={kind() === "pdf"}>
                  <iframe title={props.part.filename} src={props.part.blob.url} class="min-h-0 flex-1 border-0" />
                </Match>
                <Match when={kind() === "audio"}>
                  <div class="flex min-h-0 flex-1 items-center justify-center p-6">
                    <audio
                      controls
                      src={props.part.blob.url}
                      aria-label={props.part.filename}
                      class="w-full max-w-md"
                    />
                  </div>
                </Match>
              </Switch>
            </Suspense>
          </div>
        </ModalV2.Content>
      </ModalV2.Portal>
    </ModalV2>
  )
}
