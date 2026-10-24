import { RemixIcon } from "@kiko/ui/remix-icon"
import { For, Show } from "solid-js"
import { formatBytes } from "../chat/info/format"
import { EntryIcon } from "../lib/EntryIcon"
import { fileSrc } from "../state/room"
import { basename } from "../files/model"
import type { RowAction } from "../commands/registry"
import { iconFor } from "./model"
import type { FileEntry } from "./sources"

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

export function Actions(props: {
  actions: readonly RowAction[]
  at: number
  onAt: (index: number) => void
  onRun: (action: RowAction) => void
}) {
  return (
    <div class="palette-side palette-actions" role="menu" data-component="palette-actions">
      <For each={props.actions}>
        {(action, i) => (
          <button
            type="button"
            role="menuitem"
            class="palette-action"
            data-active={props.at === i() ? "" : undefined}
            data-danger={action.danger ? "" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onPointerMove={() => props.onAt(i())}
            onClick={() => props.onRun(action)}
          >
            <RemixIcon icon={iconFor(action.icon)} size={16} />
            {action.title}
          </button>
        )}
      </For>
    </div>
  )
}

export function Peek(props: { entry: FileEntry }) {
  return (
    <div class="palette-side palette-peek" data-component="palette-peek">
      <div class="palette-peek-frame">
        <Show
          when={IMAGE.test(props.entry.path)}
          fallback={
            <span class="palette-peek-icon">
              <EntryIcon path={props.entry.path} />
            </span>
          }
        >
          <img src={fileSrc(props.entry.space, props.entry.fileId)} alt="" />
        </Show>
      </div>
      <div class="palette-peek-name">{basename(props.entry.path)}</div>
      <div class="palette-peek-meta">{formatBytes(props.entry.size)}</div>
    </div>
  )
}
