import { HugeIcon } from "@kiko/ui/huge-icon"
import { CheckIcon, ChevronRightIcon } from "@kiko/ui/icons"
import { For, Show, type JSX, type ParentProps } from "solid-js"
import { cn } from "../lib/cn"

/*
 * The frame of the hosted onboarding, after t3code's welcome wizard (`apps/web/src/components/ui/wizard.tsx`):
 * a card with the wordmark, a strip of numbered steps, and a panel. Signing in is step 1, connecting
 * Cloudflare step 2, and the install step 3.
 */

export const STAGES = ["Sign in", "Connect", "Install"] as const
export type Stage = 0 | 1 | 2

export function Wizard(props: ParentProps<{ stage: Stage }>) {
  return (
    <div class="h-dvh overflow-y-auto bg-background" data-component="wizard">
      <div class="flex min-h-full w-full items-center justify-center p-4">
        <div class="flex w-full max-w-xl flex-col rounded-2xl border border-[color-mix(in_oklab,var(--foreground)_8%,transparent)] bg-background shadow-[0_24px_64px_-24px_rgb(0_0_0/0.65)]">
          <div class="flex flex-col gap-4 p-6 pb-3">
            <p class="text-2xl font-semibold tracking-tight text-foreground" aria-label="Kiko">
              Kiko
            </p>
            <ol class="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-[color-mix(in_oklab,var(--foreground)_4%,transparent)] p-1" aria-label="Setup progress">
              <For each={STAGES}>
                {(label, i) => (
                  <li
                    class={cn(
                      "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 max-sm:justify-center",
                      i() === props.stage && "bg-card ring-1 ring-inset ring-[color-mix(in_oklab,var(--foreground)_5%,transparent)]",
                    )}
                    aria-current={i() === props.stage ? "step" : undefined}
                    data-stage={i()}
                  >
                    <span
                      class={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full text-sm font-medium ring-1",
                        i() < props.stage
                          ? "bg-primary text-primary-foreground ring-primary"
                          : i() === props.stage
                            ? "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-primary ring-[color-mix(in_oklab,var(--primary)_30%,transparent)]"
                            : "bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] text-muted-foreground ring-[color-mix(in_oklab,var(--foreground)_10%,transparent)]",
                      )}
                      aria-hidden="true"
                    >
                      <Show when={i() < props.stage} fallback={i() + 1}>
                        <HugeIcon icon={CheckIcon} size={14} />
                      </Show>
                    </span>
                    <span class={cn("min-w-0 truncate text-sm font-medium max-sm:hidden", i() === props.stage ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                  </li>
                )}
              </For>
            </ol>
          </div>
          <div class="flex flex-col rounded-b-2xl border-t border-[color-mix(in_oklab,var(--foreground)_5%,transparent)] bg-[color-mix(in_oklab,var(--foreground)_2%,transparent)] px-6 py-5">
            {props.children}
          </div>
        </div>
      </div>
    </div>
  )
}

export function WizardTitle(props: { title: string; children: JSX.Element }) {
  return (
    <>
      <h1 class="text-2xl font-semibold tracking-tight text-foreground">{props.title}</h1>
      <p class="mt-2.5 text-sm leading-relaxed text-muted-foreground">{props.children}</p>
    </>
  )
}

export const optionClass =
  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 text-left text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"

/** One choice in a step: an icon, a label, an optional hint on the right, and a chevron. */
export function Option(props: {
  icon: JSX.Element
  label: string
  hint?: string
  open?: boolean
  disabled?: boolean
  onClick: () => void
  [data: `data-${string}`]: string | undefined
}) {
  return (
    <button
      type="button"
      class={optionClass}
      disabled={props.disabled}
      aria-expanded={props.open}
      data-action={props["data-action"]}
      onClick={() => props.onClick()}
    >
      <span class="grid size-4 shrink-0 place-items-center text-muted-foreground">{props.icon}</span>
      <span class="flex-1">{props.label}</span>
      <Show when={props.hint}>
        <span class="text-xs font-normal text-muted-foreground">{props.hint}</span>
      </Show>
      <HugeIcon icon={ChevronRightIcon} size={16} class={cn("shrink-0 text-muted-foreground", props.open && "rotate-90")} />
    </button>
  )
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  )
}

export function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

export function CloudMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M17.5 19H7a5 5 0 1 1 1.4-9.8A6 6 0 0 1 20 11.6a3.75 3.75 0 0 1-2.5 7.4Z" />
    </svg>
  )
}
