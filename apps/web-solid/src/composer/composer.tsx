import { Show, createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import type { ComposerProps, MessageFile } from "../lib/types"
import { isImage, sendRefusal } from "../lib/attachments"
import "./composer.css"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import { createPromptInputV2Store } from "./prompt-input/store"
import { blobId, releaseBlobUrl } from "./prompt-input/attachments"
import type { PromptInputV2Attachment, PromptInputV2PersistedState, PromptInputV2Suggestion } from "./prompt-input/types"
import { ReplyBar } from "./reply-bar"
import { quoteSummary, replySummary } from "../chat/lib/reply"
import { createImageDialog } from "../chat/ui/image-dialog"
import { runSlash, slashSuggestions } from "./slash"
import { forgetUpload, readyAttachments, releaseUpload, startUpload, uploadBlockReason } from "../sync/uploads"

const draftFiles = () => import("./rich/draft-files")

export function Composer(props: ComposerProps) {
  const [persisted, setPersisted] = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
  })
  const store = createPromptInputV2Store([persisted, setPersisted])
  // Escape drops the quote, the way it closes a menu. A menu, a dialog or the mention list that
  // wants the key has already used it by the time it reaches the document.
  // Capture phase: the editor prevents Escape itself before a bubbling listener would see it. A
  // list, menu or dialog that is open takes the key first, so it is checked here.
  const dropReply = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || (!props.replyTo && !props.editing)) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest('[data-component="composer-dock"]')) return
    if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
    event.preventDefault()
    if (props.editing) {
      props.onCancelEdit?.()
      store.reset()
    } else props.onClearReply?.()
  }
  document.addEventListener("keydown", dropReply, true)
  // Up in an empty composer edits the last message, as in Telegram. Any text, attachment or open
  // list (the mention menu uses the arrows) leaves the key alone.
  const editLast = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest('[data-component="prompt-input"]')) return
    if (props.editing || draftText() !== "" || store.state.prompt.some((part) => part.type === "image")) return
    if (document.querySelector('[role="listbox"], [role="dialog"], [role="menu"]')) return
    event.preventDefault()
    props.onEditLast?.()
  }
  document.addEventListener("keydown", editLast)
  onCleanup(() => document.removeEventListener("keydown", editLast))
  onCleanup(() => document.removeEventListener("keydown", dropReply, true))
  const boxed = () => store.state.prompt.flatMap((part) => (part.type === "image" ? [part] : []))
  let held = new Map<string, string>()
  const keptFor = new Map<string, string>()
  const discard = (id: string, url: string) => {
    releaseUpload(id)
    releaseBlobUrl(url)
  }
  createEffect(() => {
    const now = new Map(boxed().map((part) => [part.id, part.blob.url]))
    for (const [id, url] of held) {
      if (now.has(id)) continue
      discard(id, url)
      const key = keptFor.get(id)
      if (key) void draftFiles().then((m) => m.deleteDraftFile(key, id))
      keptFor.delete(id)
    }
    held = now
  })
  onCleanup(() => {
    for (const [id, url] of held) discard(id, url)
  })
  const leaveChat = () => {
    for (const [id, url] of held) discard(id, url)
    held = new Map()
    keptFor.clear()
    if (boxed().length) store.setPrompt(store.state.prompt.filter((part) => part.type !== "image"))
  }
  const restoreFiles = async (key: string) => {
    const saved = await draftFiles().then((m) => m.listDraftFiles(key))
    if (props.draftKey !== key) return
    const have = new Set(boxed().map((part) => part.id))
    const parts: PromptInputV2Attachment[] = []
    for (const entry of saved) {
      if (have.has(entry.id)) continue
      const file = new File([entry.blob], entry.name, { type: entry.type })
      parts.push({ type: "image", id: entry.id, filename: entry.name, mime: entry.type, size: entry.size, blob: { id: await blobId(file), url: URL.createObjectURL(file) } })
      keptFor.set(entry.id, key)
      startUpload(entry.id, key, file, entry.name, entry.type)
    }
    if (props.draftKey !== key) return releaseAll(parts)
    if (parts.length) store.setPrompt([...store.state.prompt, ...parts], store.state.cursor)
  }
  const releaseAll = (parts: PromptInputV2Attachment[]) => {
    for (const part of parts) discard(part.id, part.blob.url)
  }
  const blocked = () => uploadBlockReason(boxed().map((part) => part.id))
  const draftText = () =>
    store.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")

  /*
   * Unsent text follows the chat. Switching refills the input from the draft in
   * memory, in the same tick, so the first painted frame already has it. Saves
   * are guarded by the key the input was filled for, so the text of the chat you
   * are leaving never lands under the one you are entering.
   */
  let filledFor = ""
  createEffect(
    on(
      () => props.draftKey ?? "",
      (key) => {
        filledFor = ""
        leaveChat()
        if (!key) return
        const text = props.draftFor?.(key) ?? ""
        if (text !== draftText()) {
          if (text) store.setText(text)
          else store.reset()
        }
        filledFor = key
        void restoreFiles(key)
      },
    ),
  )
  createEffect(
    on(draftText, (text) => {
      if (filledFor && filledFor === props.draftKey) props.onDraftChange?.(filledFor, text)
    }, { defer: true }),
  )

  // Entering an edit puts the message's text in the box; leaving it empties the box.
  createEffect(
    on(
      () => props.editing?.id,
      (id, previous) => {
        if (id) {
          store.setText(props.editing!.body)
          queueMicrotask(() => document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus())
        } else if (previous) store.reset()
      },
      { defer: true },
    ),
  )

  /* The strip's thumbnails open the composer's own image dialog, over every picture in the box. */
  const viewer = createImageDialog()
  const pictures = () =>
    store.state.prompt.flatMap((part) => (part.type === "image" && isImage({ name: part.filename, type: part.mime }) ? [part] : []))

  const botById = (botId: string | undefined) =>
    botId === undefined ? undefined : props.bots.find((bot) => bot.id === botId)

  /*
   * The `@` list is the open room's members. A mention is the slug, because the slug is what
   * the room routes by and it never changes; a rename only changes the display name.
   */
  const context = (): PromptInputV2Suggestion[] =>
    props.bots.map((bot) => ({
      id: `agent-${bot.id}`,
      kind: "agent",
      label: `@${bot.id}`,
      description: [bot.name.toLowerCase() === bot.id ? "" : bot.name, bot.persona ?? "Agent"].filter(Boolean).join(" · "),
      mention: { type: "agent", name: bot.id, content: `@${bot.id}`, start: 0, end: 0 },
    }))

  /*
   * The placeholder names the conversation, the way kat's says `Message kat`.
   * The name keeps its own casing, and it is taken from the roster rather than
   * hardcoded so it stays true when the reader switches conversation.
   */
  const placeholder = () => {
    const name = props.title || botById(props.threadId)?.name
    return name ? `Message ${name}` : "Message"
  }

  const controller = createPromptInputV2Controller({
    store: [persisted, setPersisted],
    commands: slashSuggestions,
    context,
    searchContextFiles: () => [],
    openAttachment: (attachment) => {
      const all = pictures()
      viewer.open(
        all.map((p) => ({ src: p.blob.url, name: p.filename })),
        Math.max(0, all.findIndex((p) => p.id === attachment.id)),
      )
    },
    attachments: {
      refuse: (reasons) => {
        for (const title of reasons) showToastV2({ title, variant: "error" })
      },
      onAdded: (attachment, file) => {
        if (props.threadId) startUpload(attachment.id, props.threadId, file, attachment.filename, attachment.mime)
        const key = props.draftKey
        if (!key) return
        keptFor.set(attachment.id, key)
        void draftFiles().then((m) => m.putDraftFile(key, { id: attachment.id, name: attachment.filename, type: attachment.mime, size: attachment.size, blob: file }))
      },
    },
    view: {
      placeholder,
      submit: {
        stopping: () => false,
        blocked,
        onSubmit: () => {
          if (props.busy || blocked()) return
          // There is no conversation to land in, so there is nothing to send.
          if (!props.threadId) return
          const text = draftText()
          const editing = props.editing
          // Every attachment is already uploaded: the send names the uploads, and the message shows
          // the blob URLs until the room's copy arrives. The frame's size counts the names too.
          const parts = boxed()
          const attachments = readyAttachments(parts.map((part) => ({ id: part.id, name: part.filename, type: part.mime, size: part.size })))
          // A refused draft stays in the box, untouched, with the reason in a toast.
          const refusal = sendRefusal(text, !!editing, attachments ?? [])
          if (refusal) return void showToastV2({ title: refusal, variant: "error" })
          if (editing) {
            if (text.trim() && text !== editing.body) props.onEdit?.(editing.id, text)
            props.onCancelEdit?.()
            return
          }
          if (runSlash(text)) return void store.reset()
          if (!attachments) return
          const files = parts.map((part): MessageFile => ({ name: part.filename, size: part.size, type: part.mime, src: part.blob.url }))
          if (!text.trim() && files.length === 0) return
          for (const part of parts) forgetUpload(part.id)
          held = new Map()
          keptFor.clear()
          const draftKey = props.draftKey
          if (draftKey) void draftFiles().then((m) => m.clearDraftFiles(draftKey))
          store.reset()
          props.onSend(files.length ? { body: text, files, attachments } : { body: text })
          props.onClearReply?.()
        },
        onStop: () => {},
      },
    },
  })

  /*
   * `Show` rather than a bare ternary: a component body runs once, so an
   * eagerly-built element would freeze whichever reply was armed at mount.
   * The `when` accessor is what makes the bar track the prop.
   */
  const above = (
    <>
      <Show when={props.editing}>
        {(message) => (
          <ReplyBar
            summary={replySummary(message())}
            role="Edit message"
            onJump={() => props.onJumpToReply?.(message().id)}
            onDismiss={() => props.onCancelEdit?.()}
          />
        )}
      </Show>
      <Show when={!props.editing && props.replyTo}>
        {(message) => (
          <ReplyBar
            summary={props.replyQuote ? quoteSummary(props.replyQuote) : replySummary(message())}
            role={
              message().sender === "user"
                ? "You"
                : (botById(message().botId)?.name ?? (props.bots.length === 1 ? props.bots[0]!.name : "Agent"))
            }
            onJump={() => props.onJumpToReply?.(message().id)}
            onDismiss={() => props.onClearReply?.()}
          />
        )}
      </Show>

    </>
  )

  return (
    <>
      <PromptInputV2 controller={controller} disabled={!!props.busy} reply={above} isMention={(slug) => props.bots.some((bot) => bot.id === slug)} />
      {viewer.view}
    </>
  )
}
