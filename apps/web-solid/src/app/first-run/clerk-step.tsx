import { useLocation } from "@tanstack/solid-router"
import { Match, Show, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { mountSignIn } from "../clerk"
import { continueAs, phase, useAnotherAccount } from "../session"
import { Cover, primary, secondary } from "./welcome"

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

function SignInForm() {
  let node!: HTMLDivElement
  let unmount: (() => void) | undefined
  let disposed = false
  const [state, setState] = createSignal<"loading" | "shown" | "failed">("loading")
  const [error, setError] = createSignal("")

  const show = () => {
    setState("loading")
    mountSignIn(node).then(
      (stop) => {
        if (disposed) return stop()
        unmount = stop
        setState("shown")
      },
      (e: unknown) => {
        setError(errorText(e, "Could not load the sign-in form. Try again."))
        setState("failed")
      },
    )
  }

  onMount(show)
  onCleanup(() => {
    disposed = true
    unmount?.()
  })

  return (
    <>
      <div ref={node} class="welcome-clerk" data-component="clerk-sign-in" hidden={state() === "failed"} />
      <Show when={state() === "loading"}>
        <p class="text-center text-sm text-muted-foreground" role="status">
          Loading sign-in
        </p>
      </Show>
      <Show when={state() === "failed"}>
        <p class="text-center text-sm text-[var(--error)]" role="alert">
          {error()}
        </p>
        <button type="button" class={primary} data-action="sign-in" onClick={show}>
          Try again
        </button>
      </Show>
    </>
  )
}

function TicketSignIn(props: { readonly ticket: string }) {
  const [failed, setFailed] = createSignal("")
  onMount(() => {
    void import("../dev-ticket")
      .then((m) => m.signInWithTicket(props.ticket))
      .catch((e: unknown) => setFailed(errorText(e, "Ticket sign-in failed")))
  })
  return (
    <Show when={failed()} fallback={<Waiting label="Signing in" />}>
      <p class="text-center text-sm text-[var(--error)]" role="alert">
        {failed()}
      </p>
      <SignInForm />
    </Show>
  )
}

function Waiting(props: { readonly label: string }) {
  return (
    <button type="button" class={primary} disabled data-action="sign-in">
      {props.label}
    </button>
  )
}

function Live(props: { readonly email: string }) {
  return (
    <>
      <button type="button" class={primary} data-action="continue-as" onClick={() => void continueAs()}>
        {props.email ? `Continue as ${props.email}` : "Continue to Kiko"}
      </button>
      <button
        type="button"
        class={secondary}
        data-action="use-another-account"
        onClick={() => void useAnotherAccount()}
      >
        Use another account
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
    <div class="welcome-step flex w-full flex-col gap-3" data-step="sign-in" data-phase={phase()._tag}>
      <Cover />
      <div class="mt-2 flex w-full flex-col gap-2" style={{ "--i": 2 }}>
        <Switch fallback={<Waiting label="Signing in" />}>
          <Match when={phase()._tag === "SigningOut"}>
            <Waiting label="Signing out" />
          </Match>
          <Match when={live()}>{(email) => <Live email={email()} />}</Match>
          <Match when={phase()._tag === "SignedOut"}>
            <Show when={ticket} fallback={<SignInForm />}>
              {(value) => <TicketSignIn ticket={value()} />}
            </Show>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
