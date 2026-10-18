import { Show, createSignal, onMount } from "solid-js"
import { signInWithClerk } from "../session"
import { currentStep, installBackend, setWorking } from "./progress"
import { primary } from "./welcome"

const [busy, setBusyRaw] = createSignal(false)
const [error, setError] = createSignal("")
const setBusy = (on: boolean) => {
  setBusyRaw(on)
  setWorking(on)
}

async function open(): Promise<void> {
  setError("")
  setBusy(true)
  try {
    await import("../clerk").then((m) => m.openSignIn())
  } catch (e) {
    setError(e instanceof Error ? e.message : "Could not open sign in. Try again")
  }
  setBusy(false)
}

/** Trades a Clerk session for the backend's own. No session opens the modal, but only on the sign-in step. */
async function enter(before?: () => Promise<void>): Promise<void> {
  setBusy(true)
  setError("")
  try {
    await before?.()
    const next = await signInWithClerk()
    if (next === "connect") installBackend()
    if (next === "none") {
      setBusy(false)
      if (currentStep() === "sign-in") void open()
      return
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : "Could not sign in. Try again")
  }
  setBusy(false)
}

/*
 * Called once as the welcome screen mounts in a hosted build. A Clerk session already in this browser
 * signs in without a click, and a session the modal makes later is picked up without a page load.
 */
export function resumeClerk(search: string): void {
  if (import.meta.env.DEV) {
    const ticket = new URLSearchParams(search).get("ticket")
    if (ticket) return void enter(() => import("../dev-ticket").then((m) => m.signInWithTicket(ticket)))
  }
  void import("../clerk").then((m) => m.onClerkSession(() => void enter())).catch(() => {})
  void enter()
}

/** Hosted sign-in: Clerk's prebuilt modal over this step. Closing it leaves the button to open it again. */
export function ClerkStep() {
  onMount(() => {
    if (!busy()) void open()
  })
  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-step="sign-in">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Sign in
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Use Google or GitHub. Kiko finds your backend from any device you sign in on.
      </p>
      <div style={{ "--i": 2 }}>
        <button type="button" class={primary} disabled={busy()} data-action="sign-in" onClick={() => void open()}>
          {busy() ? "Signing in" : "Continue"}
        </button>
      </div>
      <Show when={error()}>
        <p class="welcome-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
