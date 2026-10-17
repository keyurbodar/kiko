import { useLocation, useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, createSignal, onMount } from "solid-js"
import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronRightIcon, KeyIcon } from "@kiko/ui/icons"
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
import { signInToInstalledBackend } from "./session"
import { CloudMark, Option, Wizard, WizardTitle } from "./wizard"

type View = { name: "start" } | { name: "installing" } | { name: "failed"; failure: Failure; retry: () => void }

const link = "text-sm text-foreground underline underline-offset-2"

/*
 * Connect Cloudflare. It serves `/connect` and `/connect/callback`, for a signed-out person with no backend
 * yet and for a signed-in one who reconnects (`?reconnect=1`). The install is one request of 20 to 60 s, so the
 * progress is indeterminate: the steps are listed, never timed.
 */
export default function Connect() {
  const location = useLocation()
  const navigate = useNavigate()
  const reconnect = () => new URLSearchParams(location.search).get("reconnect") === "1"
  const [view, setView] = createSignal<View>({ name: "start" })
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
      const error = await connect(clerkToken, grant, signInToInstalledBackend)
      if (!error) return navigate("/", { replace: true })
      setView({ name: "failed", failure: failureOf(error), retry: grant.kind === "token" ? () => void run(grant) : startAgain })
    } catch (e) {
      setView({ name: "failed", failure: { message: e instanceof Error ? e.message : "Could not finish connecting." }, retry: startAgain })
    }
  }

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

  const proceed = () => {
    if (tokenOpen() && token().trim()) void run({ kind: "token", token: token().trim() })
    else void withCloudflare()
  }

  return (
    <Wizard stage={view().name === "installing" ? 2 : 1}>
      <Switch>
        <Match when={view().name === "installing"}>
          <WizardTitle title="Installing Kiko">This takes up to a minute. Keep this tab open.</WizardTitle>
          <ul class="mt-5 flex flex-col gap-2" role="status" data-field="install-progress">
            <For each={STEPS}>{(step) => <li class="flex min-h-12 items-center rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">{step}</li>}</For>
          </ul>
        </Match>
        <Match when={view()} keyed>
          {(v) => (
            <>
              <WizardTitle title="Connect Cloudflare">
                Kiko installs its backend into your own Cloudflare account, on the free plan. Your chats and keys live there. Nothing runs on our servers after setup.
              </WizardTitle>
              <Show when={v.name === "failed" && v}>
                {(f) => (
                  <div class="mt-5 flex flex-col gap-3 rounded-lg border border-[color-mix(in_oklab,var(--error)_30%,transparent)] bg-[color-mix(in_oklab,var(--error)_6%,transparent)] px-3 py-3" role="alert" data-field="install-error">
                    <p class="text-sm text-[var(--error)]">{f().failure.message}</p>
                    <div class="flex items-center gap-3">
                      <Show when={f().failure.link}>
                        {(l) => (
                          <a class={link} href={l().href} target="_blank" rel="noreferrer">
                            {l().label}
                          </a>
                        )}
                      </Show>
                      <Button variant="primary" class="ml-auto" data-action="try-again" onClick={() => f().retry()}>
                        Try again
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
              <Show when={v.name === "start"}>
                <div class="mt-5 flex flex-col gap-2">
                  <Option icon={<CloudMark />} label="Cloudflare" hint="Sign in" disabled={redirecting()} data-action="connect-cloudflare" onClick={() => void withCloudflare()} />
                  <div class="rounded-lg border border-border bg-background">
                    <button
                      type="button"
                      class="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={tokenOpen()}
                      data-action="use-token"
                      onClick={() => (tokenOpen() ? setTokenOpen(false) : void openToken())}
                    >
                      <HugeIcon icon={KeyIcon} size={16} class="shrink-0 text-muted-foreground" />
                      <span class="flex-1">Use an API token</span>
                      <HugeIcon icon={ChevronRightIcon} size={16} class={tokenOpen() ? "shrink-0 rotate-90 text-muted-foreground" : "shrink-0 text-muted-foreground"} />
                    </button>
                    <Show when={tokenOpen()}>
                      <form
                        class="flex flex-col gap-3 px-3 pb-3"
                        data-field="token-form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          proceed()
                        }}
                      >
                        <Show when={tokenLink()} fallback={<Show when={!note()}><p class="text-sm text-muted-foreground">Loading the token steps</p></Show>}>
                          {(t) => (
                            <>
                              <p class="text-sm text-muted-foreground">
                                <a class={link} href={t().url} target="_blank" rel="noreferrer" data-action="create-token">
                                  Create a token
                                </a>{" "}
                                with these permissions, then paste it here.
                              </p>
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
                      </form>
                    </Show>
                  </div>
                </div>
                <Show when={note()}>
                  <p class="mt-4 text-sm text-[var(--error)]" role="alert">
                    {note()}
                  </p>
                </Show>
                <div class="mt-6 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <p class="min-w-0 text-xs leading-relaxed text-muted-foreground">
                    Cloudflare sign-in works for invited accounts while Kiko is in preview. Use an API token otherwise.
                  </p>
                  <Button
                    variant="primary"
                    class="shrink-0 self-end"
                    disabled={redirecting() || (tokenOpen() && !token().trim())}
                    data-action={tokenOpen() ? "install" : "continue"}
                    onClick={proceed}
                  >
                    {tokenOpen() ? "Install" : "Continue"}
                    <HugeIcon icon={ChevronRightIcon} size={14} />
                  </Button>
                </div>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </Wizard>
  )
}
