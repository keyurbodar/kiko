import { Suspense, lazy } from "solid-js"
import { ModelList } from "./model-picker"
import { chatModel, setChatModel } from "./chat-model"
import { ProviderList } from "./providers"
import { Integrations } from "./integrations"
import type { JSX } from "solid-js"

/*
 * The settings route body: the section the URL names. The section list lives in the sidebar
 * (`sidebar/settings/sidebar.tsx`). Sections mount lazily with the route, and each list uses
 * content-visibility so a long catalog costs nothing off screen.
 */

// The theme editor and its validator load with the section, not with the route.
const Appearance = lazy(() => import("../theme/editor"))

const COMPONENTS: Record<string, (props: {}) => JSX.Element> = {
  providers: ProviderList,
  integrations: Integrations,
  skills: () => <p class="text-xs text-weak" data-component="skills-empty">no skills yet. skills you add will be listed here.</p>,
  appearance: () => (
    <Suspense>
      <Appearance />
    </Suspense>
  ),
}

function section(id: string) {
  const Section = COMPONENTS[id] ?? DefaultModel
  return <Section />
}

function DefaultModel() {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2" data-component="default-model">
      <p class="text-xs text-weak">
        new chats start with this model. pick another for one chat from its top bar.
        {chatModel(null) ? ` now: ${chatModel(null)}` : ""}
      </p>
      <ModelList current={chatModel(null)} onPick={(ref) => setChatModel(null, ref)} />
    </div>
  )
}

export function SettingsShell(props: { sectionId: string }) {
  return (
    <div class="flex min-h-0 flex-1 gap-4 overflow-hidden px-4 pb-4" data-component="settings">
      <div class="flex min-h-0 min-w-0 max-w-[720px] flex-1 flex-col overflow-y-auto">{section(props.sectionId)}</div>
    </div>
  )
}
