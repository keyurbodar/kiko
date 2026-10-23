import type { FileRef } from "@kiko/protocol"
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js"
import { PREVIEW_BYTES, putFile, readText, sha256Hex } from "./api"
import { SurfaceFailure, SurfaceLoading, SurfaceNotice, UNREADABLE } from "./chrome"
import type { Mounted } from "./editor-cm"
import "./editor.css"

export const AUTOSAVE_MS = 700

export type IndexChange = "none" | "reload" | "conflict"

export function onIndexChange(known: ReadonlySet<string>, latestId: string | undefined, dirty: boolean): IndexChange {
  if (latestId === undefined || known.has(latestId)) return "none"
  return dirty ? "conflict" : "reload"
}

type Base = { id: string; sha256: string }
export type EditorState = "loading" | "clean" | "dirty" | "saving" | "conflict" | "error" | "unreadable"
type State = EditorState

export function TextEditor(props: {
  roomId: string
  path: string
  file: FileRef | undefined
  initial: FileRef
  wrap: boolean
  reveal?: { line: number; n: number } | null
  onState?: (state: EditorState) => void
}) {
  let host!: HTMLDivElement
  let cm: Mounted | undefined
  let base: Base | undefined
  const known = new Set<string>()
  const [state, setState] = createSignal<State>("loading")
  const [theirs, setTheirs] = createSignal<FileRef | null>(null)
  const [message, setMessage] = createSignal("")
  const [cut, setCut] = createSignal<number | null>(null)
  const [shown, setShown] = createSignal(false)
  const type = () => (props.initial.type === "application/octet-stream" ? "text/plain" : props.initial.type)
  let timer: ReturnType<typeof setTimeout> | undefined
  let gone = false
  createEffect(() => props.onState?.(state()))

  async function load(file: FileRef) {
    setState("loading")
    try {
      const read = await readText(props.roomId, file.id, PREVIEW_BYTES)
      if (read.kind !== "text") {
        setMessage(UNREADABLE[read.kind])
        return setState("unreadable")
      }
      base = { id: file.id, sha256: read.sha256 }
      known.add(file.id)
      setCut(read.truncated ? read.size : null)
      if (!cm) {
        const { mountEditor } = await import("./editor-cm")
        if (!host.isConnected) return
        cm = mountEditor(host, read.text, {
          path: props.path,
          readOnly: read.truncated,
          wrap: props.wrap,
          onChange: markDirty,
          onBlur: flush,
        })
      } else {
        cm.setValue(read.text)
        cm.setReadOnly(read.truncated)
      }
      setShown(true)
      setTheirs(null)
      setState("clean")
      if (props.reveal) cm.revealLine(props.reveal.line)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load the file")
      setState("error")
    }
  }

  function markDirty() {
    if (state() === "clean") setState("dirty")
    if (state() !== "conflict" && state() !== "loading") schedule()
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(flush, AUTOSAVE_MS)
  }

  function flush() {
    clearTimeout(timer)
    timer = undefined
    if (state() === "dirty" || state() === "error") void save()
  }

  async function save(text = cm?.value()) {
    if (text === undefined || !base || state() === "saving" || state() === "loading") return
    setState("saving")
    const res = await putFile(props.roomId, props.path, text, type(), base.sha256)
    if (res.kind === "saved") {
      base = { id: res.file.id, sha256: await sha256Hex(new TextEncoder().encode(text)) }
      known.add(res.file.id)
      if (gone) return
      const later = cm !== undefined && cm.value() !== text
      setState(later ? "dirty" : "clean")
      if (later) schedule()
    } else if (res.kind === "conflict") {
      setTheirs(res.theirs)
      setState("conflict")
    } else {
      setMessage(res.message)
      setState("error")
    }
  }

  const loadTheirs = () => {
    const t = theirs()
    if (t) void load(t)
  }

  async function overwrite() {
    const t = theirs()
    if (!cm || !t) return
    setState("saving")
    try {
      const read = await readText(props.roomId, t.id, PREVIEW_BYTES)
      if (read.kind !== "text" || read.truncated) throw new Error("not editable")
      base = { id: t.id, sha256: read.sha256 }
      known.add(t.id)
    } catch {
      setState("conflict")
      return
    }
    setState("dirty")
    await save()
    if (state() === "clean" || state() === "dirty") setTheirs(null)
  }

  onMount(() => void load(props.initial))
  onCleanup(() => {
    clearTimeout(timer)
    const text = cm?.value()
    gone = true
    if (text !== undefined && (state() === "dirty" || state() === "error")) void save(text)
    cm?.destroy()
    cm = undefined
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "s") return
      if (!(e.target instanceof Node) || !host.contains(e.target)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      flush()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  createEffect(
    on(
      () => props.wrap,
      (wrap) => cm?.setWrap(wrap),
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => props.reveal?.n,
      () => props.reveal && cm?.revealLine(props.reveal.line),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => props.file?.id,
      (latestId) => {
        if (state() === "loading" || state() === "saving") return
        const change = onIndexChange(known, latestId, state() !== "clean")
        if (change === "reload" && props.file) void load(props.file)
        if (change === "conflict" && props.file) {
          setTheirs(props.file)
          setState("conflict")
        }
      },
      { defer: true },
    ),
  )

  const bar = () => state() === "conflict" || (state() === "error" && shown())

  return (
    <div
      class="file-editor"
      data-component="file-editor"
      data-state={state()}
      data-truncated={cut() !== null ? "" : undefined}
    >
      <Show when={cut()}>
        {(size) => (
          <SurfaceNotice>Preview limited to the first 1 MB of a {size().toLocaleString()} byte file.</SurfaceNotice>
        )}
      </Show>
      <Show when={!shown()}>
        <Show when={state() === "loading"}>
          <SurfaceLoading />
        </Show>
        <Show when={state() === "error" || state() === "unreadable"}>
          <SurfaceFailure
            message={message()}
            onRetry={state() === "error" ? () => void load(props.file ?? props.initial) : undefined}
          />
        </Show>
      </Show>
      <div class="fe-body" ref={host} hidden={!shown()} />
      <Show when={bar()}>
        <footer class="fe-bar">
          <Show when={state() === "conflict"}>
            <span class="fe-warn" role="alert" data-component="file-conflict">
              {theirs() ? "Someone else changed this file" : "This file was removed"}
            </span>
            <Show when={theirs()}>
              <button type="button" class="fe-btn" onClick={loadTheirs}>
                Load theirs
              </button>
              <button type="button" class="fe-btn" onClick={() => void overwrite()}>
                Overwrite
              </button>
            </Show>
            <button type="button" class="fe-btn" onClick={() => setState("dirty")}>
              Keep editing
            </button>
          </Show>
          <Show when={state() === "error"}>
            <span class="fe-warn" role="alert">
              {message()}
            </span>
            <button type="button" class="fe-btn" data-action="retry-save" onClick={flush}>
              Try again
            </button>
          </Show>
        </footer>
      </Show>
    </div>
  )
}
