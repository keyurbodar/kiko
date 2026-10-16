import { Show, createSignal } from "solid-js"
import { IdentityAvatar } from "../../lib/IdentityAvatar"
import { signInAsDev, signInWithAccessCode } from "../session"
import { codeFailed, enteringWithCode } from "./progress"

export const primary =
  "flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
const secondary =
  "flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-control px-4 text-sm font-medium text-foreground hover:bg-control-strong disabled:cursor-wait disabled:opacity-60"
const field = "h-11 w-full rounded-lg bg-control px-4 text-sm text-foreground placeholder:text-muted-foreground"

/** The access code, as the first step. A wrong code keeps the person here with the server's message. */
export function Welcome() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const run = async (start: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setError("")
    enteringWithCode()
    try {
      await start()
    } catch (e) {
      codeFailed()
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
    <div class="first-run-step flex flex-col items-center gap-3" data-step="welcome">
      <div style={{ "--i": 0 }}>
        <IdentityAvatar seed="kiko" size={72} />
      </div>
      <h1 class="mt-1 text-xl font-medium text-foreground" style={{ "--i": 1 }}>
        Welcome to Kiko
      </h1>
      <p class="mb-3 text-center text-sm text-muted-foreground" style={{ "--i": 2 }}>
        Text one agent or a team of them. Enter your access code to begin.
      </p>
      <form class="flex w-full flex-col gap-3" data-component="access-code-form" onSubmit={submit} style={{ "--i": 3 }}>
        <input
          name="code"
          type="password"
          class={field}
          aria-label="Access code"
          placeholder="Access code"
          autocomplete="off"
          required
          disabled={busy()}
          ref={(el) => queueMicrotask(() => el.focus())}
        />
        <button type="submit" class={primary} disabled={busy()}>
          {busy() ? "Signing in" : "Continue"}
        </button>
      </form>
      <Show when={import.meta.env.DEV}>
        <button type="button" class={secondary} disabled={busy()} onClick={() => void run(() => signInAsDev())}>
          Continue as dev
        </button>
      </Show>
      <Show when={error()}>
        <p class="text-sm text-[var(--error)]" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
