import { Match, Show, Suspense, Switch, lazy } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { SETTINGS_SECTIONS, tabsOf } from "./sections"
import { ModelsPage } from "./models"
import { Integrations } from "./integrations"
import { IdentityAvatar } from "../lib/IdentityAvatar"
import { useApp } from "../lib/store"
import { session, signOut } from "../app/session"
import type { JSX } from "solid-js"
import { Button, Group, Hint, Item, Page, Tabs } from "./kit"

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
      <Group title="Account">
        <Item
          icon={<IdentityAvatar seed={user()?.id ?? "you"} size={24} />}
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

function Tools(props: { tab: string }) {
  return (
    <Switch>
      <Match when={props.tab === "apps"}>
        <Integrations />
      </Match>
      <Match when={props.tab === "extensions" || props.tab === "catalog"}>
        <Suspense>
          <Extensions view={props.tab === "catalog" ? "catalog" : "installed"} />
        </Suspense>
      </Match>
      <Match when={props.tab === "skills"}>
        <Hint data-component="skills-empty">A skill is a set of instructions an agent loads when a task needs it. You have none yet.</Hint>
      </Match>
    </Switch>
  )
}

function General() {
  return (
    <div class="flex flex-col gap-8">
      <Suspense>
        <Initiative />
      </Suspense>
      <Account />
    </div>
  )
}

const COMPONENTS: Record<string, (props: { tab: string }) => JSX.Element> = {
  models: ModelsPage,
  tools: Tools,
  general: General,
  appearance: () => (
    <Suspense>
      <Appearance />
    </Suspense>
  ),
}

export function SettingsShell(props: { sectionId: string; tab: string | undefined }) {
  const navigate = useNavigate()
  const meta = () => SETTINGS_SECTIONS.find((s) => s.id === props.sectionId)
  const waiting = () => useApp.user()?.proposals().length ?? 0
  const tabs = () => tabsOf(props.sectionId).map((t) => (t.id === "extensions" ? { ...t, count: waiting() } : t))
  const tab = () => (tabs().some((t) => t.id === props.tab) ? props.tab! : (tabs()[0]?.id ?? ""))
  const Section = () => {
    const Body = COMPONENTS[props.sectionId] ?? ModelsPage
    return <Body tab={tab()} />
  }
  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 md:px-4 md:pb-4" data-component="settings">
      <div class="@container/settings flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-component="settings-body">
        <div class="mx-auto w-full max-w-3xl px-5 py-6 pb-16 max-[767px]:pt-14 @min-[560px]/settings:px-8 @min-[560px]/settings:py-8">
          <Page title={meta()?.label ?? "Settings"} description={meta()?.hint}>
            <Show when={tabs().length}>
              <div class="mb-6">
                <Tabs label={meta()?.label ?? "Settings"} items={tabs()} value={tab()} onChange={(id) => navigate(`/settings/${props.sectionId}/${id}`)} />
              </div>
            </Show>
            <Section />
          </Page>
        </div>
      </div>
    </div>
  )
}
