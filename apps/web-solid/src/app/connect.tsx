import { useLocation, useNavigate } from "@solidjs/router"
import { For, Index, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "../settings/kit"
import {
  STEPS,
  type Failure,
  type Grant,
  authorizeUrl,
  connect,
  failureOf,
  loadOAuthConfig,
  loadTokenLink,
  makePkce,
  oauthGrant,
  redirectUri,
  savePending,
  takePending,
  type TokenLink,
} from "./connect-flow"
import "./first-run/first-run.css"
import { enteringWithCode, setWorking } from "./first-run/progress"
import { signInToInstalledBackend } from "./session"

type View = { name: "start" } | { name: "installing" } | { name: "failed"; failure: Failure; retry: () => void }

const link = "text-sm text-foreground underline underline-offset-2"

/** The `/connect` page a signed-in person opens to reconnect (`?reconnect=1`). */
export default function ConnectPage() {
  return (
    <div class="flex min-h-full w-full items-center justify-center px-4 py-8">
      <div class="flex w-full max-w-96 flex-col gap-3">
        <ConnectCloudflare />
      </div>
    </div>
  )
}

const STAGE_MS = 7000

/*
 * The install is one request of 20 to 60 s with no stages of its own. The list lights the first stage on the
 * click and walks on at a steady pace, holding on the last one until the answer, while the meter eases toward
 * full and fills when it lands.
 */
function InstallProgress() {
  const [stage, setStage] = createSignal(0)
  const [on, setOn] = createSignal(false)
  const timer = setInterval(() => setStage((s) => Math.min(s + 1, STEPS.length - 1)), STAGE_MS)
  requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
  onCleanup(() => clearInterval(timer))
  return (
    <div class="flex flex-col gap-3 rounded-lg bg-control px-4 py-3" role="status" data-field="install-progress">
      <p class="text-sm font-medium text-foreground">Installing Kiko. This takes up to a minute.</p>
      <span class="welcome-meter block h-1 overflow-hidden rounded-full bg-control">
        <i class="block h-full rounded-full bg-[var(--ring)]" attr:data-on={on() ? "" : undefined} />
      </span>
      <ul class="flex flex-col gap-1.5 text-sm">
        <Index each={STEPS}>
          {(step, i) => (
            <li class="flex items-center gap-2" data-state={i < stage() ? "done" : i === stage() ? "current" : "next"}>
              <span class={`grid size-4 place-items-center ${i === stage() ? "first-run-skeleton" : ""}`} aria-hidden="true">
                <span class={`size-1.5 rounded-full ${i <= stage() ? "bg-foreground" : "bg-[var(--muted-foreground)] opacity-40"}`} />
              </span>
              <span class={i <= stage() ? "text-foreground" : "text-muted-foreground"}>{step()}</span>
            </li>
          )}
        </Index>
      </ul>
    </div>
  )
}

/*
 * Connect Cloudflare. A step of the welcome screen for a signed-out person with no backend yet (`/connect`
 * and `/connect/callback`), and the body of the reconnect page.
 */
export function ConnectCloudflare() {
  const location = useLocation()
  const navigate = useNavigate()
  const reconnect = () => new URLSearchParams(location.search).get("reconnect") === "1"
  const [view, setView] = createSignal<View>({ name: location.pathname === "/connect/callback" ? "installing" : "start" })
  const [tokenOpen, setTokenOpen] = createSignal(false)
  const [tokenLink, setTokenLink] = createSignal<TokenLink | null>(null)
  const [token, setToken] = createSignal("")
  const [note, setNote] = createSignal("")
  const [redirecting, setRedirecting] = createSignal(false)

  const startAgain = () => {
    setView({ name: "start" })
    navigate(reconnect() ? "/connect?reconnect=1" : "/connect", { replace: true })
  }

  const run = async (grant: Grant) => {
    setView({ name: "installing" })
    try {
      const clerkToken = await import("./clerk").then((m) => m.clerkSignIn()).then((c) => c?.token)
      if (!clerkToken) throw new Error("Sign in again to continue")
      const error = await connect(clerkToken, grant, () => {
        if (!reconnect()) enteringWithCode()
        return signInToInstalledBackend()
      })
      if (!error) return navigate("/", { replace: true })
      setView({ name: "failed", failure: failureOf(error), retry: grant.kind === "token" ? () => void run(grant) : startAgain })
    } catch (e) {
      setView({ name: "failed", failure: { message: e instanceof Error ? e.message : "Could not finish connecting." }, retry: startAgain })
    }
  }

  createEffect(() => setWorking(view().name === "installing" || redirecting()))
  onCleanup(() => setWorking(false))

  onMount(() => {
    if (location.pathname !== "/connect/callback") return
    const result = oauthGrant(location.search, takePending(), redirectUri(globalThis.location.origin))
    if ("error" in result) setView({ name: "failed", failure: failureOf(result.error), retry: startAgain })
    else void run(result.grant)
  })

  const withCloudflare = async () => {
    setNote("")
    setRedirecting(true)
    try {
      const config = await loadOAuthConfig()
      const pkce = await makePkce()
      savePending(pkce, reconnect())
      globalThis.location.assign(authorizeUrl(config, pkce, redirectUri(globalThis.location.origin)))
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not start. Try again.")
      setRedirecting(false)
    }
  }

  const openToken = async () => {
    setTokenOpen(true)
    if (tokenLink()) return
    try {
      setTokenLink(await loadTokenLink())
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not load the token steps. Try again.")
    }
  }

  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-component="connect" data-step="cloudflare">
      <h1 class="text-xl font-medium text-foreground" style={{ "--i": 0 }}>Connect Cloudflare</h1>
      <p class="text-sm text-muted-foreground" style={{ "--i": 1 }}>
        Kiko installs its backend into your own Cloudflare account, on the free plan. Your chats and keys live there. Nothing runs on our servers after setup.
      </p>
      <Switch>
        <Match when={view().name === "installing"}>
          <InstallProgress />
        </Match>
        <Match when={view()} keyed>
          {(v) => (
            <>
              <Show when={v.name === "failed" && v}>
                {(f) => (
                  <div class="flex flex-col gap-2" role="alert" data-field="install-error">
                    <p class="text-sm text-[var(--error)]">{f().failure.message}</p>
                    <div class="flex items-center gap-3">
                      <Show when={f().failure.link}>
                        {(l) => (
                          <a class={link} href={l().href} target="_blank" rel="noreferrer">
                            {l().label}
                          </a>
                        )}
                      </Show>
                      <Button variant="primary" data-action="try-again" onClick={() => f().retry()}>
                        Try again
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
              <Show when={v.name === "start"}>
                <Button variant="primary" class="h-11 w-full" disabled={redirecting()} data-action="connect-cloudflare" onClick={() => void withCloudflare()}>
                  {redirecting() ? "Opening Cloudflare" : "Connect with Cloudflare"}
                </Button>
                <p class="text-xs text-muted-foreground">
                  Cloudflare sign-in works for invited accounts while Kiko is in preview. Use an API token otherwise.
                </p>
                <Show when={note()}>
                  <p class="text-sm text-[var(--error)]" role="alert">{note()}</p>
                </Show>
                <Show
                  when={tokenOpen()}
                  fallback={
                    <Button class="h-11 w-full" data-action="use-token" onClick={() => void openToken()}>
                      Use an API token instead
                    </Button>
                  }
                >
                  <form
                    class="flex flex-col gap-3 rounded-lg bg-control px-4 py-3"
                    data-field="token-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (token().trim()) void run({ kind: "token", token: token().trim() })
                    }}
                  >
                    <Show when={tokenLink()} fallback={<p class="text-sm text-muted-foreground">Loading the token steps</p>}>
                      {(t) => (
                        <>
                          <a class={link} href={t().url} target="_blank" rel="noreferrer" data-action="create-token">
                            Create a token
                          </a>
                          <p class="text-sm text-muted-foreground">Give it these permissions:</p>
                          <ul class="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground" data-field="token-permissions">
                            <For each={t().permissions}>{(p) => <li>{p}</li>}</For>
                          </ul>
                        </>
                      )}
                    </Show>
                    <input
                      type="password"
                      class="kit-field"
                      autocomplete="off"
                      placeholder="Paste your API token"
                      aria-label="API token"
                      value={token()}
                      onInput={(e) => setToken(e.currentTarget.value)}
                      data-field="token"
                    />
                    <Button variant="primary" type="submit" disabled={!token().trim()} data-action="install">
                      Install
                    </Button>
                  </form>
                </Show>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
