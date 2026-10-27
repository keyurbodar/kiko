import { ChevronRightIcon, LockIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { For, Show } from "solid-js"
import { agentDisplayName } from "../../lib/names"
import { room } from "../../state/room"
import { deskView, helperSurface, openSurface } from "../side/surfaces"
import { elapsed, type HelperLane, helperWord, startedLabel } from "./helper-model"
import { Snowflake } from "./Snowflake"
import "./helpers.css"

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

export const isGroupChat = () => room.roomMembers().length > 1

function when(lane: HelperLane, now: number): string {
  if (lane.state === "working") return elapsed(now - lane.startedAt)
  return lane.endedAt === undefined ? "" : clock.format(lane.endedAt)
}

function Lane(props: { lane: HelperLane; now: number; chatId: string }) {
  const open = () => openSurface(props.chatId, helperSurface(props.lane.id, props.lane.window))
  const active = () => deskView(props.chatId)?.id === `helper:${props.lane.id}`
  return (
    <button
      type="button"
      class="helper-lane"
      data-component="helper-lane"
      data-state={props.lane.state}
      data-active={active() ? "" : undefined}
      data-helper={props.lane.id}
      onClick={open}
    >
      <Snowflake
        seed={props.lane.id}
        size={32}
        state={props.lane.state}
        disc
        parent={isGroupChat() ? props.lane.slug : undefined}
      />
      <span class="helper-lane-text">
        <span class="helper-lane-title">{props.lane.title}</span>
        <span class="helper-lane-line">{props.lane.line}</span>
      </span>
      <span class="helper-lane-state">
        <span data-word>{helperWord(props.lane.state)}</span>
        <span>{when(props.lane, props.now)}</span>
      </span>
      <RemixIcon icon={ChevronRightIcon} size={14} class="helper-lane-chev" />
    </button>
  )
}

export function HelperLanes(props: { lanes: readonly HelperLane[]; now: number }) {
  const chatId = () => room.activeId()
  const owner = () => props.lanes[0]?.slug ?? ""
  const name = () => agentDisplayName(owner(), room.roomMembers())
  return (
    <Show when={props.lanes.length > 0 && chatId()}>
      {(id) => (
        <div class="helper-lanes" data-component="helper-lanes">
          <div class="helper-lanes-head">
            <span>{startedLabel(props.lanes.length)}</span>
            <span class="helper-private">
              <RemixIcon icon={LockIcon} size={12} />
              {`Private to ${name()}`}
            </span>
          </div>
          <For each={props.lanes}>{(lane) => <Lane lane={lane} now={props.now} chatId={id()} />}</For>
        </div>
      )}
    </Show>
  )
}
