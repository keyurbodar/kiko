import { Show, createSignal } from "solid-js"
import { signInWithClerk } from "../session"
import { installBackend, setWorking } from "./progress"
import { Cover, primary } from "./welcome"

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

/*
 * Called once as the sign-in step mounts in a hosted build. A Clerk session already in this browser
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

/** Opens Clerk's sign-in modal, where the person chooses a sign-in method. */
export function ClerkStep() {
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
