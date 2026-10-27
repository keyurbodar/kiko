import { useLocation, useNavigate } from "@tanstack/solid-router"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount, splitProps } from "solid-js"
import { write } from "../lib/api-base"
import { SECRET_FIELD } from "../lib/secret-field"
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
import { Dots } from "./first-run/dots"
import { enteringFresh, setWorking } from "./first-run/progress"
import { type Account, installerClient, type TokenLink } from "./installer-client"
import { signInToInstalledBackend, signOut } from "./session"
import { CheckIcon, ClockIcon, ShieldIcon, WalletIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import type { JSX } from "solid-js"

type TokenSteps =
  | { status: "idle" | "loading" }
  | { status: "ready"; link: TokenLink }
  | { status: "failed"; message: string }

type ViewOf<T extends View["_tag"]> = Extract<View, { _tag: T }>

const isView = <T extends View["_tag"]>(view: View, tag: T): view is ViewOf<T> => view._tag === tag

const link = "ob-link"

type BtnVariant = "primary" | "secondary" | "ghost" | "danger"

const BTN_CLASS: Record<BtnVariant, string> = {
  primary: "ob-primary",
  secondary: "ob-secondary",
  ghost: "ob-ghost",
  danger: "ob-danger",
}

function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const [local, rest] = splitProps(props, ["variant", "class"])
  return <button type="button" {...rest} class={`${BTN_CLASS[local.variant ?? "secondary"]} ${local.class ?? ""}`} />
}

const FACTS = [
  {
    icon: ShieldIcon,
    title: "Your data stays in your account",
    note: "Chats, files and memory live in your Cloudflare storage.",
  },
  { icon: ClockIcon, title: "Works when the tab is closed", note: "Recipes and workers run on your Workers." },
  { icon: WalletIcon, title: "Free for most people", note: "We tell you before anything costs money." },
] as const

function Facts() {
  return (
    <div class="ob-facts" style={{ "--i": 2 }}>
      <For each={FACTS}>
        {(fact) => (
          <div class="ob-fact">
            <RemixIcon icon={fact.icon} size={16} />
            <span>
              <b>{fact.title}</b>
              <span>{fact.note}</span>
            </span>
          </div>
        )}
      </For>
    </div>
  )
}

function CloudflareMark() {
  return (
    <span class="ob-cf" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24">
        <path
          d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"
          fill="#F38020"
        />
      </svg>
    </span>
  )
}

const FIX_ACTION: Record<Fix["_tag"], string> = {
  Resend: "try-again",
  Reconnect: "connect-again",
  SignInAgain: "sign-in-again",
  FinishSignIn: "try-again",
}

export default function ConnectPage() {
  return (
    <div class="ob-solo">
      <div class="ob-solo-card">
        <ConnectCloudflare />
      </div>
    </div>
  )
}

const STAGE_MS = 7000

function InstallProgress() {
  const [stage, setStage] = createSignal(0)
  const timer = setInterval(() => setStage((s) => Math.min(s + 1, STEPS.length - 1)), STAGE_MS)
  onCleanup(() => clearInterval(timer))
  return (
    <div class="ob-checklist" role="status" data-field="install-progress" style={{ "--i": 2 }}>
      <For each={STEPS}>
        {(label, i) => (
          <div class="ob-check" data-state={i() < stage() ? "done" : i() === stage() ? "running" : "next"}>
            <span class="ob-check-box" aria-hidden="true">
              <RemixIcon icon={CheckIcon} size={12} />
            </span>
            <span class="ob-check-label">{label}</span>
          </div>
        )}
      </For>
    </div>
  )
}

function FailedPanel(props: { failure: Failure; onFix: (fix: Fix) => void }) {
  return (
    <div class="ob-problem" role="alert" data-field="install-error">
      <b>{props.failure.sentence}</b>
      <Show when={props.failure.detail}>
        {(detail) => (
          <p class="ob-detail" data-field="install-error-detail">
            Cloudflare said: {detail()}
          </p>
        )}
      </Show>
      <div class="ob-problem-actions">
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
    <div class="ob-body" data-field="choose-account">
      <p class="ob-note">This sign-in can use more than one Cloudflare account. Pick the one Kiko goes in.</p>
      <For each={props.accounts}>
        {(account) => (
          <button
            type="button"
            class="ob-card ob-card-plain"
            data-action="pick-account"
            onClick={() => props.onPick(account.id)}
          >
            {account.name}
          </button>
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
    <div class="ob-cta ob-cta-loose" data-field="decide">
      <Show when={props.view.note}>
        {(note) => (
          <p class="ob-error" role="alert">
            {note()}
          </p>
        )}
      </Show>
      <Show when={props.view.found.keepable}>
        <Button variant="primary" data-action="take-over" onClick={() => props.onTakeOver()}>
          Keep chats (take over)
        </Button>
      </Show>
      <Button data-action="start-fresh" onClick={() => props.onStartFresh()}>
        Start fresh (deletes its chats)
      </Button>
      <Button
        variant="ghost"

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
    <div class="ob-cta ob-cta-loose" data-field="confirm-start-fresh">
      <Button variant="danger" data-action="confirm-start-fresh" onClick={() => props.onConfirm()}>
        Delete and start fresh
      </Button>
      <Button data-action="cancel-start-fresh" onClick={() => props.onBack()}>
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
  const heading = () =>
    view()._tag === "Start" && !reconnect()
      ? {
          title: "Give Kiko a home.",
          lede: "Kiko runs on your own Cloudflare account, so it keeps working when this tab is closed.",
        }
      : headingOf(view(), reconnect())

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
    <div class="welcome-step" data-component="connect" data-step="cloudflare" data-view={view()._tag}>
      <h1 class="welcome-title" style={{ "--i": 0 }}>
        {heading().title}
      </h1>
      <p class="welcome-lede" style={{ "--i": 1 }}>
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
          <div class="ob-body">
            <Show when={!tokenOpen()}>
              <Facts />
            </Show>
            <Show when={note()}>
              <p class="ob-error" role="alert" data-field="connect-note">
                {note()}
              </p>
            </Show>
            <Show when={tokenOpen()}>
              <form
                class="ob-token"
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
                        <p class="ob-note" role="status">
                          Loading the token steps
                        </p>
                      }
                    >
                      {(message) => (
                        <div class="ob-problem">
                          <p class="ob-error" role="alert">
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
                      <p class="ob-note">
                        The link ticks them for you. Check that they match, then create the token and paste it here.
                      </p>
                      <ul class="ob-perms" data-field="token-permissions">
                        <For each={t().permissions}>{(p) => <li>{p}</li>}</For>
                      </ul>
                    </>
                  )}
                </Show>
                <input
                  {...SECRET_FIELD}
                  class="ob-field"
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
          </div>
          <div class="ob-cta" style={{ "--i": 3 }}>
            <Button
              variant="primary"
              data-cta
              disabled={redirecting()}
              data-action="connect-cloudflare"
              onClick={() => void withCloudflare()}
            >
              <CloudflareMark />
              {redirecting() ? "Opening Cloudflare" : "Connect Cloudflare"}
              <Show when={redirecting()}>
                <Dots />
              </Show>
            </Button>
            <Show when={!tokenOpen()}>
              <Button variant="ghost" data-action="use-token" onClick={() => void openToken()}>
                Use an API token instead
              </Button>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
