import { createRoot, createSignal } from "solid-js"

/*
 * Whether the bot picker is open. Kept apart from the picker so the commands and the sidebar can
 * open it without importing the picker, which loads on first use.
 */
const [open, setOpen] = createRoot(() => createSignal(false))

export const botPickerOpen = open
export const openBotPicker = () => setOpen(true)

let newAgentRequested = false
/** Opens the picker already starting the new agent flow. It waits for Kiko's chat if the list lacks it. */
export const openNewAgentFlow = () => {
  newAgentRequested = true
  setOpen(true)
}
/** The picker calls this once as it opens. */
export const takeNewAgentRequest = () => {
  const requested = newAgentRequested
  newAgentRequested = false
  return requested
}
export const closeBotPicker = () => setOpen(false)

/** What kiko's new agent flow starts from. The human types the purpose after it. */
export const NEW_AGENT_START = "Make me a new agent that "
