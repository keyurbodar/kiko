import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createResource, createSignal, Show } from "solid-js"
import { buttonClass } from "../../settings/kit"

/*
 * An agent's soul (architecture section 8.4): who it is and how it works with you, in every chat.
 * The agent keeps it current itself; here the human reads it and can rewrite it. A save that lost a
 * race with the agent's own edit shows the newer text instead of overwriting it.
 */

const MAX_SOUL = 3_000
type Soul = { body: string; sha: string }

async function load(slug: string): Promise<Soul | null> {
	const res = await fetch(`/api/souls/${slug}`)
	return res.ok ? ((await res.json()) as Soul) : null
}

export function SoulCard(props: { slug: string }) {
	const [soul, { mutate }] = createResource(() => props.slug, load)
	const [draft, setDraft] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)

	const save = async () => {
		const body = draft()
		const current = soul()
		if (body === null || !current) return
		setSaving(true)
		const res = await fetch(`/api/souls/${props.slug}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ body, expectSha: current.sha }),
		}).catch(() => null)
		setSaving(false)
		const out = res ? ((await res.json().catch(() => ({}))) as Partial<Soul> & { error?: string }) : { error: "Could not reach Kiko" }
		if (res?.ok && out.body !== undefined && out.sha) {
			mutate({ body: out.body, sha: out.sha })
			setDraft(null)
			return
		}
		if (res?.status === 409 && out.body !== undefined && out.sha) {
			mutate({ body: out.body, sha: out.sha })
			setDraft(out.body)
			showToastV2({ title: "It changed while you were editing. This is the newest version", variant: "error" })
			return
		}
		showToastV2({ title: out.error ?? "Could not save", variant: "error" })
	}

	return (
		<div class="flex flex-col gap-2 px-2 py-3" data-card="agent-soul">
			<Show when={soul()} fallback={<p class="px-2 py-1 text-[13px] text-weak">{soul.loading ? "Loading" : "Could not load"}</p>}>
				{(s) => (
					<Show
						when={draft() !== null}
						fallback={
							<div class="flex flex-col gap-2 px-2 py-1">
								<pre class="whitespace-pre-wrap font-sans text-[13px] leading-5 text-text" data-component="soul-text">
									{s().body}
								</pre>
								<button type="button" class={buttonClass("secondary", "self-start")} data-action="edit-soul" onClick={() => setDraft(s().body)}>
									Edit
								</button>
							</div>
						}
					>
						<div class="flex flex-col gap-2 px-2 py-1">
							<textarea
								class="min-h-72 w-full resize-y rounded-lg bg-bg-subtle p-2 font-mono text-[13px] text-text outline-none"
								value={draft() ?? ""}
								maxLength={MAX_SOUL}
								data-component="soul-editor"
								onInput={(e) => setDraft(e.currentTarget.value)}
							/>
							<div class="flex items-center gap-2">
								<button type="button" class={buttonClass("primary")} data-action="save-soul" disabled={saving() || !draft()?.trim()} onClick={() => void save()}>
									{saving() ? "Saving" : "Save"}
								</button>
								<button type="button" class={buttonClass("ghost")} onClick={() => setDraft(null)}>
									Cancel
								</button>
								<span class="ml-auto text-xs text-faint">
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
