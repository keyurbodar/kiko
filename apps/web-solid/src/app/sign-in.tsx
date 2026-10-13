import { Show, createSignal } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { signInAsDev, signInWithAccessCode } from "./session"

/*
 * The sign-in screen. It loads as its own chunk, so a signed-in person never
 * downloads it. The access code form is the way in. The dev button shows only in a
 * development build, and its route answers only on a local host. One click starts
 * the sign-in and every button holds until it ends, so a double tap cannot start two.
 */
const button =
  "flex h-11 w-full items-center justify-center rounded-lg bg-btn px-4 text-sm font-medium text-text outline-none hover:bg-btn-hover disabled:cursor-wait disabled:opacity-60"

const field = "h-11 w-full rounded-lg bg-btn px-4 text-sm text-text outline-none placeholder:text-weak"

export default function SignIn() {
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
  const submitCode = (event: SubmitEvent) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    void run(() => signInWithAccessCode(String(form.get("code") ?? "")))
  }
  const focusFirst = (el: HTMLElement) => queueMicrotask(() => el.focus())
  return (
    <div class="flex h-dvh items-center justify-center bg-bg px-4" data-component="sign-in">
      <div class="flex w-full max-w-72 flex-col items-center gap-3">
        <IdentityAvatar seed="yuki" size={72} />
        <h1 class="mb-4 mt-1 text-xl font-medium text-text">Sign in to Kiko</h1>
        <form class="flex w-full flex-col gap-3" data-component="access-code-form" onSubmit={submitCode}>
          <input
            name="code"
            type="password"
            class={field}
            aria-label="Access code"
            placeholder="Access code"
            autocomplete="off"
            required
            disabled={busy()}
            ref={focusFirst}
          />
          <button type="submit" class={button} disabled={busy()}>
            Sign in
          </button>
        </form>
        <Show when={import.meta.env.DEV}>
          <button type="button" class={button} disabled={busy()} onClick={() => void run(() => signInAsDev())}>
            Continue as dev
          </button>
        </Show>
        <Show when={error()}>
          <p class="text-sm text-[var(--danger)]" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </div>
  )
}
