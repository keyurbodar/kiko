import { useLocation } from "@tanstack/solid-router"
import { Match, Show, Switch, createSignal, onMount } from "solid-js"
import { openSignIn } from "../clerk"
import { continueAs, phase, useAnotherAccount } from "../session"
import { errorText, primary } from "./controls"
import { Dots } from "./dots"
import { Cover } from "./welcome"

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

function SignIn() {
  const [opening, setOpening] = createSignal(false)
  const [error, setError] = createSignal("")

  const open = () => {
    setError("")
    setOpening(true)
    openSignIn()
      .catch((e: unknown) => setError(message(e, "Could not open sign-in. Try again.")))
      .finally(() => setOpening(false))
  }

  return (
    <>
      <Show when={error()}>
        <p class={errorText} role="alert">
          {error()}
        </p>
      </Show>
      <button type="button" class={primary} data-cta disabled={opening()} data-action="sign-in" onClick={open}>
        {opening() ? "Opening sign-in" : "Sign in"}
        <Show when={opening()}>
          <Dots />
        </Show>
      </button>
    </>
  )
}

function TicketSignIn(props: { readonly ticket: string }) {
  const [failed, setFailed] = createSignal("")
  onMount(() => {
    void import("../dev-ticket")
      .then((m) => m.signInWithTicket(props.ticket))
      .catch((e: unknown) => setFailed(message(e, "Ticket sign-in failed")))
  })
  return (
    <Show when={failed()} fallback={<Waiting label="Signing in" />}>
      <p class={errorText} role="alert">
        {failed()}
      </p>
      <SignIn />
    </Show>
  )
}

function Waiting(props: { readonly label: string }) {
  return (
    <button type="button" class={primary} disabled data-action="sign-in">
      {props.label}
      <Dots />
    </button>
  )
}

function Live(props: { readonly email: string }) {
  return (
    <>
      <div class="ob-hi">
        <span class="ob-hi-initial" aria-hidden="true">
          {props.email.slice(0, 1).toUpperCase() || "K"}
        </span>
        <span class="ob-hi-text">
          <b>Welcome back</b>
          <span>{props.email}</span>
        </span>
        <button type="button" data-action="use-another-account" onClick={() => void useAnotherAccount()}>
          Not you?
        </button>
      </div>
      <button type="button" class={primary} data-cta data-action="continue-as" onClick={() => void continueAs()}>
        {props.email ? `Continue as ${props.email}` : "Continue to Kiko"}
      </button>
    </>
  )
}

export function ClerkStep() {
  const ticket = import.meta.env.DEV ? new URLSearchParams(useLocation()().searchStr).get("ticket") : null
  const live = () => {
    const current = phase()
    return current._tag === "SignedOut" && current.clerk._tag === "Live" ? current.clerk.email : null
  }
  return (
    <div class="welcome-step" data-step="sign-in" data-phase={phase()._tag}>
      <Cover title="Meet your team." lede="They're asleep for now. Sign in and they'll start waking up." />
      <div class="ob-cta" style={{ "--i": 2 }}>
        <Switch fallback={<Waiting label="Signing in" />}>
          <Match when={phase()._tag === "SigningOut"}>
            <Waiting label="Signing out" />
          </Match>
          <Match when={live()}>{(email) => <Live email={email()} />}</Match>
          <Match when={phase()._tag === "SignedOut"}>
            <Show when={ticket} fallback={<SignIn />}>
              {(value) => <TicketSignIn ticket={value()} />}
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
