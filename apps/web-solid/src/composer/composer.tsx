import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerProps } from "../lib/types"
import "./composer.css"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import { createPromptInputV2Store } from "./prompt-input/store"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./prompt-input/types"
import { ReplyBar } from "./reply-bar"
import { mediaThumbnail } from "../chat/lib/media"
import { createMediaViewer } from "../chat/media/mediaViewer"

export function Composer(props: ComposerProps) {
  const [persisted, setPersisted] = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })
  const store = createPromptInputV2Store([persisted, setPersisted])

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
        working: () => !!props.busy,
        onSubmit: () => {
          if (props.busy) return
          // There is no conversation to land in, so there is nothing to send.
          if (!props.threadId) return
          const text = store.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
          if (!text.trim()) return
          props.onSend(text)
          store.reset()
          // The quote is answered; keeping it armed would quote it twice.
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
  const reply = (
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
  )

  return (
    <>
      <PromptInputV2 controller={controller} disabled={!!props.busy} reply={reply} />
      {viewer.view}
    </>
  )
}
