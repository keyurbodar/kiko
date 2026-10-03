import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createResource, createSignal, Show } from "solid-js"
import { Card } from "./sections"

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
		const out = res ? ((await res.json().catch(() => ({}))) as Partial<Soul> & { error?: string }) : { error: "could not reach kiko" }
		if (res?.ok && out.body !== undefined && out.sha) {
			mutate({ body: out.body, sha: out.sha })
			setDraft(null)
			return
		}
		if (res?.status === 409 && out.body !== undefined && out.sha) {
			mutate({ body: out.body, sha: out.sha })
			setDraft(out.body)
			showToastV2({ title: "it changed while you were editing. this is the newest version", variant: "error" })
			return
		}
		showToastV2({ title: out.error ?? "could not save", variant: "error" })
	}

	return (
		<Card id="agent-soul" title="profile" hint="who it is and how it works with you. it keeps this current itself.">
			<Show when={soul()} fallback={<p class="px-2 py-1 text-sm text-weak">{soul.loading ? "loading" : "could not load"}</p>}>
				{(s) => (
					<Show
						when={draft() !== null}
						fallback={
							<div class="flex flex-col gap-2 px-2 py-1">
								<pre class="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-sm text-text" data-component="soul-text">
									{s().body}
								</pre>
								<button type="button" class="h-8 self-start rounded-lg bg-btn px-3 text-sm" data-action="edit-soul" onClick={() => setDraft(s().body)}>
									edit
								</button>
							</div>
						}
					>
						<div class="flex flex-col gap-2 px-2 py-1">
							<textarea
								class="min-h-56 w-full resize-y rounded-lg bg-bg-subtle p-2 font-mono text-[13px] text-text outline-none"
								value={draft() ?? ""}
								maxLength={MAX_SOUL}
								data-component="soul-editor"
								onInput={(e) => setDraft(e.currentTarget.value)}
							/>
							<div class="flex items-center gap-2">
								<button type="button" class="h-8 rounded-lg bg-btn px-3 text-sm disabled:opacity-40" data-action="save-soul" disabled={saving() || !draft()?.trim()} onClick={() => void save()}>
									{saving() ? "saving" : "save"}
								</button>
								<button type="button" class="h-8 rounded-lg px-3 text-sm text-weak" onClick={() => setDraft(null)}>
									cancel
								</button>
								<span class="ml-auto text-xs text-faint">
									{draft()?.length ?? 0}/{MAX_SOUL}
								</span>
							</div>
						</div>
					</Show>
				)}
			</Show>
		</Card>
	)
}
