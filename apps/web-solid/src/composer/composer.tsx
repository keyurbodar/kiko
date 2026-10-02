import { planAttachments } from "../chat/lib/album"
import { Show, createEffect, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type {
  ComposerProps,
  DocumentItem,
  MediaItem,
  OutgoingMessage,
  WebPagePreview,
} from "../lib/types"
import "./composer.css"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import { createPromptInputV2Store } from "./prompt-input/store"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./prompt-input/types"
import { ReplyBar } from "./reply-bar"
import { replySummary } from "../chat/lib/reply"
import { createMediaViewer } from "../chat/media/mediaViewer"

import { runSlash, slashSuggestions } from "./slash"
import { draftLinkUrl } from "./link-draft"
import { ComposerLinkPreview } from "./link-preview"
import { hasWebPageContent, resolveLinkPreview } from "../chat/lib/linkPreview"

const LINK_PREVIEW_DEBOUNCE_MS = 400

type DraftLink = { url: string; preview: WebPagePreview | null }

/*
 * An attachment's box is reserved from its intrinsic size before the bytes
 * land, so the size has to be real rather than a placeholder: the transcript's
 * height model and the album layouter both divide by it, and a 0x0 item
 * reserves nothing and collapses the row. Decoding is the only way to learn
 * it, and the object URL is already in memory, so this is a decode of bytes
 * the browser holds rather than a fetch. A blob that will not decode yields no
 * item rather than a wrong one.
 */
async function decodeMedia(pending: { src: string; alt: string }): Promise<MediaItem | undefined> {
  const image = new Image()
  image.src = pending.src
  try {
    await image.decode()
  } catch {
    return undefined
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return undefined
  return {
    kind: "photo",
    src: pending.src,
    width: image.naturalWidth,
    height: image.naturalHeight,
    alt: pending.alt,
  }
}
async function readDocument(pending: {
  src: string
  name: string
  mime: string
}): Promise<DocumentItem> {
  let size = 0
  try {
    size = (await (await fetch(pending.src)).blob()).size
  } catch {
    size = 0
  }
  return { name: pending.name, size, mime: pending.mime, src: pending.src }
}

export function Composer(props: ComposerProps) {
  const [persisted, setPersisted] = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })
  const store = createPromptInputV2Store([persisted, setPersisted])
  const [decoding, setDecoding] = createSignal(false)

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
        if (!key) return
        const text = props.draftFor?.(key) ?? ""
        if (text !== draftText()) {
          if (text) store.setText(text)
          else store.reset()
        }
        filledFor = key
      },
    ),
  )
  createEffect(
    on(draftText, (text) => {
      if (filledFor && filledFor === props.draftKey) props.onDraftChange?.(filledFor, text)
    }, { defer: true }),
  )

  const [draftLink, setDraftLink] = createSignal<DraftLink | null>(null)
  const [dismissedLink, setDismissedLink] = createSignal<string | null>(null)

  let linkRequest = 0
  let resolvedUrl: string | null = null

  let linkAbort: AbortController | null = null

  const resolveDraftLink = async (url: string, request: number) => {
    linkAbort?.abort()
    const controller = new AbortController()
    linkAbort = controller
    const preview = await resolveLinkPreview(url, controller.signal)
    if (request !== linkRequest || controller.signal.aborted) return
    resolvedUrl = url
    setDraftLink({ url, preview })
  }

  const clearDraftLink = () => {
    linkRequest += 1
    resolvedUrl = null
    setDraftLink(null)
    setDismissedLink(null)
  }

  createEffect(() => {
    const url = draftLinkUrl(draftText())
    const dismissed = dismissedLink()

    if (url === null) {
      if (dismissed !== null) setDismissedLink(null)
      linkRequest += 1
      resolvedUrl = null
      setDraftLink(null)
      return
    }

    if (url === dismissed) {
      linkRequest += 1
      setDraftLink(null)
      return
    }

    if (resolvedUrl === url) return

    linkRequest += 1
    linkAbort?.abort()
    const request = linkRequest
    setDraftLink({ url, preview: null })
    const timer = setTimeout(() => void resolveDraftLink(url, request), LINK_PREVIEW_DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  /*
   * The composer's own viewer, rather than one shared with the transcript.
   * A viewer belongs to the surface that opens it: this one is opened by a
   * thumbnail in the attachment strip, that one by a picture in a message, and
   * neither surface can be reached while the other's modal is up. Hoisting one
   * instance to the app would mean threading an `open` callback through
   * `main.tsx`, `MessageList` and `Composer` to save a signal pair.
   */
  const viewer = createMediaViewer()

  const botById = (botId: string | undefined) =>
    botId === undefined ? undefined : props.bots.find((bot) => bot.id === botId)

  const context = (): PromptInputV2Suggestion[] =>
    props.bots.map((bot) => ({
      id: `agent-${bot.id}`,
      kind: "agent",
      label: `@${bot.name}`,
      description: bot.persona ?? "agent",
      mention: { type: "agent", name: bot.name, content: `@${bot.name}`, start: 0, end: 0 },
    }))

  /*
   * The placeholder names the conversation, the way kat's says `message kat`.
   * Lowercase because that is the register the whole app writes chrome in, and
   * taken from the roster rather than hardcoded so it stays true when the
   * reader switches conversation.
   */
  const placeholder = () => {
    const name = props.title || botById(props.threadId)?.name
    return name ? `message ${name.toLowerCase()}` : "message"
  }

  const controller = createPromptInputV2Controller({
    store: [persisted, setPersisted],
    commands: slashSuggestions,
    context,
    searchContextFiles: () => [],
    /*
     * Without this the strip's thumbnail is a dead click: `onAttachmentClick`
     * is wired all the way down to the controller, and the controller calls
     * `input.openAttachment?.()` — which was undefined, so the click was
     * swallowed with no dialog and no feedback.
     */
    openAttachment: (attachment) =>
      viewer.open(
        [
          {
            kind: "photo",
            src: attachment.blob.url,
            // An attachment's size is not known until its bytes are read, and
            // the viewer fits by `object-contain`, so it does not need one.
            width: 0,
            height: 0,
            alt: attachment.filename,
          },
        ],
        0,
        attachment.filename,
      ),
    attachments: {
      directory: () => "",
      isDialogActive: () => false,
      warn: () => {},
      duplicate: () => {},
      onError: () => {},
    },
    view: {
      placeholder,
      submit: {
        stopping: () => false,
        working: () => !!props.busy || decoding(),
        onSubmit: () => {
          if (props.busy) return
          // There is no conversation to land in, so there is nothing to send.
          if (!props.threadId) return
          const text = draftText()
          if (runSlash(text)) return void store.reset()
          const files = store.state.prompt.flatMap((part) => (part.type === "image" ? [part] : []))
          // A file that is not a picture turns the whole send into a list of documents.
          const grid = planAttachments(files) !== "list"
          const pending = store.state.prompt.flatMap((part) =>
            grid && part.type === "image" && part.mime.startsWith("image/")
              ? [{ src: part.blob.url, alt: part.filename }]
              : [],
          )
          const documents = store.state.prompt.flatMap((part) =>
            part.type === "image" && !(grid && part.mime.startsWith("image/"))
              ? [{ src: part.blob.url, name: part.filename, mime: part.mime }]
              : [],
          )
          if (!text.trim() && pending.length === 0 && documents.length === 0) return
          const link = draftLink()
          const webPage =
            link?.preview && text.includes(link.url) && hasWebPageContent(link.preview)
              ? link.preview
              : undefined
          store.reset()
          clearDraftLink()
          setDecoding(true)
          void Promise.all([
            Promise.all(pending.map(decodeMedia)),
            Promise.all(documents.map(readDocument)),
          ]).then(([decoded, files]) => {
            setDecoding(false)
            const media = decoded.filter((item) => item !== undefined)
            const message: OutgoingMessage = { body: text }
            if (media.length > 0) message.media = media
            if (files.length > 0) message.documents = files
            if (webPage) message.webPage = webPage
            props.onSend(message)
            props.onClearReply?.()
          })
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
      <Show when={props.replyTo}>
        {(message) => (
          <ReplyBar
            summary={replySummary(message())}
            role={
              message().sender === "user"
                ? "you"
                : (botById(message().botId)?.name ?? (props.bots.length === 1 ? props.bots[0]!.name : "agent")).toLowerCase()
            }
            onJump={() => props.onJumpToReply?.(message().id)}
            onDismiss={() => props.onClearReply?.()}
          />
        )}
      </Show>

      <Show when={draftLink()?.preview ? draftLink() : null}>
        {(link) => (
          <ComposerLinkPreview
            url={link().url}
            preview={link().preview}
            onDismiss={() => setDismissedLink(link().url)}
          />
        )}
      </Show>
    </>
  )

  return (
    <>
      <PromptInputV2 controller={controller} disabled={!!props.busy} reply={above} />
      {viewer.view}
    </>
  )
}
