import {
  For,
  Show,
  Suspense,
  batch,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  lazy,
  on,
  onCleanup,
  onMount,
  runWithOwner,
} from "solid-js"
import { createStore } from "solid-js/store"
import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { MAX_MESSAGE_TEXT, humanAnswerText, sendFits, linkAttachments } from "@kiko/protocol"
import type { ComposerProps, MessageFile } from "../lib/types"
import { isImage, isVideo, sendRefusal } from "../lib/attachments"
import "./composer.css"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import type { Refusal } from "./prompt-input/attachments"
import { type Rejected } from "./prompt-input/tray"
import { createPromptInputV2Store } from "./prompt-input/store"
import { blobId, preparingAttachments, releaseBlobUrl } from "./prompt-input/attachments"
import { composingKey } from "./ime"
import type { PromptInputV2Attachment, PromptInputV2PersistedState } from "./prompt-input/types"
import { ReplyBar } from "./reply-bar"
import { openSettings } from "../lib/errors"
import { openModelPicker } from "../settings/model-picker"
import { quoteSummary, replySummary } from "../chat/lib/reply"
import { createImageDialog } from "../chat/ui/image-dialog"
import { runSlash, slashTokens } from "./slash"
import { pendingAttachments, releaseUpload, retryUpload, startUpload, uploadState } from "./uploads"
import { tokenGroups, type Token } from "./tokens"
import type { TokenData } from "./token-data"
import { room } from "../state/room"
import { createDraftRestore } from "./draft-restore"
import { receiveFileRefs } from "./file-refs"
import { composerFill, takeComposerFill } from "./fill"

import { createQuestionInput } from "./cards/question-input"
import { carryDisplacedCustomAnswerIntoPrompt } from "./cards/question-model"
import { ComposerCards } from "./cards/composer-cards"
import { AddSomeoneItems } from "./add-someone"
import { PlusMenu } from "./plus-menu"
import { history } from "../app/history"

const draftFiles = () => import("./rich/draft-files")
const DraftFileDialog = lazy(() => import("./draft-file-dialog"))

const ASKING = "Answer or skip the question before attaching files."

const NO_DATA: TokenData = {
  files: () => [],
  apps: () => [],
  skills: () => [],
  recipes: () => [],
  app: () => undefined,
}

const ADD_SOMEONE: Token = { kind: "action", id: "action:add-someone", title: "Add someone to this chat…", hint: "" }

function agentHint(bot: ComposerProps["bots"][number]): string {
  if (bot.presence === "working") return "Using a tool"
  if (bot.presence === "typing") return "Writing a reply"
  return bot.persona === "lead" ? "Lead" : "Agent"
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function Composer(props: ComposerProps) {
  const question = createQuestionInput(
    () => (props.editing ? [] : (props.room?.asks() ?? [])),
    (ask, answers) => {
      const value = ask.questions ? answers : (answers.answer as string)
      const text = humanAnswerText(ask, value)
      if (!text || text.length > MAX_MESSAGE_TEXT || !sendFits(text))
        return void showToastV2({ title: "These answers are too long to send.", variant: "error" })
      props.room?.answer(ask.id, value)
    },
    (id) => props.room?.skip(id),
    {
      key: () => props.draftKey,
      load: (id) => props.draftFor?.(`${props.draftKey}:questions:${id}`) ?? "",
      save: (id, value) => props.onDraftChange?.(`${props.draftKey}:questions:${id}`, value),
    },
  )
  const draftKey = () =>
    question.ask()
      ? `${props.draftKey}:ask:${question.ask()!.id}:${question.progress().activeQuestion?.id}`
      : props.draftKey

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
    if (props.editing) props.onCancelEdit?.()
    else props.onClearReply?.()
  }
  document.addEventListener("keydown", dropReply, true)
  const editLast = (event: KeyboardEvent) => {
    if (
      event.key !== "ArrowUp" ||
      event.defaultPrevented ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return
    if (composingKey(event)) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest('[data-component="prompt-input"]')) return
    if (
      question.ask() ||
      props.editing ||
      draftText() !== "" ||
      store.state.prompt.some((part) => part.type === "image")
    )
      return
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
      const part: PromptInputV2Attachment = {
        type: "image",
        id: entry.id,
        filename: entry.name,
        mime: entry.type,
        size: entry.size,
        blob: { id: await blobId(file), url: URL.createObjectURL(file) },
      }
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
  const failed = () => boxed().filter((part) => uploadState(part.id)?.status === "failed")
  const blocked = () => modelBlock()?.reason ?? (preparingAttachments() ? "Still preparing the attachment" : null)
  const [nudged, setNudged] = createSignal(false)
  const [rejected, setRejected] = createSignal<Rejected[]>([])
  function draftText() {
    return store.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
  }
  let filledFor = ""
  createEffect(
    on(
      () => draftKey() ?? "",
      (key, before) => {
        if (before && before !== key && before.includes(":ask:")) props.onDraftChange?.(before, "")
        filledFor = ""
        leaveChat()
        setRejected([])
        if (!key) return
        const filled = takeComposerFill(key)
        if (filled !== undefined) typeHere(filled)
        const text =
          filled?.trimEnd() ?? (question.ask() ? question.progress().customAnswer : props.draftFor?.(key)) ?? ""
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
        void restoreFiles(fill.roomId)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      draftText,
      (text) => {
        if (filledFor && filledFor === draftKey()) {
          if (question.ask()) question.custom(text)
          props.onDraftChange?.(filledFor, text)
        }
      },
      { defer: true },
    ),
  )

  let stagedFor: PromptInputV2Attachment[] | undefined
  createEffect(
    on(
      () => props.editing?.id,
      (id, previous) => {
        if (id) {
          filledFor = ""
          stagedFor = boxed()
          store.setText(props.editing!.body)
          queueMicrotask(() => document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus())
        } else if (previous) {
          const live = new Set(boxed().map((part) => part.id))
          const staged = (stagedFor ?? []).filter((part) => live.has(part.id))
          stagedFor = undefined
          const key = draftKey()
          const text = key ? (props.draftFor?.(key) ?? "") : ""
          if (staged.length)
            store.setPrompt([{ type: "text", content: text, start: 0, end: text.length }, ...staged], text.length)
          else if (text) store.setText(text)
          else store.reset()
          filledFor = key ?? ""
        }
      },
      { defer: true },
    ),
  )

  const viewer = createImageDialog()
  const media = () =>
    store.state.prompt.flatMap((part) => {
      if (part.type !== "image") return []
      const named = { name: part.filename, type: part.mime }
      return isImage(named) || isVideo(named) ? [part] : []
    })
  const [previewing, setPreviewing] = createSignal<PromptInputV2Attachment | null>(null)

  const botById = (botId: string | undefined) =>
    botId === undefined ? undefined : props.bots.find((bot) => bot.id === botId)

  const agents = createMemo((): Token[] =>
    props.bots.map((bot) => ({
      kind: "agent",
      id: `agent:${bot.id}`,
      slug: bot.id,
      title: bot.name,
      hint: agentHint(bot),
    })),
  )
  const [data, setData] = createSignal<TokenData>(NO_DATA)
  onMount(() => {
    const owner = getOwner()
    void import("./token-data").then(({ createTokenData }) =>
      runWithOwner(owner, () =>
        setData(createTokenData({ roomId: () => props.threadId, chatTitle: () => props.title })),
      ),
    )
  })
  const pool = {
    agents,
    files: (query: string) => data().files(query),
    apps: () => data().apps(),
    skills: () => data().skills(),
    recipes: () => data().recipes(),
    commands: slashTokens,
    actions: () => (props.room ? [ADD_SOMEONE] : []),
  }
  const [adding, setAdding] = createSignal(false)
  const resolve = (sign: "@" | "/", name: string): Token | undefined => {
    if (sign === "@")
      return (
        agents().find((token) => token.kind === "agent" && token.slug === name) ??
        data()
          .apps()
          .find((token) => token.kind === "app" && token.slug === name)
      )
    return [...data().skills(), ...data().recipes()].find(
      (token) => (token.kind === "skill" || token.kind === "recipe") && token.name === name,
    )
  }
  const parse = {
    isMention: (slug: string) => resolve("@", slug) !== undefined,
    isSlash: (name: string) => resolve("/", name) !== undefined,
  }
  const lead = () => agents().find((token, i) => props.bots[i]?.persona === "lead") ?? agents()[0]
  const recipient = createMemo((): Token | undefined => {
    const text = draftText()
    const named = agents().find(
      (token) => token.kind === "agent" && new RegExp(`(^|[^\\w@/.:-])@${token.slug}(?![\\w/-])`).test(text),
    )
    return named ?? lead()
  })
  const working = createMemo(() => {
    if (!props.room || room.activeId() !== props.threadId) return null
    const status = room.status()
    const slug = Object.keys(status).find((key) => status[key] === "working") ?? room.typingSlugs()[0]
    return slug ? (agents().find((token) => token.kind === "agent" && token.slug === slug)?.title ?? "Kiko") : null
  })
  const stop = () => {
    room.stop()
  }
  const refuse = (refusals: Refusal[]) => {
    const named = refusals.flatMap((r) => (r.name ? [{ id: crypto.randomUUID(), name: r.name, reason: r.reason }] : []))
    if (named.length) setRejected((list) => [...list, ...named])
    for (const r of refusals) if (!r.name) showToastV2({ title: r.reason, variant: "error" })
  }
  const escapeStops = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || !working() || props.editing || props.replyTo) return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.closest('[data-component="composer-dock"]')) return
    if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
    event.preventDefault()
    stop()
  }
  document.addEventListener("keydown", escapeStops)
  onCleanup(() => document.removeEventListener("keydown", escapeStops))

  const selectAnswer = (value: string) =>
    batch(() => {
      const key = props.draftKey
      const displaced = question.progress().customAnswer
      if (key && displaced.trim())
        props.onDraftChange?.(key, carryDisplacedCustomAnswerIntoPrompt(props.draftFor?.(key) ?? "", displaced))
      store.reset()
      question.select(value)
    })
  const hints = createMemo((): string[] => {
    if (question.ask())
      return [
        question.progress().activeQuestion?.allowCustomAnswer === false
          ? "Select an option above"
          : "Type your own answer…",
      ]
    if (props.editing) return ["Edit your message"]
    const name = recipient()?.title || props.title || botById(props.threadId)?.name
    const base = name ? `Message ${name}. @ to mention, / for skills` : "Message"
    if (!name) return [base]
    return [
      base,
      ...data()
        .apps()
        .map((app) => `Ask ${name} about your ${app.title}`),
    ]
  })

  const controller = createPromptInputV2Controller({
    store: [persisted, setPersisted],
    tokens: (trigger, query, atStart) => tokenGroups(pool, trigger, query, atStart),
    onAction: () => requestAnimationFrame(() => setAdding(true)),
    agents,
    openAttachment: (attachment) => {
      const all = media()
      const at = all.findIndex((p) => p.id === attachment.id)
      if (at < 0) return setPreviewing(attachment)
      viewer.open(
        all.map((p) => ({
          src: p.blob.url,
          name: p.filename,
          ...(isVideo({ name: p.filename, type: p.mime }) ? { video: true as const } : {}),
        })),
        at,
      )
    },
    attachments: {
      blocked: () => (question.ask() ? ASKING : null),
      key: () => draftKey() ?? "",
      refuse,
      onAdded: (attachment, file) => {
        if (props.threadId) startUpload(attachment.id, props.threadId, file, attachment.filename, attachment.mime)
        const key = draftKey()
        if (!key) return
        keptFor.set(attachment.id, key)
        void draftFiles().then((m) =>
          m.putDraftFile(key, {
            id: attachment.id,
            name: attachment.filename,
            type: attachment.mime,
            size: attachment.size,
            blob: file,
          }),
        )
      },
      onDiscarded: (attachment) => {
        releaseUpload(attachment.id)
        const key = keptFor.get(attachment.id)
        if (key) void draftFiles().then((m) => m.deleteDraftFile(key, attachment.id))
        keptFor.delete(attachment.id)
      },
    },
    view: {
      submit: {
        canSubmit: () =>
          question.ask()
            ? question.progress().isLastQuestion
              ? question.progress().isComplete
              : question.progress().canAdvance
            : undefined,
        preparing: () => preparingAttachments(),
        blocked,
        onSubmit: () => {
          if (props.disabled || blocked()) return
          if (question.ask()) return question.advance()
          if (!props.threadId) return
          if (failed().length) return void setNudged(true)
          const text = draftText().trimEnd()
          const editing = props.editing
          const parts = boxed()
          const items = parts.map((part) => ({ id: part.id, name: part.filename, type: part.mime, size: part.size }))
          const attachments = pendingAttachments(items)
          const pending = new Map(items.map((item, i) => [item.id, attachments[i]?.pendingId]))
          const body = linkAttachments(text, (id) => {
            const to = pending.get(id)
            return to && `attachment:${to}`
          })
          const refusal = sendRefusal(body, !!editing, attachments)
          if (refusal) return void showToastV2({ title: refusal, variant: "error" })
          if (editing) return finishEdit(editing, text)
          if (runSlash(text)) return void store.reset()
          const files = parts.map((part): MessageFile => ({
            name: part.filename,
            size: part.size,
            type: part.mime,
            src: part.blob.url,
          }))
          if (!body.trim() && files.length === 0) return
          const sentDraftKey = draftKey()
          const uploads = items.map((item) => item.id)
          const accepted = props.onSend(files.length ? { body, files, attachments, uploads } : { body })
          if (accepted === false) return
          held = new Map()
          keptFor.clear()
          if (sentDraftKey) void draftFiles().then((m) => m.clearDraftFiles(sentDraftKey))
          store.reset()
          setRejected([])
          props.onClearReply?.()
        },
      },
    },
  })
  onCleanup(
    receiveFileRefs((paths) => {
      if (question.ask()) return refuse([{ reason: ASKING }])
      controller.insertFileRefs(paths)
    }),
  )

  function typeHere(text: string) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(".composer-dock .ProseMirror")?.focus()
        const tail = /\s*$/.exec(text)![0]
        if (tail) controller.addPart({ type: "text", content: tail, start: 0, end: 0 })
      }),
    )
  }

  function finishEdit(editing: NonNullable<typeof props.editing>, text: string): void {
    if (text.trim() && text !== editing.body) props.onEdit?.(editing.id, text)
    props.onCancelEdit?.()
  }

  const expandPasted = (part: PromptInputV2Attachment) => {
    void fetch(part.blob.url)
      .then((res) => res.text())
      .then((text) => {
        controller.removeAttachment(part.id)
        controller.addPart({ type: "text", content: text, start: 0, end: 0 })
      })
  }

  const below = (
    <>
      <Show when={failed().length > 0}>
        <div
          class="composer-note"
          data-tone="bad"
          data-nudged={nudged() ? "" : undefined}
          data-component="composer-upload-failed"
          role="status"
          onAnimationEnd={() => setNudged(false)}
        >
          <span class="composer-note-dot" aria-hidden="true" />
          <span>{plural(failed().length, "file didn't upload.", "files didn't upload.")}</span>
          <button
            type="button"
            data-action="retry-all"
            onClick={() => failed().forEach((part) => retryUpload(part.id))}
          >
            Retry all
          </button>
          <button
            type="button"
            data-action="send-without"
            onClick={() => {
              for (const part of failed()) controller.removeAttachment(part.id)
              controller.submit()
            }}
          >
            Send without them
          </button>
        </div>
      </Show>
    </>
  )

  const above = (
    <>
      <Show when={working() && !props.editing && draftText().trim() !== ""}>
        <div class="composer-working" data-component="composer-working" role="status">
          <span class="composer-working-dot" aria-hidden="true" />
          <span class="composer-working-text">{working()} is working. It reads this as soon as you send.</span>
          <button type="button" data-action="stop-run" onClick={stop}>
            Stop
          </button>
        </div>
      </Show>
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
                  <button
                    type="button"
                    data-action={action}
                    onClick={() =>
                      action === "open_settings" ? openSettings() : openModelPicker(props.sendBlockAgent)
                    }
                  >
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
      <Show when={props.room}>
        {(room) => (
          <Suspense>
            <ComposerCards room={room()} question={question} onSelectAnswer={selectAnswer} />
          </Suspense>
        )}
      </Show>
      <PromptInputV2
        answering={!!question.ask()}
        readOnly={!!question.ask() && question.progress().activeQuestion?.allowCustomAnswer === false}
        controller={controller}
        disabled={!!props.disabled}
        reply={question.ask() ? undefined : above}
        below={question.ask() ? undefined : below}
        tray={props.tray}
        plus={
          <PlusMenu
            disabled={!!props.disabled}
            pools={{
              files: (query) => data().files(query),
              apps: () => data().apps(),
              skills: () => data().skills(),
              recipes: () => data().recipes(),
              agents: () => agents(),
            }}
            onInsert={(token) => controller.insertToken(token)}
            onAddFiles={() => controller.attach()}
            onAddSomeone={() => setAdding(true)}
            onManageSkills={() => history.push("/customize")}
            onConnectApp={() => openSettings("web-apps")}
          />
        }
        editing={!!props.editing}
        parse={parse}
        chips={{ resolve, roomId: () => props.threadId, chatTitle: () => props.title }}
        recipient={recipient()}
        people={
          props.room
            ? {
                group: props.bots.length > 1,
                adding: adding(),
                onAddingChange: setAdding,
                addItems: () => <AddSomeoneItems chatId={props.threadId} />,
              }
            : undefined
        }
        hints={hints}
        stop={working() && !props.editing && !question.ask() ? stop : undefined}
        rejected={rejected()}
        onDismissRejected={(id) => setRejected((list) => list.filter((item) => item.id !== id))}
        onExpandPasted={expandPasted}
      />
      {viewer.view}
      <Show when={previewing()} keyed>
        {(part) => (
          <Suspense>
            <DraftFileDialog
              part={part}
              onRemove={() => {
                setPreviewing(null)
                controller.removeAttachment(part.id)
              }}
              onClose={() => setPreviewing(null)}
            />
          </Suspense>
        )}
      </Show>
    </>
  )
}
