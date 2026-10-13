import { Suspense, lazy } from "solid-js"
import { SETTINGS_SECTIONS } from "./sections"
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
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 md:px-4 md:pb-4" data-component="settings">
      <div class="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-component="settings-body">
        <div class="mx-auto w-full max-w-3xl px-5 py-6 pb-16 max-[767px]:pt-14 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
          <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
            {section(props.sectionId)}
          </Page>
        </div>
      </div>
    </div>
  )
}
