import { useLocation, useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "../settings/kit"
import {
  STEPS,
  type Failure,
  type Grant,
  type InstallError,
  authorizeUrl,
  connect,
  failureOf,
  finish,
  retryKind,
  tokenProblem,
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
import { enteringFresh, setWorking } from "./first-run/progress"
import { signInToInstalledBackend } from "./session"
import { SECRET_FIELD } from "../lib/secret-field"

type View =
  | { name: "start" }
  | { name: "installing" }
  | { name: "failed"; failure: Failure; retry: () => void }
  | { name: "choose"; accounts: { id: string; name: string }[]; pick: (id: string) => void }

type TokenSteps =
  | { status: "idle" | "loading" }
  | { status: "ready"; link: TokenLink }
  | { status: "failed"; message: string }

const link = "text-sm text-foreground underline underline-offset-2"

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

function InstallProgress() {
  const [stage, setStage] = createSignal(0)
  const [on, setOn] = createSignal(false)
  const timer = setInterval(() => setStage((s) => Math.min(s + 1, STEPS.length - 1)), STAGE_MS)
  requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)))
  onCleanup(() => clearInterval(timer))
  return (
    <div class="flex flex-col gap-2.5" role="status" data-field="install-progress">
      <span class="welcome-meter block h-1 overflow-hidden rounded-full bg-control">
        <i class="block h-full rounded-full bg-[var(--ring)]" attr:data-on={on() ? "" : undefined} />
      </span>
      <p class="text-center text-sm text-foreground">{STEPS[stage()]}</p>
    </div>
  )
}

export function ConnectCloudflare() {
  const location = useLocation()
  const navigate = useNavigate()
  const reconnect = () => new URLSearchParams(location.search).get("reconnect") === "1"
  const [view, setView] = createSignal<View>({
    name: location.pathname === "/connect/callback" ? "installing" : "start",
  })
  const [tokenOpen, setTokenOpen] = createSignal(false)
  const [tokenSteps, setTokenSteps] = createSignal<TokenSteps>({ status: "idle" })
  const tokenLink = () => {
    const steps = tokenSteps()
    return steps.status === "ready" ? steps.link : null
  }
  const tokenFailure = () => {
    const steps = tokenSteps()
    return steps.status === "failed" ? steps.message : ""
  }
  const [token, setToken] = createSignal("")
  const [note, setNote] = createSignal("")
  const [redirecting, setRedirecting] = createSignal(false)

  const startAgain = () => {
    setView({ name: "start" })
    navigate(reconnect() ? "/connect?reconnect=1" : "/connect", { replace: true })
  }

  const signIn = () => {
    if (!reconnect()) enteringFresh()
    return signInToInstalledBackend()
  }

  const pasteAgain = (message: string) => {
    setView({ name: "start" })
    setToken("")
    setNote(message)
    void openToken()
  }

  const show = (error: InstallError | null, again: () => void, grant: Grant["kind"] = "oauth") => {
    if (!error) return navigate("/", { replace: true })
    const failure = failureOf(error)
    const retry = {
      "sign-in": () => void finishOnly(),
      "new-grant": () => void withCloudflare(),
      token: () => pasteAgain(failure.message),
      same: again,
    }[retryKind(error, grant)]
    setView({ name: "failed", failure, retry })
  }

  const finishOnly = async () => {
    setView({ name: "installing" })
    show(await finish(signIn), () => void finishOnly())
  }

  const run = async (grant: Grant, accountId?: string, reset?: "delete-existing-data"): Promise<void> => {
    setView({ name: "installing" })
    const again = () => void run(grant, accountId, reset)
    try {
      const clerkToken = await import("./clerk").then((m) => m.clerkSignIn()).then((c) => c?.token)
      if (!clerkToken) throw new Error("Your Kiko sign-in ended. Reload the page and sign in again.")
      const error = await connect(clerkToken, grant, signIn, fetch, accountId, reset)
      if (error?.code === "choose_account" && error.accounts?.length) {
        setView({ name: "choose", accounts: error.accounts, pick: (id) => void run(grant, id) })
        return
      }
      if (error?.code === "reset_required") {
        if (window.confirm(error.message)) return run(grant, accountId, "delete-existing-data")
        setView({ name: "failed", failure: { message: error.message }, retry: () => void run(grant, accountId) })
        return
      }
      show(error, again, grant.kind)
    } catch (e) {
      setView({
        name: "failed",
        failure: { message: e instanceof Error ? e.message : "Could not finish connecting. Try again." },
        retry: again,
      })
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
    if (tokenSteps().status === "ready" || tokenSteps().status === "loading") return
    setTokenSteps({ status: "loading" })
    try {
      setTokenSteps({ status: "ready", link: await loadTokenLink() })
    } catch (e) {
      setTokenSteps({
        status: "failed",
        message: e instanceof Error ? e.message : "Could not load the token steps. Try again.",
      })
    }
  }

  return (
    <div class="welcome-step flex w-full flex-col gap-3" data-component="connect" data-step="cloudflare">
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        {view().name === "installing"
          ? "Installing Kiko"
          : reconnect()
            ? "Reconnect Cloudflare"
            : "Put Kiko on your Cloudflare"}
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
        {view().name === "installing"
          ? "This takes up to a minute."
          : reconnect()
            ? "Your Cloudflare connection has ended. Connect it again so Kiko keeps running in your account."
            : "Kiko runs in your own Cloudflare account. Your chats and keys stay there."}
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
                    <Show when={f().failure.detail}>
                      {(d) => (
                        <p class="text-xs break-words text-muted-foreground" data-field="install-error-detail">
                          Cloudflare said: {d()}
                        </p>
                      )}
                    </Show>
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
              <Show when={v.name === "choose" && v}>
                {(c) => (
                  <div class="flex flex-col gap-2" data-field="choose-account">
                    <p class="text-sm text-foreground">
                      This sign-in can use more than one Cloudflare account. Pick the one Kiko goes in.
                    </p>
                    <For each={c().accounts}>
                      {(a) => (
                        <Button
                          class="h-11 w-full justify-start"
                          data-action="pick-account"
                          onClick={() => c().pick(a.id)}
                        >
                          {a.name}
                        </Button>
                      )}
                    </For>
                  </div>
                )}
              </Show>
              <Show when={v.name === "start"}>
                <Button
                  variant="primary"
                  class="h-11 w-full"
                  disabled={redirecting()}
                  data-action="connect-cloudflare"
                  onClick={() => void withCloudflare()}
                >
                  {redirecting() ? "Opening Cloudflare" : "Connect Cloudflare"}
                </Button>
                <Show when={note()}>
                  <p class="text-sm text-[var(--error)]" role="alert">
                    {note()}
                  </p>
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
                      const value = token().trim()
                      const problem = tokenProblem(value)
                      if (problem) setNote(problem)
                      else if (value) void run({ kind: "token", token: value })
                    }}
                  >
                    <Show
                      when={tokenLink()}
                      fallback={
                        <Show
                          when={tokenFailure()}
                          fallback={
                            <p class="text-sm text-muted-foreground" role="status">
                              Loading the token steps
                            </p>
                          }
                        >
                          {(message) => (
                            <div class="flex flex-col gap-2">
                              <p class="text-sm text-[var(--error)]" role="alert">
                                {message()}
                              </p>
                              <Button type="button" data-action="retry-token-steps" onClick={() => void openToken()}>
                                Try again
                              </Button>
                            </div>
                          )}
                        </Show>
                      }
                    >
                      {(t) => (
                        <>
                          <a class={link} href={t().url} target="_blank" rel="noreferrer" data-action="create-token">
                            Create a token with these permissions
                          </a>
                          <p class="text-sm text-muted-foreground">
                            The link ticks them for you. Check that they match, then create the token and paste it here.
                          </p>
                          <ul
                            class="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground"
                            data-field="token-permissions"
                          >
                            <For each={t().permissions}>{(p) => <li>{p}</li>}</For>
                          </ul>
                        </>
                      )}
                    </Show>
                    <input
                      {...SECRET_FIELD}
                      class="kit-field"
                      placeholder="Paste your API token"
                      aria-label="API token"
                      value={token()}
                      onInput={(e) => {
                        setToken(e.currentTarget.value)
                        setNote("")
                      }}
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
