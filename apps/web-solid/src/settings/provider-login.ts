import type { LoginEvent, LoginPrompt, UserToClient } from "@kiko/protocol"
import { type UserChannel, userChannel } from "../sync/socket"

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
export function startSignIn(provider: string, onState: (state: SignIn) => void, channel: UserChannel = userChannel): SignInHandle {
  const loginId = crypto.randomUUID()
  let state = started
  let ended = false
  let sent = false
  const offs: (() => void)[] = []
  const finish = () => {
    ended = true
    for (const off of offs) off()
  }
  const receive = (frame: LoginFrame) => {
    if (ended || frame.loginId !== loginId) return
    state = reduceSignIn(state, frame)
    onState(state)
    if (state.status !== "running") finish()
  }
  for (const t of ["login.notify", "login.prompt", "login.done", "login.error"] as const) offs.push(channel.on(t, receive))
  const start = () => {
    if (!ended && !sent) sent = channel.send({ t: "login.start", loginId, provider })
  }
  offs.push(channel.onOpen(start))
  offs.push(channel.onStatus((status) => {
    if (status !== "closed" || !sent || ended) return
    finish()
    state = { ...state, status: "error", prompt: null, error: "The connection closed. Try again." }
    onState(state)
  }))
  onState(state)
  start()
  return {
    answer(promptId, value) {
      if (ended) return
      state = { ...state, prompt: null }
      onState(state)
      channel.send({ t: "login.answer", loginId, promptId, value })
    },
    cancel() {
      if (ended) return
      if (sent) channel.send({ t: "login.cancel", loginId })
      finish()
    },
  }
}
