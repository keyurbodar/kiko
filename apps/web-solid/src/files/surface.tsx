import { fileName, type FileRef } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  FolderTreeIcon,
  InfoIcon,
  MaximizeIcon,
  MoreIcon,
  TableIcon,
  WrapTextIcon,
} from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { onCleanup, onMount, Show } from "solid-js"
import { fileSrc } from "../state/room"
import { ACTION, SurfaceAction } from "./chrome"
import { TEXT_KINDS, type ViewerKind } from "./kind"
import { where } from "./model"
import { aboutOpen, setAboutOpen, setRoomy, wrap, setWrap } from "./prefs"
import { FileAbout } from "./about"
import { FileViewer } from "./viewer"
import type { FileView } from "./view"

type RenderedMode = "markdown" | "table" | "html"

function renderedLabel(mode: RenderedMode, rendered: boolean): string {
  if (mode === "markdown") return rendered ? "Show markdown source" : "Show rendered markdown"
  if (mode === "table") return rendered ? "Show source" : "Show table"
  return rendered ? "Show HTML source" : "Show rendered page"
}

function MoreActions(props: { onExpand: () => void }) {
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <TooltipV2 placement="bottom" openDelay={500} value="More">
        <MenuV2.Trigger class={ACTION} aria-label="More file actions" data-action="file-more">
          <RemixIcon icon={MoreIcon} class="size-3.5" />
        </MenuV2.Trigger>
      </TooltipV2>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-44" data-component="file-more-menu">
          <MenuV2.Item onSelect={() => props.onExpand()} data-action="expand-file">
            <RemixIcon icon={MaximizeIcon} class="size-4 shrink-0" />
            <span class="flex-1">Open full size</span>
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

export function FileActions(props: {
  view: FileView
  chatId: string
  path: string
  file: FileRef
  kind: ViewerKind
  onExpand?: () => void
  explorer?: { open: boolean; onToggle: () => void }
}) {
  const rawText = () => TEXT_KINDS.has(props.kind) && !props.view.rendered()
  return (
    <>
      <Show when={props.view.mode()}>
        {(mode) => (
          <SurfaceAction
            label={renderedLabel(mode(), props.view.rendered())}
            icon={props.view.rendered() ? CodeIcon : mode() === "table" ? TableIcon : EyeIcon}
            action="toggle-rendered"
            pressed={props.view.rendered()}
            onPress={() => props.view.toggleRendered(mode())}
          />
        )}
      </Show>
      <Show when={rawText()}>
        <SurfaceAction
          label={wrap() ? "Disable word wrap" : "Enable word wrap"}
          icon={WrapTextIcon}
          action="toggle-wrap"
          pressed={wrap()}
          onPress={() => setWrap(!wrap())}
        />
      </Show>
      <Show when={props.explorer}>
        {(explorer) => (
          <SurfaceAction
            label={explorer().open ? "Hide file explorer" : "Show file explorer"}
            icon={FolderTreeIcon}
            action="toggle-explorer"
            pressed={explorer().open}
            onPress={explorer().onToggle}
          />
        )}
      </Show>
      <Show when={TEXT_KINDS.has(props.kind)}>
        <SurfaceAction
          label={props.view.copied() ? "Copied" : "Copy contents"}
          icon={props.view.copied() ? CheckIcon : CopyIcon}
          action="copy-file"
          onPress={props.view.copy}
        />
      </Show>
      <SurfaceAction
        label="About this file"
        icon={InfoIcon}
        action="toggle-about"
        pressed={aboutOpen()}
        onPress={() => setAboutOpen(!aboutOpen())}
      />
      <SurfaceAction
        label={`Save ${fileName(props.path)}`}
        icon={DownloadIcon}
        action="download-file"
        href={fileSrc(where(props.chatId, props.path).space, props.file.id)}
        download={fileName(props.path)}
      />
      <Show when={props.onExpand}>{(expand) => <MoreActions onExpand={() => expand()()} />}</Show>
    </>
  )
}

function FileBody(props: {
  chatId: string
  path: string
  file: FileRef | undefined
  kind: ViewerKind
  view: FileView
}) {
  const at = () => where(props.chatId, props.path)
  return (
    <section
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={fileName(props.path)}
      data-component="file-surface"
    >
      <FileViewer
        roomId={at().space}
        path={at().path}
        file={props.file && { ...props.file, name: at().path }}
        kind={props.kind}
        rendered={props.view.rendered()}
        wrap={wrap()}
        reveal={props.view.reveal()}
        onEditorState={props.view.setEditor}
      />
    </section>
  )
}

export function FileWorkspace(props: {
  chatId: string
  path: string
  file: FileRef | undefined
  kind: ViewerKind
  view: FileView
}) {
  let box!: HTMLDivElement
  onMount(() => {
    const watch = new ResizeObserver(([entry]) => entry && setRoomy(entry.contentRect.width >= 680))
    watch.observe(box)
    onCleanup(() => watch.disconnect())
  })
  return (
    <div ref={box} class="@container/file flex min-h-0 min-w-0 flex-1" data-component="file-workspace">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col @min-[680px]/file:flex-row">
        <FileBody chatId={props.chatId} path={props.path} file={props.file} kind={props.kind} view={props.view} />
        <Show when={aboutOpen()}>
          <aside
            class="max-h-[36%] shrink-0 overflow-y-auto bg-side @min-[680px]/file:max-h-none @min-[680px]/file:w-[260px]"
            data-component="file-about-panel"
          >
            <FileAbout chatId={props.chatId} path={props.path} file={props.file} />
          </aside>
        </Show>
      </div>
    </div>
  )
}
