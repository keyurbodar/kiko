import { FileIcon } from "@yuki/ui/file-icon"
import { HugeIcon } from "@yuki/ui/huge-icon"
import { CopyIcon, FileIcon as OpenIcon } from "@yuki/ui/icons"
import { MenuV2 } from "@yuki/ui/v2/menu-v2"
import { showToastV2 } from "@yuki/ui/v2/toast-v2"
import { TooltipV2 } from "@yuki/ui/v2/tooltip-v2"
import type { JSX } from "solid-js"
import { useApp } from "../../lib/store"
import { openFile } from "../info/state"
import { basename, resolveFile, type FileTarget } from "../rich/file-links"

/** Where a named file is: the chat's own files first, then the user's home drive. */
function find(path: string) {
  const own = resolveFile(path, useApp.activeFiles().map((f) => f.name))
  return own.kind !== "none" ? own : resolveFile(path, useApp.homeFiles().map((f) => `home/${f.name}`))
}

/**
 * A file an agent's message names, as t3code's file mention: the file's icon and name in a
 * small tinted pill. A click opens it in the files tab. A name the chat has no file for draws
 * a dashed edge and says so on click. A name several files share opens the tree to pick from.
 */
export function FileChip(props: { file: FileTarget; label: string }): JSX.Element {
  const full = () => `${props.file.path}${props.file.line ? `:${props.file.line}` : ""}`
  const chat = () => useApp.activeThreadId()
  const open = () => {
    const id = chat()
    if (!id) return
    const found = find(props.file.path)
    if (found.kind === "file") return openFile(id, found.path, props.file.line)
    if (found.kind === "many") return openFile(id, null)
    showToastV2({ title: `No file named ${basename(props.file.path)} in this chat`, variant: "error" })
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full())
      showToastV2({ title: "Path copied", variant: "success" })
    } catch {
      showToastV2({ title: "Could not copy", description: "The clipboard is not available in this context", variant: "error" })
    }
  }
  return (
    <TooltipV2 class="file-chip-anchor" placement="top" value={<span class="font-mono">{full()}</span>}>
      <MenuV2.Context gutter={4}>
        <MenuV2.Context.Trigger
          as="button"
          type="button"
          class="file-chip"
          data-component="chat-file-chip"
          data-path={props.file.path}
          data-missing={find(props.file.path).kind === "none" ? "" : undefined}
          aria-label={`Open ${full()}`}
          onClick={open}
        >
          <FileIcon node={{ path: props.file.path, type: "file" }} />
          <span class="file-chip-label">{props.label}</span>
        </MenuV2.Context.Trigger>
        <MenuV2.Context.Portal>
          <MenuV2.Context.Content class="min-w-[160px]">
            <MenuV2.Item onSelect={open}>
              <HugeIcon icon={OpenIcon} class="size-3.5 shrink-0" aria-hidden="true" />
              Open
            </MenuV2.Item>
            <MenuV2.Item onSelect={() => void copy()}>
              <HugeIcon icon={CopyIcon} class="size-3.5 shrink-0" aria-hidden="true" />
              Copy path
            </MenuV2.Item>
          </MenuV2.Context.Content>
        </MenuV2.Context.Portal>
      </MenuV2.Context>
    </TooltipV2>
  )
}
