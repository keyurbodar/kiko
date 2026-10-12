import { A } from "@solidjs/router"
import { Suspense, createEffect, lazy } from "solid-js"
import { NAV_SECTIONS, SETTINGS_SECTIONS } from "./sections"
import { ModelsPage, ProvidersPage } from "./models"
import { Integrations } from "./integrations"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { session, signOut } from "../app/session"
import type { JSX } from "solid-js"
import { Button, Group, Hint, Item, Page } from "./kit"

/*
 * The settings route body: the section the URL names. The section list lives in the sidebar
 * (`sidebar/settings/sidebar.tsx`). Sections mount lazily with the route, and each list uses
 * content-visibility so a long catalog costs nothing off screen.
 */

// The appearance section and its validator load with the section, not with the route.
const Appearance = lazy(() => import("../theme/appearance"))
// The extensions section, with the manifest review and the code view, loads with the section too.
const Initiative = lazy(() => import("./initiative"))
const Extensions = lazy(() => import("./extensions"))

function Account() {
  const user = () => {
    const s = session()
    return s.status === "signed-in" ? s.user : null
  }
  return (
    <div class="flex flex-col gap-8" data-component="account">
      <Group title="Profile">
        <Item
          icon={<IdentityAvatar seed={user()?.id ?? "you"} size={28} />}
          title={user()?.name ?? "You"}
          actions={
            <Button data-action="sign-out" onClick={() => void signOut()}>
              Sign out
            </Button>
          }
        />
      </Group>
    </div>
  )
}

const COMPONENTS: Record<string, (props: {}) => JSX.Element> = {
  providers: ProvidersPage,
  models: ModelsPage,
  account: Account,
  integrations: Integrations,
  skills: () => <Hint data-component="skills-empty">A skill is a set of instructions an agent loads when a task needs it. You have none yet.</Hint>,
  appearance: () => (
    <Suspense>
      <Appearance />
    </Suspense>
  ),
  initiative: () => (
    <Suspense>
      <Initiative />
    </Suspense>
  ),
  extensions: () => (
    <Suspense>
      <Extensions />
    </Suspense>
  ),
}

function section(id: string) {
  const Section = COMPONENTS[id] ?? ProvidersPage
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
        class="ml-9 flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
        aria-label="Settings sections"
      >
        {NAV_SECTIONS.map((s) => (
          <A
            href={`/settings/${s.id}`}
            class="flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-[13px] text-muted outline-none hover:bg-[var(--hover-bg)]"
            activeClass="bg-[var(--selected-bg)] text-text"
          >
            {s.label}
          </A>
        ))}
      </nav>
      <div class="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-component="settings-body">
        <div class="mx-auto w-full max-w-3xl px-5 py-6 pb-16 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
          <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
            {section(props.sectionId)}
          </Page>
        </div>
      </div>
    </div>
  )
}
