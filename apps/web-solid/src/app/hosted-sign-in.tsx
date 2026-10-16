import { useLocation, useNavigate } from "@solidjs/router"
import { Show, createSignal, lazy, onMount } from "solid-js"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { signInWithClerk } from "./session"

const Connect = lazy(() => import("./connect"))
const connecting = (path: string) => path === "/connect" || path === "/connect/callback"

const primary =
  "flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:cursor-wait disabled:opacity-60"

/*
 * The signed-out screen of a hosted build: kiko's welcome behind, Clerk's prebuilt sign-in modal over it
 * (t3code's way). Closing the modal leaves the "Sign in" button to open it again. It also serves
 * `/connect` with its callback, where a person with no backend yet installs one.
 */
export default function HostedSignIn() {
  const location = useLocation()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(true)
  const [error, setError] = createSignal("")

  const open = async () => {
    setError("")
    try {
      await import("./clerk").then((m) => m.openSignIn())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open sign in. Try again")
    }
  }

  const enter = async (before?: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await before?.()
      const next = await signInWithClerk()
      if (next === "connect") navigate("/connect", { replace: true })
      else if (next === "none") {
        setBusy(false)
        return void open()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in. Try again")
    }
    setBusy(false)
  }

  onMount(() => {
    if (connecting(location.pathname)) return
    if (import.meta.env.DEV) {
      const ticket = new URLSearchParams(location.search).get("ticket")
      if (ticket) return void enter(() => import("./dev-ticket").then((m) => m.signInWithTicket(ticket)))
    }
    void import("./clerk").then((m) => m.onClerkSession(() => void enter())).catch(() => {})
    void enter()
  })

  return (
    <Show
      when={!connecting(location.pathname)}
      fallback={
        <div class="h-dvh overflow-y-auto bg-background" data-component="sign-in">
          <Connect />
        </div>
      }
    >
      <div class="flex h-dvh items-center justify-center bg-background px-4" data-component="sign-in">
        <div class="flex w-full max-w-72 flex-col items-center gap-3">
          <IdentityAvatar seed="kiko" size={72} />
          <h1 class="mt-1 text-xl font-medium text-foreground">Welcome to Kiko</h1>
          <p class="mb-3 text-center text-sm text-muted-foreground">Text one agent or a team of them.</p>
          <button type="button" class={primary} disabled={busy()} data-action="sign-in" onClick={() => void open()}>
            {busy() ? "Signing in" : "Sign in"}
          </button>
          <Show when={error()}>
            <p class="text-sm text-[var(--error)]" role="alert">
              {error()}
            </p>
          </Show>
        </div>
      </div>
    </Show>
  )
}
