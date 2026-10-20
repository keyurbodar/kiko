import { For, Show, Suspense, lazy, batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { MAX_MESSAGE_TEXT, humanAnswerText, sendFits, attachmentIds, linkAttachments } from "@kiko/protocol"
import type { ComposerProps, MessageFile } from "../lib/types"
import { isImage, sendRefusal } from "../lib/attachments"
import "./composer.css"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import { createPromptInputV2Store } from "./prompt-input/store"
import { blobId, releaseBlobUrl } from "./prompt-input/attachments"
import type { PromptInputV2Attachment, PromptInputV2PersistedState, PromptInputV2Suggestion } from "./prompt-input/types"
import { ReplyBar } from "./reply-bar"
import { openSettings } from "../lib/errors"
import { openModelPicker } from "../settings/model-picker"
import { quoteSummary, replySummary } from "../chat/lib/reply"
import { createImageDialog } from "../chat/ui/image-dialog"
import { runSlash, slashSuggestions } from "./slash"
import { forgetUpload, readyAttachments, releaseUpload, startUpload, uploadBlockReason } from "../sync/uploads"
import { createDraftRestore } from "./draft-restore"
import { composerFill, takeComposerFill } from "./fill"

import { createQuestionInput } from "./cards/question-input"
import { carryDisplacedCustomAnswerIntoPrompt } from "./cards/question-model"
const ComposerCards = lazy(() => import("./cards/composer-cards").then((m) => ({ default: m.ComposerCards })))

const draftFiles = () => import("./rich/draft-files")

export function Composer(props: ComposerProps) {
  const question = createQuestionInput(() => props.editing ? [] : props.room?.asks() ?? [], (ask, answers) => {
    const value = ask.questions ? answers : answers.answer as string
    const text = humanAnswerText(ask, value)
    if (!text || text.length > MAX_MESSAGE_TEXT || !sendFits(text)) return void showToastV2({ title: "These answers are too long to send.", variant: "error" })
    props.room?.answer(ask.id, value)
  }, (id) => props.room?.skip(id), {
    key: () => props.draftKey,
    load: (id) => props.draftFor?.(`${props.draftKey}:questions:${id}`) ?? "",
    save: (id, value) => props.onDraftChange?.(`${props.draftKey}:questions:${id}`, value),
  })
  const draftKey = () => question.ask() ? `${props.draftKey}:ask:${question.ask()!.id}:${question.progress().activeQuestion?.id}` : props.draftKey

  const [persisted, setPersisted] = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
  })
  const store = createPromptInputV2Store([persisted, setPersisted])
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
  const editLast = (event: KeyboardEvent) => {
    if (event.key !== "ArrowUp" || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest('[data-component="prompt-input"]')) return
    if (question.ask() || props.editing || draftText() !== "" || store.state.prompt.some((part) => part.type === "image")) return
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
    for (const [, url] of held) releaseBlobUrl(url)
    held = new Map()
    keptFor.clear()
    if (boxed().length) store.setPrompt(store.state.prompt.filter((part) => part.type !== "image"))
  }
  const restoreFiles = createDraftRestore<{ id: string; part: PromptInputV2Attachment; file: File }>({
    list: (key) => draftFiles().then((m) => m.listDraftFiles(key)),
    current: () => draftKey(),
    inBox: () => new Set(boxed().map((part) => part.id)),
    build: async (entry) => {
      const file = new File([entry.blob], entry.name, { type: entry.type })
      const part: PromptInputV2Attachment = { type: "image", id: entry.id, filename: entry.name, mime: entry.type, size: entry.size, blob: { id: await blobId(file), url: URL.createObjectURL(file) } }
      return { id: entry.id, part, file }
    },
    release: ({ part }) => releaseBlobUrl(part.blob.url),
    apply: (key, items) => {
      for (const { part, file } of items) {
        keptFor.set(part.id, key)
        startUpload(part.id, key, file, part.filename, part.mime)
      }
      store.setPrompt([...store.state.prompt, ...items.map((item) => item.part)], store.state.cursor)
    },
  })
  const modelBlock = () => (props.editing || question.ask() ? null : (props.sendBlock ?? null))
  const blocked = () => modelBlock()?.reason ?? uploadBlockReason(boxed().map((part) => part.id))
  const draftText = () =>
    store.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
  createEffect(
    on(createMemo(draftText), (text) => {
      const named = new Set(attachmentIds(text))
      for (const part of boxed()) if (!named.has(part.id) && !isImage({ name: part.filename, type: part.mime })) store.removeAttachment(part.id)
    }),
  )

  const typeHere = (text: string) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".composer-dock .ProseMirror")?.focus()
        const tail = /\s*$/.exec(text)![0]
        if (tail) controller.addPart({ type: "text", content: tail, start: 0, end: 0 })
      }),
    )
  let filledFor = ""
  createEffect(
    on(
      () => draftKey() ?? "",
      (key) => {
        filledFor = ""
        leaveChat()
        if (!key) return
        const filled = takeComposerFill(key)
        if (filled !== undefined) typeHere(filled)
        const text = filled?.trimEnd() ?? (question.ask() ? question.progress().customAnswer : props.draftFor?.(key)) ?? ""
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
    on(
      composerFill,
      (fill) => {
        if (!fill || fill.roomId !== draftKey()) return
        const text = takeComposerFill(fill.roomId) ?? ""
        store.setText(text.trimEnd())
        typeHere(text)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(draftText, (text) => {
      if (filledFor && filledFor === draftKey()) {
        if (question.ask()) question.custom(text)
        props.onDraftChange?.(filledFor, text)
      }
    }, { defer: true }),
  )

  createEffect(
    on(
      () => props.editing?.id,
      (id, previous) => {
        if (id) {
          filledFor = ""
          store.setText(props.editing!.body)
          queueMicrotask(() => document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus())
        } else if (previous) {
          store.reset()
          const key = draftKey()
          const text = key ? (props.draftFor?.(key) ?? "") : ""
          if (text) store.setText(text)
          filledFor = key ?? ""
        }
      },
      { defer: true },
    ),
  )

  const viewer = createImageDialog()
  const pictures = () =>
    store.state.prompt.flatMap((part) => (part.type === "image" && isImage({ name: part.filename, type: part.mime }) ? [part] : []))

  const botById = (botId: string | undefined) =>
    botId === undefined ? undefined : props.bots.find((bot) => bot.id === botId)

  const context = (): PromptInputV2Suggestion[] =>
    props.bots.map((bot) => ({
      id: `agent-${bot.id}`,
      kind: "agent",
      label: `@${bot.id}`,
      title: bot.name,
      description: [bot.name.toLowerCase() === bot.id ? "" : bot.name, bot.persona ?? "Agent"].filter(Boolean).join(" · "),
      mention: { type: "agent", name: bot.id, content: `@${bot.id}`, start: 0, end: 0 },
    }))

  const selectAnswer = (value: string) => batch(() => {
    const key = props.draftKey
    const displaced = question.progress().customAnswer
    if (key && displaced.trim()) props.onDraftChange?.(key, carryDisplacedCustomAnswerIntoPrompt(props.draftFor?.(key) ?? "", displaced))
    store.reset()
    question.select(value)
  })
  const placeholder = () => {
    if (question.ask()) return question.progress().activeQuestion?.allowCustomAnswer === false ? "Select an option above" : "Type your own answer…"
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
        document.querySelector(`[data-component="composer-attachment"][data-id="${attachment.id}"] img`),
      )
    },
    attachments: {
      blocked: () => question.ask() ? "Answer or skip the question before attaching files." : null,
      key: () => draftKey() ?? "",
      refuse: (reasons) => {
        for (const title of reasons) showToastV2({ title, variant: "error" })
      },
      onAdded: (attachment, file) => {
        if (props.threadId) startUpload(attachment.id, props.threadId, file, attachment.filename, attachment.mime)
        const key = draftKey()
        if (!key) return
        keptFor.set(attachment.id, key)
        void draftFiles().then((m) => m.putDraftFile(key, { id: attachment.id, name: attachment.filename, type: attachment.mime, size: attachment.size, blob: file }))
      },
    },
    view: {
      placeholder,
      submit: {
        canSubmit: () => question.ask() ? (question.progress().isLastQuestion ? question.progress().isComplete : question.progress().canAdvance) : undefined,
        blocked,
        onSubmit: () => {
          if (props.busy || blocked()) return
          if (question.ask()) return question.advance()
          if (!props.threadId) return
          const text = draftText()
          const editing = props.editing
          const parts = boxed()
          const attachments = readyAttachments(parts.map((part) => ({ id: part.id, name: part.filename, type: part.mime, size: part.size })))
          const pending = new Map(parts.map((part, i) => [part.id, attachments?.[i]?.pendingId]))
          const body = linkAttachments(text, (id) => {
            const to = pending.get(id)
            return to && `attachment:${to}`
          })
          const refusal = sendRefusal(body, !!editing, attachments ?? [])
          if (refusal) return void showToastV2({ title: refusal, variant: "error" })
          if (editing) return finishEdit(editing, text)
          if (runSlash(text)) return void store.reset()
          if (!attachments) return
          const files = parts.map((part): MessageFile => ({ name: part.filename, size: part.size, type: part.mime, src: part.blob.url }))
          if (!body.trim() && files.length === 0) return
          const sentDraftKey = draftKey()
          const accepted = props.onSend(files.length ? { body, files, attachments } : { body })
          if (accepted === false) return
          for (const part of parts) forgetUpload(part.id)
          held = new Map()
          keptFor.clear()
          if (sentDraftKey) void draftFiles().then((m) => m.clearDraftFiles(sentDraftKey))
          store.reset()
          props.onClearReply?.()
        },
      },
    },
  })

  function finishEdit(editing: NonNullable<typeof props.editing>, text: string): void {
    if (text.trim() && text !== editing.body) props.onEdit?.(editing.id, text)
    props.onCancelEdit?.()
  }

  const above = (
    <>
      <Show when={props.editing}>
        {(message) => (
          <ReplyBar
            summary={replySummary(message())}
            label="Edit message"
            onJump={() => props.onJumpToReply?.(message().id)}
            onDismiss={() => props.onCancelEdit?.()}
          />
        )}
      </Show>
      <Show when={!props.editing && props.replyTo}>
        {(message) => (
          <ReplyBar
            summary={props.replyQuote ? quoteSummary(props.replyQuote) : replySummary(message())}
            label={`Replying to ${
              message().sender === "user"
                ? "yourself"
                : (botById(message().botId)?.name ?? (props.bots.length === 1 ? props.bots[0]!.name : "an agent"))
            }`}
            onJump={() => props.onJumpToReply?.(message().id)}
            onDismiss={() => props.onClearReply?.()}
          />
        )}
      </Show>
      <Show when={modelBlock()}>
        {(block) => (
          <div class="no-key-hint" data-component="composer-send-block" role="status">
            <span>{block().reason}</span>
            <span class="no-key-actions">
              <For each={block().actions}>
                {(action) => (
                  <button type="button" data-action={action} onClick={() => (action === "open_settings" ? openSettings() : openModelPicker(props.sendBlockAgent))}>
                    {action === "open_settings" ? "Open settings" : "Choose model"}
                  </button>
                )}
              </For>
            </span>
          </div>
        )}
      </Show>
    </>
  )

  return (
    <>
      <Show when={props.room}>{(room) => <Suspense><ComposerCards room={room()} question={question} onSelectAnswer={selectAnswer} /></Suspense>}</Show>
      <PromptInputV2
        answering={!!question.ask()}
        readOnly={!!question.ask() && question.progress().activeQuestion?.allowCustomAnswer === false}
        controller={controller}
        disabled={!!props.busy}
        reply={question.ask() ? undefined : above}
        tray={props.tray}
        isMention={(slug) => props.bots.some((bot) => bot.id === slug)}
      />
      {viewer.view}
    </>
  )
}
