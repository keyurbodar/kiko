import { Show, createSignal } from "solid-js"
import { signInAsDev, signInWithAccessCode } from "../session"
import { codeFailed, enteringFresh, setWorking } from "./progress"

export const primary =
  "flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
export const secondary =
  "flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-control px-4 text-sm font-medium text-foreground hover:bg-control-strong disabled:cursor-wait disabled:opacity-60"
const field = "h-11 w-full rounded-lg bg-control px-4 text-sm text-foreground placeholder:text-muted-foreground"

export function Cover() {
  return (
    <>
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        Welcome to Kiko
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        Text one agent or a team of them. It reads what you send and answers like a person.
      </p>
    </>
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
      <Cover />
      <form class="mt-2 flex w-full flex-col gap-2" data-component="access-code-form" onSubmit={submit} style={{ "--i": 2 }}>
        <p class="text-center text-sm text-muted-foreground">Enter the access code you set when you deployed Kiko.</p>
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
        <button type="button" class={secondary} disabled={busy()} onClick={() => void run(() => signInAsDev())} style={{ "--i": 3 }}>
          Continue as dev
        </button>
      </Show>
      <Show when={error()}>
        <p class="text-center text-sm text-[var(--error)]" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}
