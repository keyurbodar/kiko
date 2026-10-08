import { For, Show, createResource, createSignal } from "solid-js"
import { Bird } from "../mascot/bird"
import { loadProviders, signInAsDev, signInWithProvider } from "./session"

/*
 * The sign-in screen. It loads as its own chunk, so a signed-in person never
 * downloads it. A provider button shows only when the server says that provider
 * is on. The dev button shows only on a development Worker. One click starts the
 * sign-in and every button holds until it ends, so a double tap cannot start two.
 */
/** Each provider by its own name. */
const PROVIDER = { google: "Google", github: "GitHub" } as const

const button =
  "flex h-11 w-full items-center justify-center rounded-lg bg-btn px-4 text-sm font-medium text-text outline-none hover:bg-btn-hover focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-wait disabled:opacity-60"

export default function SignIn() {
  const [providers] = createResource(loadProviders)
  const [busy, setBusy] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const social = () => {
    const p = providers()
    return (["google", "github"] as const).filter((id) => p?.[id])
  }
  const run = async (start: () => Promise<void>) => {
    if (busy()) return
    setBusy(true)
    setFailed(false)
    try {
      await start()
    } catch {
      setFailed(true)
    }
    // A redirect leaves the page, so a button only comes back when the sign-in did not go anywhere.
    setBusy(false)
  }
  const focusFirst = (el: HTMLElement) => queueMicrotask(() => el.focus())
  return (
    <div class="flex h-dvh items-center justify-center bg-bg px-4" data-component="sign-in">
      <div class="flex w-full max-w-72 flex-col items-center gap-3">
        <Bird slug="kiko" size={72} state="wave" />
        <h1 class="mb-4 mt-1 text-xl font-medium text-text">Sign in to Kiko</h1>
        <For each={social()}>
          {(id, i) => (
            <button
              type="button"
              class={button}
              disabled={busy()}
              ref={(el) => i() === 0 && focusFirst(el)}
              onClick={() => void run(() => signInWithProvider(id))}
            >
              Continue with {PROVIDER[id]}
            </button>
          )}
        </For>
        <Show when={providers()?.dev}>
          <button
            type="button"
            class={button}
            disabled={busy()}
            ref={(el) => !social().length && focusFirst(el)}
            onClick={() => void run(() => signInAsDev())}
          >
            Continue as dev
          </button>
        </Show>
        <Show when={failed()}>
          <p class="text-sm text-[var(--danger)]" role="alert">
            Could not sign in. Try again
          </p>
        </Show>
        <Show when={providers() && !social().length && !providers()?.dev}>
          <p class="text-sm text-weak">No sign-in method is set up on this server</p>
        </Show>
      </div>
    </div>
  )
}
