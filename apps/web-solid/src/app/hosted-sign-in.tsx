import { useLocation, useNavigate } from "@solidjs/router"
import { Match, Show, Switch, createSignal, onMount } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import type { Provider } from "./hosted"
import { signInWithClerk } from "./session"

const button =
  "flex h-11 w-full items-center justify-center rounded-lg bg-control px-4 text-sm font-medium text-foreground outline-none hover:bg-control-strong disabled:cursor-wait disabled:opacity-60"

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "google", label: "Continue with Google" },
  { id: "github", label: "Continue with GitHub" },
]

/*
 * The signed-out screen of a hosted build. It also serves `/sso-callback`, where Clerk sends the person back
 * from Google or GitHub, and `/connect`, where a person with no backend yet lands (unit H10 builds that screen).
 */
export default function HostedSignIn() {
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(location.pathname === "/sso-callback")
  const [error, setError] = createSignal("")
  const [connect, setConnect] = createSignal(location.pathname === "/connect")

  const enter = async (before?: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await before?.()
      const next = await signInWithClerk()
      if (next === "connect") {
        navigate("/connect", { replace: true })
        setConnect(true)
      } else if (next === "in") {
        if (location.pathname === "/sso-callback" || location.pathname === "/connect") navigate("/", { replace: true })
      } else if (location.pathname === "/sso-callback") navigate("/", { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Try again")
      if (location.pathname === "/sso-callback") navigate("/", { replace: true })
    }
    setBusy(false)
  }

  onMount(() => {
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
    <div class="flex h-dvh items-center justify-center bg-background px-4" data-component="sign-in">
      <div class="flex w-full max-w-72 flex-col items-center gap-3">
        <Show when={!connect()}>
          <IdentityAvatar seed="kiko" size={72} />
        </Show>
        <Switch>
          <Match when={connect()}>
            <h1 class="mt-1 text-xl font-medium text-foreground" data-component="connect">Connect Cloudflare</h1>
            <p class="text-center text-sm text-muted-foreground">Kiko runs on your own Cloudflare account. Connect it to get your backend.</p>
          </Match>
          <Match when={true}>
            <h1 class="mt-1 text-xl font-medium text-foreground">Sign in to Kiko</h1>
            <p class="mb-3 text-center text-sm text-muted-foreground">Use the account you signed up with.</p>
            {PROVIDERS.map((p) => (
              <button type="button" class={button} disabled={busy()} data-action={`sign-in-${p.id}`} onClick={() => void start(p.id)}>
                {p.label}
              </button>
            ))}
          </Match>
        </Switch>
        <Show when={error()}>
          <p class="text-sm text-[var(--error)]" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </div>
  )
}
