import type { LoginEvent, LoginPrompt, UserSignal } from "@kiko/protocol"
import { createComputed, createRoot, on } from "solid-js"
import { connection } from "../state/connection"
import { attempt, owner } from "../state/runtime"
import { onUserSignal } from "../state/user"

export type SignIn = {
  status: "running" | "done" | "error"
  code: Extract<LoginEvent, { type: "device_code" }> | null
  link: Extract<LoginEvent, { type: "auth_url" }> | null
  note: string | null
  prompt: { promptId: string; prompt: LoginPrompt } | null
  error: string | null
}

const started: SignIn = { status: "running", code: null, link: null, note: null, prompt: null, error: null }

type LoginFrame = Extract<UserSignal, { t: `login.${string}` }>

function reduceSignIn(state: SignIn, frame: LoginFrame): SignIn {
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
  cancel(): void
}

export function startSignIn(provider: string, onState: (state: SignIn) => void): SignInHandle {
  const loginId = crypto.randomUUID()
  let state = started
  let ended = false
  const offs: (() => void)[] = []
  const finish = () => {
    ended = true
    for (const off of offs.splice(0)) off()
  }
  const fail = (error: string) => {
    if (ended) return
    finish()
    state = { ...state, status: "error", prompt: null, error }
    onState(state)
  }
  const receive = (frame: LoginFrame) => {
    if (ended || frame.loginId !== loginId) return
    state = reduceSignIn(state, frame)
    onState(state)
    if (state.status !== "running") finish()
  }
  for (const t of ["login.notify", "login.prompt", "login.done", "login.error"] as const)
    offs.push(onUserSignal(t, receive))
  offs.push(
    createRoot((dispose) => {
      createComputed(
        on(connection.connected, (connected) => !connected && fail("The connection closed. Try again."), {
          defer: true,
        }),
      )
      return dispose
    }),
  )
  onState(state)
  void attempt(owner.commands.loginStart, { loginId, provider }, fail)
  return {
    answer(promptId, value) {
      if (ended) return
      state = { ...state, prompt: null }
      onState(state)
      void attempt(owner.commands.loginAnswer, { loginId, promptId, value }, fail)
    },
    cancel() {
      if (ended) return
      void attempt(owner.commands.loginCancel, { loginId }, () => {})
      finish()
    },
  }
}
