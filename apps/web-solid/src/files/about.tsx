import { fileName, type FileRef } from "@kiko/protocol"
import { createMemo, onMount, Show, type JSX } from "solid-js"
import { formatBytes } from "../chat/info/format"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { agentDisplayName } from "../lib/names"
import { room } from "../state/room"
import { user } from "../state/user"
import { editedText } from "./edited"
import { library } from "./library"
import { HOME, where } from "./model"
import { recipeSlugOf } from "../recipes/doc"
import { fileType, TYPE_NAMES } from "./type"

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 py-1" data-row={props.label}>
      <dt class="type-xs text-[var(--text-tertiary)]">{props.label}</dt>
      <dd class="type-sm m-0 flex min-w-0 items-center gap-2 text-primary">{props.children}</dd>
    </div>
  )
}

export function FileAbout(props: { chatId: string; path: string; file: FileRef | undefined }) {
  onMount(library.want)
  const at = () => where(props.chatId, props.path)
  const fact = createMemo(() => {
    const id = props.file?.id
    return id ? library.files().find((f) => f.file.id === id) : undefined
  })
  const usedIn = () => {
    const space = at().space
    if (space === HOME) return "Your files"
    return room.chatById(space)?.name ?? user.chat(space)?.title ?? null
  }
  const maker = () => fact()?.madeBy ?? null
  const edited = () => fact()?.at
  return (
    <section class="flex min-w-0 flex-col gap-2 px-4 py-4" aria-label="About this file" data-component="file-about">
      <h3 class="type-sm m-0 font-medium text-primary">About this file</h3>
      <dl class="m-0 flex flex-col">
        <Row label="Type">
          {recipeSlugOf(props.path)
            ? "Recipe"
            : TYPE_NAMES[fileType({ name: fileName(props.path), type: props.file?.type ?? "" })]}
        </Row>
        <Show when={props.file}>{(file) => <Row label="Size">{formatBytes(file().size)}</Row>}</Show>
        <Show when={fact()}>
          <Row label="Made by">
            <Show when={maker()} fallback="You">
              {(slug) => (
                <>
                  <IdentityAvatar seed={slug()} size={20} />
                  <span class="truncate">{agentDisplayName(slug(), user.agents())}</span>
                </>
              )}
            </Show>
          </Row>
        </Show>
        <Show when={edited()}>{(time) => <Row label="Edited">{editedText(time())}</Row>}</Show>
        <Show when={usedIn()}>{(name) => <Row label="Used in">{<span class="truncate">{name()}</span>}</Row>}</Show>
      </dl>
    </section>
  )
}
