import { useLocation, useNavigate } from "@solidjs/router"
import { For, Show, createSignal, lazy, onMount, type JSX } from "solid-js"
import type { Provider } from "./hosted"
import { signInWithClerk } from "./session"
import { GitHubMark, GoogleMark, Option, Wizard, WizardTitle } from "./wizard"

const Connect = lazy(() => import("./connect"))
const connecting = (path: string) => path === "/connect" || path === "/connect/callback"

const PROVIDERS: { id: Provider; label: string; icon: () => JSX.Element }[] = [
  { id: "google", label: "Continue with Google", icon: GoogleMark },
  { id: "github", label: "Continue with GitHub", icon: GitHubMark },
]

/*
 * The signed-out screen of a hosted build. It also serves `/sso-callback`, where Clerk sends the person back
 * from Google or GitHub, and `/connect` with its callback, where a person with no backend yet installs one.
 */
export default function HostedSignIn() {
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(location.pathname === "/sso-callback")
  const [error, setError] = createSignal("")

  const enter = async (before?: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await before?.()
      const next = await signInWithClerk()
      if (next === "connect") {
        navigate("/connect", { replace: true })
      } else if (next === "in") {
        if (location.pathname === "/sso-callback") navigate("/", { replace: true })
      } else if (location.pathname === "/sso-callback") navigate("/", { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Try again")
      if (location.pathname === "/sso-callback") navigate("/", { replace: true })
    }
    setBusy(false)
  }

  onMount(() => {
    if (connecting(location.pathname)) return
    if (import.meta.env.DEV) {
      const ticket = new URLSearchParams(location.search).get("ticket")
      if (ticket) return void enter(() => import("./dev-ticket").then((m) => m.signInWithTicket(ticket)))
    }
    if (location.pathname === "/sso-callback") return void enter(() => import("./clerk").then((m) => m.finishOAuth()))
    void enter()
  })

  const start = async (provider: Provider) => {
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      await import("./clerk").then((m) => m.startOAuth(provider))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Try again")
      setBusy(false)
    }
  }

  return (
    <Show when={!connecting(location.pathname)} fallback={<Connect />}>
      <Wizard stage={0}>
        <WizardTitle title="Sign in to Kiko">Kiko runs in your own Cloudflare account. Sign in, then connect it.</WizardTitle>
        <div class="mt-5 flex flex-col gap-2">
          <For each={PROVIDERS}>
            {(p) => <Option icon={p.icon()} label={p.label} disabled={busy()} data-action={`sign-in-${p.id}`} onClick={() => void start(p.id)} />}
          </For>
        </div>
        <Show when={error()}>
          <p class="mt-4 text-sm text-[var(--error)]" role="alert">
            {error()}
          </p>
        </Show>
      </Wizard>
    </Show>
  )
}
