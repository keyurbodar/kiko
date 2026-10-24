import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { ConflictError, type AgentSlug } from "@kiko/protocol"
import * as Cause from "effect/Cause"
import { createSignal, Show } from "solid-js"
import { buttonClass } from "../../settings/kit"
import { createQuery, failureMessage, owner, run } from "../../state/runtime"
import { user } from "../../state/user"

const MAX_SOUL = 3_000

export function SoulCard(props: { slug: string }) {
  const row = () => user.rows("soul").find((r) => r.id === props.slug)
  const fetched = createQuery(() =>
    user.synced() && !row() ? owner.queries.soul({ slug: props.slug as AgentSlug }) : null,
  )
  const soul = () => row() ?? fetched()
  const [draft, setDraft] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)

  const save = async () => {
    const body = draft()
    const current = soul()
    if (body === null || !current) return
    setSaving(true)
    const result = await run(owner.commands.soulUpdate, {
      slug: props.slug as AgentSlug,
      body,
      expectSha: current.sha,
    })
    setSaving(false)
    if (result._tag === "Success") return void setDraft(null)
    if (Cause.squash(result.cause) instanceof ConflictError) {
      setDraft(soul()?.body ?? body)
      showToastV2({ title: "It changed while you were editing. This is the newest version", variant: "error" })
      return
    }
    showToastV2({ title: failureMessage(result.cause, "Could not reach Kiko"), variant: "error" })
  }

  return (
    <div class="flex flex-col gap-2 px-2 py-3" data-card="agent-soul">
      <Show when={soul()} fallback={<p class="px-2 py-1 text-[13px] text-fg3">Loading</p>}>
        {(s) => (
          <Show
            when={draft() !== null}
            fallback={
              <div class="flex flex-col gap-2 px-2 py-1">
                <pre class="whitespace-pre-wrap font-sans text-[13px] leading-5 text-fg" data-component="soul-text">
                  {s().body}
                </pre>
                <button
                  type="button"
                  class={buttonClass("secondary", "self-start")}
                  data-action="edit-soul"
                  onClick={() => setDraft(s().body)}
                >
                  Edit
                </button>
              </div>
            }
          >
            <div class="flex flex-col gap-2 px-2 py-1">
              <textarea
                class="min-h-72 w-full resize-y rounded-[12px] bg-panel p-3 font-mono text-[13px] text-fg outline-none"
                value={draft() ?? ""}
                maxLength={MAX_SOUL}
                data-component="soul-editor"
                onInput={(e) => setDraft(e.currentTarget.value)}
              />
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class={buttonClass("primary")}
                  data-action="save-soul"
                  disabled={saving() || !draft()?.trim()}
                  onClick={() => void save()}
                >
                  {saving() ? "Saving" : "Save"}
                </button>
                <button type="button" class={buttonClass("ghost")} onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <span class="ml-auto text-xs text-secondary-label">
                  {draft()?.length ?? 0}/{MAX_SOUL}
                </span>
              </div>
            </div>
          </Show>
        )}
      </Show>
    </div>
  )
}
