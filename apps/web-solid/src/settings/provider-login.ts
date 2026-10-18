import type { LoginEvent, LoginPrompt, UserToClient } from "@kiko/protocol"
import { socketProtocols } from "../lib/api"
import { urls } from "../lib/store"

// Provider sign-in from the browser. The server runs the flow; this
// side shows what it says and sends back what it asks. Each sign-in opens its own
// user socket and closes it when the sign-in ends or the dialog closes, and the server
// drops a login whose socket closed. Nothing here is stored.

export type SignIn = {
  status: "running" | "done" | "error"
  /** The device code or the sign-in link to show. The newest one wins. */
  code: Extract<LoginEvent, { type: "device_code" }> | null
  link: Extract<LoginEvent, { type: "auth_url" }> | null
  /** The newest progress or info line. */
  note: string | null
  prompt: { promptId: string; prompt: LoginPrompt } | null
  error: string | null
}

export const started: SignIn = { status: "running", code: null, link: null, note: null, prompt: null, error: null }

type LoginFrame = Extract<UserToClient, { t: `login.${string}` }>

/** The next state after one frame of this login. Pure, so the table of cases is tested. */
export function reduceSignIn(state: SignIn, frame: LoginFrame): SignIn {
  switch (frame.t) {
    case "login.notify": {
      const e = frame.event
      if (e.type === "device_code") return { ...state, code: e }
      if (e.type === "auth_url") return { ...state, link: e }
      return { ...state, note: e.message }
    }
    case "login.prompt":
      return { ...state, prompt: { promptId: frame.promptId, prompt: frame.prompt } }
    case "login.done":
      return { ...state, status: "done", prompt: null }
    case "login.error":
      return { ...state, status: "error", prompt: null, error: frame.reason === "cancelled" ? null : frame.message }
  }
}

export type SignInHandle = {
  answer(promptId: string, value: string): void
  /** Ends the sign-in. Safe to call more than once and after it ended. */
  cancel(): void
}

/** Starts a sign-in for `provider`. `onState` sees every change, the last one final. */
export function startSignIn(provider: string, onState: (state: SignIn) => void): SignInHandle {
  const loginId = crypto.randomUUID()
  const socket = new WebSocket(urls.user(), socketProtocols())
  let state = started
  let ended = false
  const send = (frame: object) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
  }
  const finish = () => {
    ended = true
    socket.close()
  }
  onState(state)
  socket.onopen = () => send({ t: "login.start", loginId, provider })
  socket.onmessage = (event) => {
    let frame: LoginFrame
    try {
      frame = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (!frame || typeof frame.t !== "string" || !frame.t.startsWith("login.") || frame.loginId !== loginId) return
    state = reduceSignIn(state, frame)
    onState(state)
    if (state.status !== "running") finish()
  }
  socket.onclose = () => {
    if (ended) return
    ended = true
    state = { ...state, status: "error", prompt: null, error: "The connection closed. Try again." }
    onState(state)
  }
  return {
    answer(promptId, value) {
      if (ended) return
      state = { ...state, prompt: null }
      onState(state)
      send({ t: "login.answer", loginId, promptId, value })
    },
    cancel() {
      if (ended) return
      send({ t: "login.cancel", loginId })
      finish()
    },
  }
}
