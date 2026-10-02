import { For, Show, createResource } from "solid-js"
import { loadProviders, signInAsDev, signInWithProvider } from "./session"

/*
 * The sign-in screen. It loads as its own chunk, so a signed-in person never
 * downloads it. A provider button shows only when the server says that provider
 * is on. The dev button shows only on a development Worker.
 */
const button =
  "flex h-10 w-full items-center justify-center rounded-lg bg-btn px-4 text-sm font-medium text-text hover:bg-btn-hover"

export default function SignIn() {
  const [providers] = createResource(loadProviders)
  const social = () => {
    const p = providers()
    return (["google", "github"] as const).filter((id) => p?.[id])
  }
  return (
    <div class="flex h-dvh items-center justify-center bg-bg" data-component="sign-in">
      <div class="flex w-72 flex-col items-center gap-3">
        <h1 class="mb-4 text-xl font-medium text-text">sign in to kiko</h1>
        <For each={social()}>
          {(id) => (
            <button type="button" class={button} onClick={() => void signInWithProvider(id)}>
              continue with {id}
            </button>
          )}
        </For>
        <Show when={providers()?.dev}>
          <button type="button" class={button} onClick={() => void signInAsDev()}>
            continue as dev
          </button>
        </Show>
        <Show when={providers() && !social().length && !providers()?.dev}>
          <p class="text-sm text-weak">no sign-in method is set up on this server</p>
        </Show>
      </div>
    </div>
  )
}
