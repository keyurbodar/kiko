import type { RunErrorAction, RunErrorKind, SystemEvent } from "@kiko/protocol"
import type { Glyph } from "@kiko/ui/remix-icon"
import {
  AlertCircleIcon,
  ChatIcon,
  ClockIcon,
  GroupIcon,
  MemoryIcon,
  MinusIcon,
  ModelIcon,
  PlusIcon,
  StopIcon,
} from "@kiko/ui/icons"
import { createMemo, createSignal, onCleanup, Show, Suspense } from "solid-js"
import { openSettings } from "../../lib/errors"
import { room } from "../../state/room"
import type { ChatMessage } from "../../lib/types"
import { openModelPicker } from "../../settings/model-picker"
import { reconnect } from "../../settings/provider-problem"
import { eventRow } from "../lib/event-line"
import { RunErrorCard } from "./RunErrorCard"
import { SystemRow, type RowAction } from "./SystemRow"
import ComputerCard from "../computer/ComputerCard"

const ICONS: Record<string, Glyph> = {
  created: GroupIcon,
  routine_created: ClockIcon,
  model_changed: ModelIcon,
  compacted: MemoryIcon,
  group_formed: GroupIcon,
  member_added: PlusIcon,
  member_removed: MinusIcon,
  delegated: ChatIcon,
  routine: ClockIcon,
  agent_message: ChatIcon,
  run_stopped: StopIcon,
  run_error: AlertCircleIcon,
}

const RETRY_WAIT_MS = 8_000

const LABELS: Record<RunErrorAction, string> = {
  retry: "Retry",
  change_model: "Change model",
  open_settings: "Settings",
}

export function ActivityEvent(props: { message: ChatMessage; name: (slug: string) => string; latest?: boolean }) {
  const row = createMemo(() => eventRow(props.message, props.name))
  const failed = () =>
    props.message.event?.kind === "run_error"
      ? (props.message.event as Extract<SystemEvent, { kind: "run_error" }>)
      : undefined
  const [retrying, setRetrying] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const busy = (slug: string) => retrying() || room.typingSlugs().includes(slug as never)

  const failureAction = (
    event: { slug: string; reason: RunErrorKind; provider?: string | undefined },
    action: RunErrorAction,
  ): RowAction => {
    const signIn = action === "open_settings" && event.reason === "signed_out" && !!event.provider
    return {
      label: signIn ? "Sign in again" : LABELS[action],
      "data-action": action,
      ...(action === "retry" && busy(event.slug) ? { busy: "Retrying" } : {}),
      onClick: () => {
        if (action === "retry") {
          setRetrying(true)
          timer = setTimeout(() => setRetrying(false), RETRY_WAIT_MS)
          room.retryRun(props.message.id)
        } else if (action === "change_model") openModelPicker(event.slug)
        else if (signIn && event.provider) reconnect(event.provider)
        else openSettings()
      },
    }
  }

  const actions = (): RowAction[] | undefined => {
    const event = failed()
    if (event) return props.latest ? event.actions.slice(0, 2).map((action) => failureAction(event, action)) : undefined
    return props.message.goto ? [{ label: "Open chat", chat: props.message.goto }] : undefined
  }

  return (
    <Show
      when={props.message.event?.kind !== "computer_control"}
      fallback={
        <Suspense>
          <ComputerCard message={props.message} />
        </Suspense>
      }
    >
      <Show when={row()}>
        {(r) => (
          <Show
            when={!failed()}
            fallback={
              <RunErrorCard
                label={r().label}
                reason={r().detail}
                note={r().note}
                actions={actions()}
                latest={props.latest}
                data-message-id={props.message.id}
              />
            }
          >
            <SystemRow
              label={r().label}
              detail={r().detail}
              title={r().title}
              tone={r().tone}
              icon={ICONS[props.message.event?.kind ?? "created"]}
              actions={actions()}
              stitch={props.message.event?.kind === "model_changed"}
              data-component="chat-event"
              data-message-id={props.message.id}
            />
          </Show>
        )}
      </Show>
    </Show>
  )
}
