import { useLocation } from "@tanstack/solid-router"
import { Show, createSignal, onCleanup } from "solid-js"
import { allowClerkResume, autoResume, cancelAuthAttempt, signInWithClerk } from "../session"
import { currentStep, installBackend, setWorking } from "./progress"
import { Cover, primary } from "./welcome"

const [busy, setBusyRaw] = createSignal(false)
const [error, setError] = createSignal("")
const setBusy = (on: boolean) => {
  setBusyRaw(on)
  setWorking(on)
}

async function open(): Promise<void> {
  allowClerkResume()
  setError("")
  setBusy(true)
  try {
    await import("../clerk").then((m) => m.openSignIn())
  } catch (e) {
    setError(e instanceof Error ? e.message : "Could not open sign in. Try again")
  }
  setBusy(false)
}

async function enter(before?: () => Promise<void>): Promise<void> {
  setBusy(true)
  setError("")
  try {
    await before?.()
    const next = await signInWithClerk()
    if (next === "connect") installBackend()
  } catch (e) {
    setError(e instanceof Error ? e.message : "Could not sign in. Try again")
  }
  setBusy(false)
}

function resumeClerk(search: string): () => void {
  let disposed = false
  let unsubscribe: (() => void) | undefined
  const run = (active: boolean) => {
    if (disposed || !autoResume() || (active && currentStep() === "cloudflare")) return
    void enter()
  }
  setError("")
  setBusy(false)
  if (import.meta.env.DEV) {
    const ticket = new URLSearchParams(search).get("ticket")
    if (ticket) {
      void enter(() => import("../dev-ticket").then((m) => m.signInWithTicket(ticket)))
      return () => {
        disposed = true
      }
    }
  }
  void import("../clerk")
    .then((m) => m.onClerkSession(run))
    .then((stop) => {
      if (disposed) stop()
      else unsubscribe = stop
    })
    .catch(() => {})
  return () => {
    disposed = true
    unsubscribe?.()
    cancelAuthAttempt()
  }
}

export function ClerkStep() {
  onCleanup(resumeClerk(useLocation()().searchStr))
  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-step="sign-in">
      <Cover />
      <div class="mt-2 flex w-full flex-col gap-2" style={{ "--i": 2 }}>
        <button type="button" class={primary} disabled={busy()} data-action="sign-in" onClick={() => void open()}>
          {busy() ? "Signing in" : "Sign in"}
        </button>
      </div>
      <p class="text-center text-xs text-muted-foreground" style={{ "--i": 3 }}>
        Secured by Clerk
      </p>
      <Show when={error()}>
        <p class="text-center text-sm text-[var(--error)]" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
