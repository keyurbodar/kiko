import { createStore } from "solid-js/store"
import type { ComposerProps } from "../lib/types"
import { PromptInputV2 } from "./prompt-input"
import { createPromptInputV2Controller } from "./prompt-input/interaction"
import { createPromptInputV2Store } from "./prompt-input/store"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./prompt-input/types"

export function Composer(props: ComposerProps) {
  const [persisted, setPersisted] = createStore<PromptInputV2PersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })
  const store = createPromptInputV2Store([persisted, setPersisted])

  const context = (): PromptInputV2Suggestion[] =>
    props.bots.map((bot) => ({
      id: `agent-${bot.id}`,
      kind: "agent",
      label: `@${bot.name}`,
      description: bot.persona ?? "Agent",
      mention: { type: "agent", name: bot.name, content: `@${bot.name}`, start: 0, end: 0 },
    }))

  const controller = createPromptInputV2Controller({
    store: [persisted, setPersisted],
    commands: () => [],
    context,
    searchContextFiles: () => [],
    attachments: {
      directory: () => "",
      isDialogActive: () => false,
      warn: () => {},
      duplicate: () => {},
      onError: () => {},
    },
    view: {
      placeholder: () => "Message",
      submit: {
        stopping: () => false,
        working: () => !!props.busy,
        onSubmit: () => {
          if (props.busy) return
          const text = store.state.prompt.map((part) => ("content" in part ? part.content : "")).join("")
          if (!text.trim()) return
          props.onSend(text)
          store.reset()
        },
        onStop: () => {},
      },
    },
  })

  return <PromptInputV2 controller={controller} disabled={!!props.busy} />
}
