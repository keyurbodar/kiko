import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal, render } from "solid-js/web"
import { shownName } from "../rich/file-ref"
import { type Glyph, RemixIcon } from "@kiko/ui/remix-icon"
import {
  BoltIcon,
  ClockIcon,
  CommandIcon,
  ComposeIcon,
  FileIcon,
  PlusIcon,
  SearchIcon,
  SkillsIcon,
} from "@kiko/ui/icons"
import { isImage, saveFile } from "../../lib/attachments"
import { formatBytes } from "../../chat/info/format"
import { isTextFile, readText } from "../../files/api"
import { HOME, inHome, strip } from "../../files/model"
import { fileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { AppLogo } from "../../recipes/icon"
import { room } from "../../state/room"
import { user } from "../../state/user"
import { progressLabel, progressShare, retryUpload, uploadState } from "../uploads"
import type { ChipView, FileRefView, TokenView } from "../rich/nodes"
import { middleTruncate } from "../rich/nodes"
import type { Token } from "../tokens"
import type { PromptInputV2Attachment } from "./types"

export type ChipSource = {
  attachments: () => PromptInputV2Attachment[]
  openAttachment: (attachment: PromptInputV2Attachment) => void
  resolve: (sign: "@" | "/", name: string) => Token | undefined
  roomId: () => string
  chatTitle: () => string | undefined
}

const COMMAND_ICONS: Record<string, Glyph> = {
  new: ComposeIcon,
  file: FileIcon,
  search: SearchIcon,
  remind: ClockIcon,
  skill: SkillsIcon,
}

export function TokenGlyph(props: { token: Token; size: number }) {
  const token = props.token
  if (token.kind === "agent") return <IdentityAvatar seed={token.slug} size={props.size} />
  if (token.kind === "app")
    return (
      <span class="token-app-tile" style={{ width: `${props.size - 1}px`, height: `${props.size - 1}px` }}>
        <AppLogo app={{ slug: token.slug, name: token.title, connected: true }} size={props.size - 1} />
      </span>
    )
  if (token.kind === "file") return <TypeIcon type={fileType({ name: token.path, type: "" })} size={props.size - 1} />
  if (token.kind === "recipe") return <span class="token-leaf" aria-hidden="true" />
  if (token.kind === "action") return <RemixIcon icon={PlusIcon} size={props.size - 2} class="token-bolt" />
  if (token.kind === "command")
    return <RemixIcon icon={COMMAND_ICONS[token.trigger] ?? CommandIcon} size={props.size - 2} class="token-bolt" />
  return <RemixIcon icon={BoltIcon} size={props.size - 2} class="token-bolt" />
}

function TokenChip(props: { sign: "@" | "/"; name: string; source: ChipSource }) {
  const token = () => props.source.resolve(props.sign, props.name)
  return (
    <Show
      when={token()}
      fallback={
        <span class="token-chip" data-kind="unknown">
          {props.sign}
          {props.name}
        </span>
      }
    >
      {(found) => (
        <span class="token-chip" data-kind={found().kind} title={found().hint}>
          <TokenGlyph token={found()} size={16} />
          <span class="token-chip-label">{found().title}</span>
        </span>
      )}
    </Show>
  )
}

export const tokenView =
  (source: ChipSource): TokenView =>
  (dom, token) =>
    render(() => <TokenChip sign={token.sign} name={token.name} source={source} />, dom)

const PREVIEW_DELAY = 300
const PREVIEW_BYTES = 2048
const PREVIEW_LINES = 4

function fileRecord(path: string, roomId: string) {
  if (inHome(path)) {
    const name = strip(path)
    return { space: HOME, file: user.homeFiles().find((f) => f.name === name) }
  }
  return { space: roomId, file: room.files().find((f) => f.name === path) }
}

function FilePreview(props: { path: string; anchor: HTMLElement; source: ChipSource }) {
  const record = () => fileRecord(props.path, props.source.roomId())
  const [lines] = createResource(
    () => {
      const { space, file } = record()
      return file && isTextFile(file) ? { space, id: file.id } : null
    },
    async ({ space, id }) => {
      const read = await readText(space, id, PREVIEW_BYTES).catch(() => null)
      return read?.kind === "text"
        ? read.text
            .split("\n")
            .filter((line) => line.trim())
            .slice(0, PREVIEW_LINES)
        : []
    },
  )
  const box = props.anchor.getBoundingClientRect()
  const place = () => (inHome(props.path) ? "In Files" : `In ${props.source.chatTitle() ?? "this chat"}`)
  return (
    <Show when={!lines.loading}>
      <Portal>
        <div
          class="token-preview"
          data-component="file-chip-preview"
          role="tooltip"
          style={{ left: `${Math.max(8, box.left)}px`, bottom: `${window.innerHeight - box.top + 8}px` }}
        >
          <div class="token-preview-head">
            <TypeIcon type={fileType({ name: props.path, type: record().file?.type ?? "" })} size={18} />
            <span class="token-preview-name">{shownName(props.path)}</span>
            <Show when={record().file}>
              {(file) => <span class="token-preview-meta">{formatBytes(file().size)}</span>}
            </Show>
          </div>
          <Show when={lines()?.length}>
            <div class="token-preview-lines">
              <For each={lines()}>{(line) => <span>{line}</span>}</For>
            </div>
          </Show>
          <div class="token-preview-foot">{record().file ? place() : "Not found in Files"}</div>
        </div>
      </Portal>
    </Show>
  )
}

function FileRef(props: { path: string; folder: boolean; source: ChipSource }) {
  const [open, setOpen] = createSignal(false)
  let anchor!: HTMLSpanElement
  let timer: ReturnType<typeof setTimeout> | undefined
  const leave = () => {
    clearTimeout(timer)
    setOpen(false)
  }
  onCleanup(leave)
  return (
    <span
      ref={anchor}
      class="token-chip"
      data-component="composer-file-ref"
      data-kind={props.folder ? "folder" : "file"}
      onPointerEnter={() => {
        if (props.folder) return
        clearTimeout(timer)
        timer = setTimeout(() => setOpen(true), PREVIEW_DELAY)
      }}
      onPointerLeave={leave}
    >
      <TokenGlyph token={{ kind: "file", id: props.path, path: props.path, title: "", hint: "" }} size={16} />
      <span class="token-chip-label">{middleTruncate(shownName(props.path), 28)}</span>
      <Show when={open()}>
        <FilePreview path={props.path} anchor={anchor} source={props.source} />
      </Show>
    </span>
  )
}

export const fileRefView =
  (source: ChipSource): FileRefView =>
  (dom, ref) =>
    render(() => <FileRef path={ref.path} folder={ref.folder} source={source} />, dom)

function Chip(props: { id: string; name: string; source: ChipSource }) {
  const part = () => props.source.attachments().find((p) => p.id === props.id)
  const image = () => {
    const p = part()
    return !!p && isImage({ name: p.filename, type: p.mime })
  }
  const upload = () => uploadState(props.id)
  const meta = () => {
    const u = upload()
    const p = part()
    if (!p) return "Gone"
    if (u?.status === "uploading") return progressLabel(u.loaded, u.total)
    if (u?.status === "failed") return "Retry"
    return formatBytes(p.size)
  }
  const share = () => {
    const u = upload()
    return u?.status === "uploading" ? progressShare(u.loaded, u.total) : 1
  }
  const open = () => {
    const p = part()
    if (!p) return
    if (upload()?.status === "failed") return retryUpload(props.id)
    if (image()) return props.source.openAttachment(p)
    saveFile(p.blob.url, p.filename)
  }
  return (
    <button
      type="button"
      class="token-chip"
      data-component="composer-chip"
      data-kind={image() ? "image" : "file"}
      data-state={upload()?.status}
      data-missing={part() ? undefined : ""}
      title={upload()?.status === "failed" ? (upload() as { reason: string }).reason : `${props.name}, ${meta()}`}
      aria-label={`${props.name}, ${meta()}`}
      style={{ "--upload-share": share() }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={open}
    >
      {image() ? (
        <img class="token-chip-thumb" src={part()!.blob.url} alt="" draggable={false} />
      ) : (
        <TypeIcon type={fileType({ name: props.name, type: part()?.mime ?? "" })} size={16} />
      )}
      <span class="token-chip-label">{middleTruncate(props.name, 28)}</span>
      <Show when={upload()?.status === "uploading" || upload()?.status === "failed"}>
        <span class="token-chip-meta">{meta()}</span>
      </Show>
      <Show when={upload()?.status === "uploading"}>
        <span class="token-chip-fill" aria-hidden="true" />
      </Show>
    </button>
  )
}

export const chipView =
  (source: ChipSource): ChipView =>
  (dom, attachment) =>
    render(() => <Chip id={attachment.id} name={attachment.name} source={source} />, dom)
