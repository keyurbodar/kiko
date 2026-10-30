import { LockIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { agentDisplayName } from "../../lib/names"
import { room } from "../../state/room"
import { GLYPH } from "../run/glyphs"
import { Shine } from "../run/Shine"
import { iconOf, liveLabel } from "../run/run-log"
import { helperSurface, openSurface } from "../side/surfaces"
import { elapsed, type HelperLane } from "./helper-model"
import { Snowflake } from "./Snowflake"
import { isGroupChat } from "./group-chat"
import "./helpers.css"

function Tabs(props: { chatId: string; lanes: readonly HelperLane[]; active: string }) {
  return (
    <div class="helper-peek-tabs" role="tablist" aria-label="Helpers">
      <For each={props.lanes}>
        {(lane) => (
          <button
            type="button"
            role="tab"
            class="helper-peek-tab"
            aria-selected={lane.id === props.active}
            onClick={() => openSurface(props.chatId, helperSurface(lane.id, lane.window))}
          >
            <Snowflake seed={lane.id} size={16} state={lane.state} />
            <span>{lane.title}</span>
          </button>
        )}
      </For>
    </div>
  )
}

function Steps(props: { lane: HelperLane }) {
  return (
    <div class="helper-peek-steps" data-component="helper-steps">
      <For each={props.lane.steps}>
        {(step) => {
          const glyph = () => iconOf(step)
          return (
            <div
              class="helper-peek-step"
              data-note={step.note ? "" : undefined}
              data-failed={step.status === "failed" ? "" : undefined}
            >
              <Show when={glyph()} fallback={<span class="size-4 shrink-0" />}>
                {(icon) => <RemixIcon icon={GLYPH[icon()]} size={16} class="shrink-0" />}
              </Show>
              <Shine running={step.status === "running"}>{liveLabel(step) || step.name}</Shine>
            </div>
          )
        }}
      </For>
    </div>
  )
}

export function HelperPeek(props: { helper: string; window: string; chatId: string }) {
  createEffect(() => room.loadRunSteps(props.window))
  const lane = createMemo(() => room.helpers().find((l) => l.id === props.helper))
  const siblings = createMemo(() => room.helpers().filter((l) => l.window === props.window))
  const parent = () => lane()?.slug ?? props.window.split("#")[0] ?? ""
  const name = () => agentDisplayName(parent(), room.roomMembers())
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (lane()?.state !== "working") return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <div class="helper-peek" data-component="helper-peek" data-helper={props.helper}>
      <Show when={siblings().length > 1}>
        <Tabs chatId={props.chatId} lanes={siblings()} active={props.helper} />
      </Show>
      <Show when={lane()} fallback={<p class="px-1 text-ui text-fg3">Loading this helper…</p>}>
        {(current) => (
          <>
            <div class="flex items-center gap-3">
              <Snowflake
                seed={current().id}
                size={44}
                state={current().state}
                disc
                parent={isGroupChat() ? current().slug : undefined}
              />
              <div class="flex min-w-0 flex-col">
                <h3 class="truncate type-row text-fg" data-component="helper-title">
                  {current().title}
                </h3>
                <span class="truncate text-label text-fg3">
                  {`${name()}'s helper, started ${elapsed(now() - current().startedAt)} ago`}
                </span>
              </div>
            </div>
            <p class="helper-peek-brief" data-component="helper-brief">
              <span>{`${name()} asked: `}</span>
              {current().task}
            </p>
            <Steps lane={current()} />
          </>
        )}
      </Show>
      <div class="helper-peek-foot">
        <RemixIcon icon={LockIcon} size={12} />
        {`Private. You can watch; talk to ${name()} to change it.`}
      </div>
    </div>
  )
}
