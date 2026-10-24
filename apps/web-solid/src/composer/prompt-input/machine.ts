import type { Token, Trigger } from "../tokens"

export type PromptInputV2Popover =
  | { type: "closed" }
  | { type: "open"; trigger: Trigger; query: string; start: number; atStart: boolean; activeID?: string }

export type PromptInputV2InteractionState = {
  popover: PromptInputV2Popover
  drag: "idle" | "active"
  dismissed?: number
}

export type PromptInputV2InteractionEvent =
  | { type: "input.changed"; value: string; cursor: number }
  | { type: "popover.results"; ids: string[] }
  | { type: "popover.active"; id: string }
  | { type: "popover.close" }
  | { type: "popover.select"; item: Token }
  | { type: "key.down"; key: string; ctrl: boolean; composing: boolean; ids: string[] }
  | { type: "drag.enter" }
  | { type: "drag.leave" }

export type PromptInputV2InteractionCommand =
  | { type: "token.insert"; trigger: Trigger; item: Token }
  | { type: "suggestion.select"; id: string }
  | { type: "focus.editor" }

export type PromptInputV2Transition = {
  state: PromptInputV2InteractionState
  commands: PromptInputV2InteractionCommand[]
  handled: boolean
}

const TRIGGER = /(?:^|\s)([@/])([^\s@/]*)$/

export function createPromptInputV2InteractionState(): PromptInputV2InteractionState {
  return { popover: { type: "closed" }, drag: "idle" }
}

export function findTrigger(
  value: string,
  cursor: number,
): { trigger: Trigger; query: string; start: number; atStart: boolean } | null {
  const before = value.slice(0, cursor)
  const match = TRIGGER.exec(before)
  if (!match) return null
  const query = match[2] ?? ""
  const start = before.length - query.length - 1
  return { trigger: match[1] as Trigger, query, start, atStart: before.slice(0, start).trim() === "" }
}

export function reducePromptInputV2(
  state: PromptInputV2InteractionState,
  event: PromptInputV2InteractionEvent,
): PromptInputV2Transition {
  if (event.type === "input.changed") return inputChanged(state, event.value, event.cursor)
  if (event.type === "popover.results") return resultsChanged(state, event.ids)
  if (event.type === "popover.active") return activeChanged(state, event.id)
  if (event.type === "popover.close") return result({ ...state, popover: { type: "closed" } })
  if (event.type === "popover.select") return selected(state, event.item)
  if (event.type === "key.down") return keyDown(state, event)
  return result({ ...state, drag: event.type === "drag.enter" ? "active" : "idle" })
}

function inputChanged(state: PromptInputV2InteractionState, value: string, cursor: number): PromptInputV2Transition {
  const found = findTrigger(value, cursor)
  if (!found) return result({ ...state, popover: { type: "closed" }, dismissed: undefined })
  if (found.start === state.dismissed) return result({ ...state, popover: { type: "closed" } })
  const activeID =
    state.popover.type === "open" && state.popover.start === found.start ? state.popover.activeID : undefined
  return result({ ...state, popover: { type: "open", ...found, activeID }, dismissed: undefined })
}

function resultsChanged(state: PromptInputV2InteractionState, ids: string[]): PromptInputV2Transition {
  if (state.popover.type === "closed") return result(state)
  const activeID = state.popover.activeID && ids.includes(state.popover.activeID) ? state.popover.activeID : ids[0]
  if (activeID === state.popover.activeID) return result(state)
  return result({ ...state, popover: { ...state.popover, activeID } })
}

function activeChanged(state: PromptInputV2InteractionState, id: string): PromptInputV2Transition {
  if (state.popover.type === "closed" || state.popover.activeID === id) return result(state)
  return result({ ...state, popover: { ...state.popover, activeID: id } })
}

function selected(state: PromptInputV2InteractionState, item: Token): PromptInputV2Transition {
  const trigger = state.popover.type === "open" ? state.popover.trigger : item.kind === "agent" ? "@" : "/"
  return result({ ...state, popover: { type: "closed" } }, [
    { type: "token.insert", trigger, item },
    { type: "focus.editor" },
  ])
}

function keyDown(
  state: PromptInputV2InteractionState,
  event: Extract<PromptInputV2InteractionEvent, { type: "key.down" }>,
): PromptInputV2Transition {
  const popover = state.popover
  if (popover.type === "closed" || event.composing) return result(state)
  if (event.key === "Escape" || (event.ctrl && event.key.toLowerCase() === "g"))
    return result({ ...state, popover: { type: "closed" }, dismissed: popover.start }, [{ type: "focus.editor" }], true)
  if ((event.key === "Tab" || event.key === "Enter") && popover.activeID)
    return result(state, [{ type: "suggestion.select", id: popover.activeID }], true)
  const direction =
    event.key === "ArrowDown" || (event.ctrl && event.key === "n")
      ? 1
      : event.key === "ArrowUp" || (event.ctrl && event.key === "p")
        ? -1
        : 0
  if (!direction || event.ids.length === 0) return result(state)
  const current = popover.activeID ? event.ids.indexOf(popover.activeID) : -1
  const index =
    current < 0
      ? direction === 1
        ? 0
        : event.ids.length - 1
      : (current + direction + event.ids.length) % event.ids.length
  return result({ ...state, popover: { ...popover, activeID: event.ids[index] } }, [], true)
}

function result(
  state: PromptInputV2InteractionState,
  commands: PromptInputV2InteractionCommand[] = [],
  handled = false,
): PromptInputV2Transition {
  return { state, commands, handled }
}
