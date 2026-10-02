import { A } from "@solidjs/router"
import { ModelList } from "./model-picker"
import { chatModel, setChatModel } from "./chat-model"
import { ProviderList } from "./providers"

/*
 * The settings route shell: a small tab list and the section beside it. The
 * URL names the section, so a reload lands where the user was. The sections
 * mount lazily with the route, and each list uses content-visibility so a
 * long catalog costs nothing off screen.
 */
export const SECTIONS = [
  { id: "providers", label: "providers" },
  { id: "models", label: "default model" },
] as const

function section(id: string) {
  return id === "providers" ? <ProviderList /> : <DefaultModel />
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
      <nav class="flex w-40 shrink-0 flex-col gap-1" aria-label="settings sections">
        {SECTIONS.map((s) => (
          <A
            href={`/settings/${s.id}`}
            class="rounded-[10px] px-3 py-2 text-sm text-muted hover:bg-[var(--tab-bg-hover)]"
            activeClass="bg-[var(--tab-bg-active)] text-[var(--tab-text-active)]"
          >
            {s.label}
          </A>
        ))}
      </nav>
      <div class="flex min-h-0 min-w-0 max-w-[720px] flex-1 flex-col overflow-y-auto">{section(props.sectionId)}</div>
    </div>
  )
}
