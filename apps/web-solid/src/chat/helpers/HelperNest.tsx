import { For, Show } from "solid-js"
import { room } from "../../state/room"
import { helperSurface, openSurface } from "../side/surfaces"
import { helperWord } from "./helper-model"
import { isGroupChat } from "./group-chat"
import { Snowflake } from "./Snowflake"
import "./helpers.css"

export function HelperNest(props: { chatId: string }) {
  const lanes = () => (room.activeId() === props.chatId ? room.nestedHelpers() : [])
  return (
    <Show when={lanes().length > 0}>
      <div class="helper-nest" data-component="helper-nest" role="group" aria-label="Helpers">
        <For each={lanes()}>
          {(lane) => (
            <button
              type="button"
              class="helper-nest-row"
              data-state={lane.state}
              data-helper={lane.id}
              onClick={() => openSurface(props.chatId, helperSurface(lane.id, lane.window))}
            >
              <Snowflake seed={lane.id} size={20} state={lane.state} parent={isGroupChat() ? lane.slug : undefined} />
              <span class="min-w-0 flex-1 truncate">{lane.title}</span>
              <Show when={lane.state !== "working"}>
                <span class="helper-nest-word">{helperWord(lane.state)}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
