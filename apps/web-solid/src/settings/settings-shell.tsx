import { A } from "@solidjs/router"
import { Suspense, createEffect, lazy } from "solid-js"
import { NAV_SECTIONS, SETTINGS_SECTIONS } from "./sections"
import { ModelsPage } from "./models"
import { Integrations } from "./integrations"
import { DeleteAccount } from "../app/delete-account"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { session, signOut } from "../app/session"
import type { JSX } from "solid-js"

/*
 * The settings route body: the section the URL names. The section list lives in the sidebar
 * (`sidebar/settings/sidebar.tsx`). Sections mount lazily with the route, and each list uses
 * content-visibility so a long catalog costs nothing off screen.
 */

// The appearance section and its validator load with the section, not with the route.
const Appearance = lazy(() => import("../theme/appearance"))

function Account() {
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <div class="flex flex-col gap-4" data-component="account">
      <div class="flex items-center gap-3 rounded-2xl bg-[var(--surface-raised)] p-4">
        <IdentityAvatar seed={user()?.id ?? "you"} size={48} />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[15px] font-semibold text-text">{(user()?.name ?? "you").toLowerCase()}</span>
          <span class="block truncate text-xs text-weak">{user()?.email ?? ""}</span>
        </span>
        <button
          type="button"
          class="h-10 shrink-0 rounded-[10px] bg-[var(--tab-bg-active)] px-4 text-sm text-[var(--tab-text-active)] hover:bg-[var(--tab-bg-hover)] md:h-8"
          data-action="sign-out"
          onClick={() => void signOut()}
        >
          sign out
        </button>
      </div>
      <DeleteAccount />
    </div>
  )
}

const COMPONENTS: Record<string, (props: {}) => JSX.Element> = {
  models: ModelsPage,
  account: Account,
  integrations: Integrations,
  skills: () => <p class="text-xs text-weak" data-component="skills-empty">no skills yet. skills you add will be listed here.</p>,
  appearance: () => (
    <Suspense>
      <Appearance />
    </Suspense>
  ),
}

function section(id: string) {
  const Section = COMPONENTS[id] ?? ModelsPage
  return <Section />
}

export function SettingsShell(props: { sectionId: string }) {
  const meta = () => SETTINGS_SECTIONS.find((s) => s.id === props.sectionId)
  let nav: HTMLElement | undefined
  // On a phone the tabs scroll sideways, so the open one must be in view after a reload or a deep link.
  createEffect(() => {
    props.sectionId
    queueMicrotask(() => nav?.querySelector("[aria-current=page]")?.scrollIntoView({ inline: "center", block: "nearest" }))
  })
  return (
    <div
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 md:flex-row md:gap-4 md:px-4 md:pb-4"
      data-component="settings"
    >
      {/* On a phone the sidebar is a drawer, so the sections are a row of tabs here. From 768 px the sidebar lists them. */}
      <nav
        ref={nav}
        class="flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
        aria-label="settings sections"
      >
        {NAV_SECTIONS.map((s) => (
          <A
            href={`/settings/${s.id}`}
            class="flex h-10 shrink-0 items-center whitespace-nowrap rounded-[10px] px-3 text-sm text-muted outline-none hover:bg-[var(--tab-bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:h-9"
            activeClass="bg-[var(--tab-bg-active)] text-[var(--tab-text-active)]"
          >
            {s.label}
          </A>
        ))}
      </nav>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-component="settings-body">
        <div class="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-1 pt-6 pb-10 md:pt-10">
          <header class="flex flex-col gap-0.5 px-1">
            <h1 class="text-[15px] font-semibold text-text">{meta()?.label ?? "settings"}</h1>
            <p class="text-sm text-weak">{meta()?.hint}</p>
          </header>
          {section(props.sectionId)}
        </div>
      </div>
    </div>
  )
}
