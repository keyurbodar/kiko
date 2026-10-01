import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerProps, MediaItem, OutgoingMessage, WebPagePreview } from "../lib/types"
import "./composer.css"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import { createPromptInputV2Store } from "./prompt-input/store"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./prompt-input/types"
import { ReplyBar } from "./reply-bar"
import { mediaThumbnail } from "../chat/lib/media"
import { createMediaViewer } from "../chat/media/mediaViewer"

import { draftLinkUrl } from "./link-draft"
import { ComposerLinkPreview } from "./link-preview"
import { resolveLinkPreview } from "../chat/lib/linkPreview"

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

  const [draftLink, setDraftLink] = createSignal<DraftLink | null>(null)
  const [dismissedLink, setDismissedLink] = createSignal<string | null>(null)

  let linkRequest = 0
  let resolvedUrl: string | null = null

  const resolveDraftLink = async (url: string, request: number) => {
    const preview = await resolveLinkPreview(url)
    if (request !== linkRequest) return
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
      description: bot.persona ?? "Agent",
      mention: { type: "agent", name: bot.name, content: `@${bot.name}`, start: 0, end: 0 },
    }))

  /*
   * The placeholder names the conversation, the way kat's says `message kat`.
   * Lowercase because that is the register the whole app writes chrome in, and
   * taken from the roster rather than hardcoded so it stays true when the
   * reader switches conversation.
   */
  const placeholder = () => {
    const name = botById(props.threadId)?.name
    return name ? `message ${name.toLowerCase()}` : "message"
  }

  const controller = createPromptInputV2Controller({
    store: [persisted, setPersisted],
    commands: () => [],
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
          const pending = store.state.prompt.flatMap((part) =>
            part.type === "image" && part.mime.startsWith("image/")
              ? [{ src: part.blob.url, alt: part.filename }]
              : [],
          )
          if (!text.trim() && pending.length === 0) return
          store.reset()
          clearDraftLink()
          setDecoding(true)
          void Promise.all(pending.map(decodeMedia)).then((decoded) => {
            setDecoding(false)
            const media = decoded.filter((item) => item !== undefined)
            const message: OutgoingMessage = { body: text }
            if (media.length > 0) message.media = media
            props.onSend(message)
            // The quote is answered; keeping it armed would quote it twice.
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
            message={message()}
            role={
              message().sender === "user"
                ? "you"
                : (botById(message().botId)?.name ?? "agent").toLowerCase()
            }
            thumb={mediaThumbnail(message().media?.[0])}
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
