import { Show, createSignal } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { signInAsDev, signInWithAccessCode } from "./session"

const button =
  "flex h-11 w-full items-center justify-center rounded-lg bg-control px-4 text-sm font-medium text-foreground outline-none hover:bg-control-strong disabled:cursor-wait disabled:opacity-60"

const field = "h-11 w-full rounded-lg bg-control px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"

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
    <div class="flex h-dvh items-center justify-center bg-background px-4" data-component="sign-in">
      <div class="flex w-full max-w-72 flex-col items-center gap-3">
        <IdentityAvatar seed="kiko" size={72} />
        <h1 class="mb-4 mt-1 text-xl font-medium text-foreground">Sign in to Kiko</h1>
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
          <p class="text-sm text-[var(--error)]" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </div>
  )
}
