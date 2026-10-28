import { fileName, type FileRef } from "@kiko/protocol"
import { RemixIcon } from "@kiko/ui/remix-icon"
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  InfoIcon,
  MaximizeIcon,
  MoreIcon,
  WrapTextIcon,
} from "@kiko/ui/icons"
import { MenuV2 } from "@kiko/ui/v2/menu-v2"
import { TabsPill, TabsV2 as Tabs } from "@kiko/ui/v2/tabs-v2"
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

const PREVIEW_LABEL = { markdown: "Preview", table: "Table", html: "Page" } as const

function ViewSwitch(props: { view: FileView; mode: keyof typeof PREVIEW_LABEL }) {
  const value = () => (props.view.rendered() ? "preview" : "source")
  return (
    <Tabs
      value={value()}
      onChange={(next) => next !== value() && props.view.toggleRendered(props.mode)}
      class="shrink-0"
      data-component="file-view-switch"
    >
      <Tabs.List class="file-view-switch shrink-0" aria-label="Show file as">
        <TabsPill />
        <Tabs.Trigger value="preview" class="file-view-tab" data-action="show-rendered">
          <RemixIcon icon={EyeIcon} size={12} />
          {PREVIEW_LABEL[props.mode]}
        </Tabs.Trigger>
        <Tabs.Trigger value="source" class="file-view-tab" data-action="show-source">
          <RemixIcon icon={CodeIcon} size={12} />
          Source
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs>
  )
}

function MoreActions(props: { wrap: boolean; onExpand?: () => void }) {
  return (
    <MenuV2 gutter={4} placement="bottom-end">
      <TooltipV2 placement="bottom" openDelay={500} value="More">
        <MenuV2.Trigger class={ACTION} aria-label="More file actions" data-action="file-more">
          <RemixIcon icon={MoreIcon} size={16} />
        </MenuV2.Trigger>
      </TooltipV2>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-44" data-component="file-more-menu">
          <Show when={props.wrap}>
            <MenuV2.CheckboxItem checked={wrap()} onChange={setWrap} data-action="toggle-wrap">
              <RemixIcon icon={WrapTextIcon} class="size-4 shrink-0" />
              <span class="flex-1">Wrap long lines</span>
            </MenuV2.CheckboxItem>
          </Show>
          <Show when={props.onExpand}>
            {(expand) => (
              <MenuV2.Item onSelect={() => expand()()} data-action="expand-file">
                <RemixIcon icon={MaximizeIcon} class="size-4 shrink-0" />
                <span class="flex-1">Open full size</span>
              </MenuV2.Item>
            )}
          </Show>
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
}) {
  const canWrap = () => TEXT_KINDS.has(props.kind) && !props.view.rendered()
  return (
    <>
      <Show when={props.view.mode()} keyed>
        {(mode) => <ViewSwitch view={props.view} mode={mode} />}
      </Show>
      {TEXT_KINDS.has(props.kind) && (
        <SurfaceAction
          label={props.view.copied() ? "Copied" : "Copy contents"}
          icon={props.view.copied() ? CheckIcon : CopyIcon}
          action="copy-file"
          onPress={props.view.copy}
        />
      )}
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
      <Show when={canWrap() || props.onExpand}>
        <MoreActions wrap={canWrap()} onExpand={props.onExpand} />
      </Show>
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
