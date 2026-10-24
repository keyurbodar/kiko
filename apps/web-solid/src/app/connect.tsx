import { useLocation, useNavigate } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { write } from "../lib/api-base"
import { SECRET_FIELD } from "../lib/secret-field"
import { Button } from "../settings/kit"
import {
  type Attempt,
  anotherAccount,
  authorizeUrl,
  FIX_LABEL,
  type Failure,
  type Fix,
  headingOf,
  livePorts,
  makePkce,
  oauthGrant,
  pickAccount,
  redirectUri,
  STEPS,
  savePending,
  sendAttempt,
  sentenceOf,
  signInFailed,
  startFresh,
  takeOver,
  takePending,
  tokenProblem,
  type View,
  viewOfAnswer,
  viewOfTrouble,
} from "./connect-flow"
import "./first-run/first-run.css"
import { enteringFresh, setWorking } from "./first-run/progress"
import { type Account, installerClient, type TokenLink } from "./installer-client"
import { signInToInstalledBackend, signOut } from "./session"

type TokenSteps =
  | { status: "idle" | "loading" }
  | { status: "ready"; link: TokenLink }
  | { status: "failed"; message: string }

type ViewOf<T extends View["_tag"]> = Extract<View, { _tag: T }>

const isView = <T extends View["_tag"]>(view: View, tag: T): view is ViewOf<T> => view._tag === tag

const link = "text-sm text-foreground underline underline-offset-2"

const FIX_ACTION: Record<Fix["_tag"], string> = {
  Resend: "try-again",
  Reconnect: "connect-again",
  SignInAgain: "sign-in-again",
  FinishSignIn: "try-again",
}

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

function FailedPanel(props: { failure: Failure; onFix: (fix: Fix) => void }) {
  return (
    <div class="flex flex-col gap-2" role="alert" data-field="install-error">
      <p class="text-sm text-[var(--error)]">{props.failure.sentence}</p>
      <Show when={props.failure.detail}>
        {(detail) => (
          <p class="text-xs break-words text-muted-foreground" data-field="install-error-detail">
            Cloudflare said: {detail()}
          </p>
        )}
      </Show>
      <div class="flex items-center gap-3">
        <Show when={props.failure.link}>
          {(l) => (
            <a class={link} href={l().href} target="_blank" rel="noreferrer">
              {l().label}
            </a>
          )}
        </Show>
        <Button
          variant="primary"
          data-action={FIX_ACTION[props.failure.fix._tag]}
          onClick={() => props.onFix(props.failure.fix)}
        >
          {FIX_LABEL[props.failure.fix._tag]}
        </Button>
      </div>
    </div>
  )
}

function AccountPicker(props: { accounts: ReadonlyArray<Account>; onPick: (accountId: string) => void }) {
  return (
    <div class="flex flex-col gap-2" data-field="choose-account">
      <p class="text-sm text-foreground">
        This sign-in can use more than one Cloudflare account. Pick the one Kiko goes in.
      </p>
      <For each={props.accounts}>
        {(account) => (
          <Button class="h-11 w-full justify-start" data-action="pick-account" onClick={() => props.onPick(account.id)}>
            {account.name}
          </Button>
        )}
      </For>
    </div>
  )
}

function DecidePanel(props: {
  view: ViewOf<"Decide">
  onTakeOver: () => void
  onStartFresh: () => void
  onAnotherAccount: () => void
}) {
  return (
    <div class="flex flex-col gap-2" data-field="decide">
      <Show when={props.view.note}>
        {(note) => (
          <p class="text-sm text-[var(--error)]" role="alert">
            {note()}
          </p>
        )}
      </Show>
      <Show when={props.view.found.keepable}>
        <Button variant="primary" class="h-11 w-full" data-action="take-over" onClick={() => props.onTakeOver()}>
          Keep chats (take over)
        </Button>
      </Show>
      <Button class="h-11 w-full" data-action="start-fresh" onClick={() => props.onStartFresh()}>
        Start fresh (deletes its chats)
      </Button>
      <Button
        variant="ghost"
        class="h-11 w-full"
        data-action="another-account"
        onClick={() => props.onAnotherAccount()}
      >
        Use another Cloudflare account
      </Button>
    </div>
  )
}

function ConfirmFreshPanel(props: { onConfirm: () => void; onBack: () => void }) {
  return (
    <div class="flex flex-col gap-2" data-field="confirm-start-fresh">
      <Button variant="danger" class="h-11 w-full" data-action="confirm-start-fresh" onClick={() => props.onConfirm()}>
        Delete and start fresh
      </Button>
      <Button class="h-11 w-full" data-action="cancel-start-fresh" onClick={() => props.onBack()}>
        Back
      </Button>
    </div>
  )
}

export function ConnectCloudflare() {
  const location = useLocation()
  const navigate = useNavigate()
  const callback = location().pathname === "/connect/callback"
  const pending = callback ? takePending() : null
  const reconnect = () =>
    pending?.reconnect === true || new URLSearchParams(location().searchStr).get("reconnect") === "1"
  const [view, setView] = createSignal<View>(callback ? { _tag: "Working" } : { _tag: "Start", paste: null })
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
  const viewAs = <T extends View["_tag"]>(tag: T) => {
    const current = view()
    return isView(current, tag) ? current : undefined
  }
  const heading = () => headingOf(view(), reconnect())

  function show(next: View) {
    if (next._tag === "Start" && next.paste) {
      setNote(next.paste.note)
      if (!next.paste.keep) setToken("")
      void openToken()
    }
    setView(next)
  }

  async function finishSignIn() {
    setView({ _tag: "Working" })
    try {
      await signInToInstalledBackend()
      void navigate({ to: "/", replace: true })
    } catch (error) {
      show(signInFailed(error))
    }
  }

  async function send(attempt: Attempt) {
    setView({ _tag: "Working" })
    const result = await Effect.runPromise(Effect.result(sendAttempt(attempt, livePorts)))
    if (Result.isFailure(result)) return show(viewOfTrouble(result.failure, attempt))
    const answer = result.success
    if (answer._tag !== "Installed") return show(viewOfAnswer(answer, attempt))
    write("kiko:backend", answer.backendUrl)
    if (!reconnect()) enteringFresh()
    await finishSignIn()
  }

  async function withCloudflare() {
    show({ _tag: "Start", paste: null })
    setNote("")
    setRedirecting(true)
    const config = await Effect.runPromise(Effect.result(installerClient.oauthConfig))
    if (Result.isFailure(config)) {
      setNote(sentenceOf(config.failure))
      setRedirecting(false)
      return
    }
    const pkce = await makePkce()
    savePending(pkce, reconnect())
    globalThis.location.assign(authorizeUrl(config.success, pkce, redirectUri(globalThis.location.origin)))
  }

  async function openToken() {
    setTokenOpen(true)
    if (tokenSteps().status === "ready" || tokenSteps().status === "loading") return
    setTokenSteps({ status: "loading" })
    const steps = await Effect.runPromise(Effect.result(installerClient.tokenLink))
    setTokenSteps(
      Result.isSuccess(steps)
        ? { status: "ready", link: steps.success }
        : { status: "failed", message: sentenceOf(steps.failure) },
    )
  }

  function fix(next: Fix) {
    if (next._tag === "Resend") return void send(next.attempt)
    if (next._tag === "Reconnect") return void withCloudflare()
    if (next._tag === "SignInAgain") return void signOut()
    return void finishSignIn()
  }

  function chooseAnotherAccount(decide: ViewOf<"Decide">) {
    const next = anotherAccount(decide)
    if (next) show(next)
    else void withCloudflare()
  }

  createEffect(() => setWorking(view()._tag === "Working" || redirecting()))
  onCleanup(() => setWorking(false))

  onMount(() => {
    if (!callback) return
    const result = oauthGrant(location().searchStr, pending, redirectUri(globalThis.location.origin))
    if ("trouble" in result) show(viewOfTrouble(result.trouble, null))
    else void send({ grant: result.grant })
  })

  return (
    <div
      class="welcome-step flex w-full flex-col gap-3"
      data-component="connect"
      data-step="cloudflare"
      data-view={view()._tag}
    >
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        {heading().title}
      </h1>
      <p class="welcome-lede break-words" style={{ "--i": 1 }}>
        {heading().lede}
      </p>
      <Switch>
        <Match when={view()._tag === "Working"}>
          <InstallProgress />
        </Match>
        <Match when={viewAs("Failed")}>{(failed) => <FailedPanel failure={failed().failure} onFix={fix} />}</Match>
        <Match when={viewAs("ChooseAccount")}>
          {(choose) => (
            <AccountPicker accounts={choose().accounts} onPick={(id) => void send(pickAccount(choose(), id))} />
          )}
        </Match>
        <Match when={viewAs("Decide")}>
          {(decide) => (
            <DecidePanel
              view={decide()}
              onTakeOver={() => void send(takeOver(decide()))}
              onStartFresh={() => setView({ _tag: "ConfirmFresh", attempt: decide().attempt, found: decide().found })}
              onAnotherAccount={() => chooseAnotherAccount(decide())}
            />
          )}
        </Match>
        <Match when={viewAs("ConfirmFresh")}>
          {(confirm) => (
            <ConfirmFreshPanel
              onConfirm={() => void send(startFresh(confirm()))}
              onBack={() => setView({ _tag: "Decide", attempt: confirm().attempt, found: confirm().found, note: null })}
            />
          )}
        </Match>
        <Match when={view()._tag === "Start"}>
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
            <p class="text-sm text-[var(--error)]" role="alert" data-field="connect-note">
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
                else if (value) void send({ grant: { kind: "token", token: value } })
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
        </Match>
      </Switch>
    </div>
  )
}
