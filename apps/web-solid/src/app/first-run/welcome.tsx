import { Show, createSignal } from "solid-js"
import { signInAsDev, signInWithAccessCode } from "../session"
import { errorText, field, primary, secondary } from "./controls"
import { Dots } from "./dots"

export function Cover(props: { title: string; lede: string }) {
  return (
    <>
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        {props.title}
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        {props.lede}
      </p>
    </>
  )
}

export function AccessCode() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const run = async (start: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      await start()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Try again")
    }
    setBusy(false)
  }
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    void run(() => signInWithAccessCode(String(form.get("code") ?? "")))
  }
  return (
    <div class="welcome-step" data-step="sign-in">
      <Cover
        title="Meet your team."
        lede="They're asleep for now. Enter your access code and they'll start waking up."
      />
      <form class="ob-form" data-component="access-code-form" onSubmit={submit} style={{ "--i": 2 }}>
        <input
          name="code"
          type="password"
          class={field}
          data-invalid={error() ? "" : undefined}
          aria-label="Access code"
          placeholder="Access code"
          autocomplete="off"
          required
          disabled={busy()}
          ref={(el) => queueMicrotask(() => el.focus())}
        />
        <Show when={error()}>
          <p class={errorText} role="alert">
            {error()}
          </p>
        </Show>
        <div class="ob-cta">
          <button type="submit" class={primary} data-cta disabled={busy()}>
            {busy() ? "Signing in" : "Continue"}
            <Show when={busy()}>
              <Dots />
            </Show>
          </button>
          <Show when={import.meta.env.DEV}>
            <button type="button" class={secondary} disabled={busy()} onClick={() => void run(() => signInAsDev())}>
              Continue as dev
            </button>
          </Show>
        </div>
      </form>
    </div>
  )
}
