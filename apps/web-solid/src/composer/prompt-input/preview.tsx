import { createResource, For, Match, Show, Switch } from "solid-js"
import { parseDelimited } from "../../files/delimited"
import { fileType, type FileType } from "../../files/type"
import { TypeIcon } from "../../files/type-icon"
import { middleTruncate } from "../rich/nodes"
import type { PromptInputV2Attachment } from "./types"

export const PASTED_TEXT = "Pasted text.txt"

const PEEK_BYTES = 4096
const LINES = 9
const ROWS = 6
const COLUMNS = 3

export type TileLook = "image" | "video" | "lines" | "code" | "table" | "type"

const LOOKS: Partial<Record<FileType, TileLook>> = {
  image: "image",
  video: "video",
  markdown: "lines",
  text: "lines",
  code: "code",
  html: "code",
  csv: "table",
}

function tileType(part: PromptInputV2Attachment): FileType {
  return fileType({ name: part.filename, type: part.mime })
}

export function tileLook(part: PromptInputV2Attachment): TileLook {
  if (part.filename === PASTED_TEXT) return "lines"
  return LOOKS[tileType(part)] ?? "type"
}

export function tileBadge(part: PromptInputV2Attachment): string {
  if (part.filename === PASTED_TEXT) return "Pasted"
  const ext = /\.([^./]+)$/.exec(part.filename)?.[1]
  return ext && ext.length <= 5 ? ext.toUpperCase() : "File"
}

function proseLines(text: string): { text: string; head: boolean }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, LINES)
    .map((line) => ({
      head: /^#{1,6}\s/.test(line),
      text: line.replace(/^(#{1,6}|>|[-*+]|\d+\.)\s+/, "").replace(/[*_`]/g, ""),
    }))
}

function Lines(props: { text: string }) {
  return (
    <span class="tray-lines" aria-hidden="true">
      <For each={proseLines(props.text)}>
        {(line) => <span data-head={line.head ? "" : undefined}>{line.text}</span>}
      </For>
    </span>
  )
}

function Code(props: { text: string }) {
  return (
    <span class="tray-code" aria-hidden="true">
      {props.text.replace(/\t/g, "  ").split("\n").slice(0, LINES).join("\n")}
    </span>
  )
}

function Table(props: { text: string; name: string }) {
  const rows = () =>
    parseDelimited(props.text, /\.tsv$/i.test(props.name) ? "\t" : ",", ROWS).rows.map((row) => row.slice(0, COLUMNS))
  return (
    <span class="tray-table" aria-hidden="true">
      <For each={rows()}>
        {(row, index) => (
          <span class="tray-table-row" data-head={index() === 0 ? "" : undefined}>
            <For each={row}>{(cell) => <span>{cell}</span>}</For>
          </span>
        )}
      </For>
    </span>
  )
}

function TypeFace(props: { part: PromptInputV2Attachment }) {
  return (
    <span class="tray-face">
      <TypeIcon type={tileType(props.part)} size={22} />
      <span class="tray-face-name">{middleTruncate(props.part.filename, 44)}</span>
    </span>
  )
}

export function TilePreview(props: { part: PromptInputV2Attachment; look: TileLook; onBroken: () => void }) {
  const look = () => props.look
  const readable = () => look() === "lines" || look() === "code" || look() === "table"
  const [text] = createResource(
    () => (readable() ? props.part.blob.url : null),
    (url) =>
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => blob.slice(0, PEEK_BYTES).text())
        .catch(() => ""),
  )
  const shown = () => (readable() ? (text()?.trim() ? text()! : null) : null)
  return (
    <Switch fallback={<TypeFace part={props.part} />}>
      <Match when={look() === "image"}>
        <img
          class="tray-thumb"
          src={props.part.blob.url}
          alt={props.part.filename}
          draggable={false}
          onError={props.onBroken}
        />
      </Match>
      <Match when={look() === "video"}>
        <video
          class="tray-thumb"
          src={`${props.part.blob.url}#t=0.1`}
          muted
          playsinline
          preload="metadata"
          aria-hidden="true"
          onError={props.onBroken}
        />
      </Match>
      <Match when={readable() && text.loading}>
        <span class="tray-lines" aria-hidden="true" />
      </Match>
      <Match when={shown()}>
        {(body) => (
          <Show
            when={look() === "table"}
            fallback={
              <Show when={look() === "code"} fallback={<Lines text={body()} />}>
                <Code text={body()} />
              </Show>
            }
          >
            <Table text={body()} name={props.part.filename} />
          </Show>
        )}
      </Match>
    </Switch>
  )
}
