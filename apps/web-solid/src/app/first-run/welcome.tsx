import { Show, createSignal } from "solid-js"
import { signInAsDev, signInWithAccessCode } from "../session"
import { codeFailed, enteringFresh, getStarted, setWorking } from "./progress"

/* The step card's controls, styled in first-run.css: an ink button, a quiet one, and a labelled field. */
export const primary = "welcome-primary"
const secondary = "welcome-secondary"

/** The cover: who Kiko is, and one button. */
export function Welcome() {
  return (
    <div class="welcome-step flex w-full flex-col items-center gap-3" data-step="welcome">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Welcome to Kiko
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Text one agent or a team of them. It reads what you send, works in the background, and answers like a person.
      </p>
      <div class="w-full" style={{ "--i": 2 }}>
        <button type="button" class={primary} data-action="get-started" onClick={getStarted}>
          Get started
        </button>
      </div>
    </div>
  )
}

/** A self-hosted build signs in with the access code. A wrong code keeps the person here with the server's message. */
export function AccessCode() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const run = async (start: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setWorking(true)
    setError("")
    enteringFresh()
    try {
      await start()
    } catch (e) {
      codeFailed()
      setError(e instanceof Error ? e.message : "Could not sign in. Try again")
    }
    setBusy(false)
    setWorking(false)
  }
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    void run(() => signInWithAccessCode(String(form.get("code") ?? "")))
  }
  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-step="sign-in">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Sign in
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Enter the access code you set when you deployed Kiko.
      </p>
      <form class="flex w-full flex-col gap-4" data-component="access-code-form" onSubmit={submit} style={{ "--i": 2 }}>
        <div class="flex flex-col gap-1.5">
          <label class="welcome-label" for="access-code">
            Access code
          </label>
          <input
            id="access-code"
            name="code"
            type="password"
            class="welcome-field"
            placeholder="Your access code"
            autocomplete="off"
            required
            disabled={busy()}
            ref={(el) => queueMicrotask(() => el.focus())}
          />
        </div>
        <button type="submit" class={primary} disabled={busy()}>
          {busy() ? "Signing in" : "Continue"}
        </button>
      </form>
      <Show when={import.meta.env.DEV}>
        <div class="welcome-or" style={{ "--i": 3 }}>
          or
        </div>
        <button type="button" class={secondary} disabled={busy()} onClick={() => void run(() => signInAsDev())} style={{ "--i": 4 }}>
          Continue as dev
        </button>
      </Show>
      <Show when={error()}>
        <p class="welcome-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
