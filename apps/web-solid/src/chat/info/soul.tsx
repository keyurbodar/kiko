import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { createEffect, createSignal, Show } from "solid-js"
import { buttonClass } from "../../settings/kit"
import { apiFetch } from "../../lib/api"
import { useApp } from "../../lib/store"

const MAX_SOUL = 3_000

export function SoulCard(props: { slug: string }) {
	const soul = () => useApp.row("soul", props.slug)
	const [draft, setDraft] = createSignal<string | null>(null)
	const [saving, setSaving] = createSignal(false)
	createEffect(() => {
		if (useApp.user()?.state.synced && !soul()) void apiFetch(`/api/souls/${props.slug}`).catch(() => {})
	})

	const save = async () => {
		const body = draft()
		const current = soul()
		if (body === null || !current) return
		setSaving(true)
		let refused: { conflict: boolean; error?: string } = { conflict: false }
		const ok = await useApp.editRow("soul", props.slug, { ...current, body }, async () => {
			const res = await apiFetch(`/api/souls/${props.slug}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ body, expectSha: current.sha }),
			}).catch(() => null)
			if (!res?.ok) refused = { conflict: res?.status === 409, error: res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : "Could not reach Kiko" }
			return Boolean(res?.ok)
		})
		setSaving(false)
		if (ok) return void setDraft(null)
		if (refused.conflict) {
			setDraft(soul()?.body ?? body)
			showToastV2({ title: "It changed while you were editing. This is the newest version", variant: "error" })
			return
		}
		showToastV2({ title: refused.error ?? "Could not save", variant: "error" })
	}

	return (
		<div class="flex flex-col gap-2 px-2 py-3" data-card="agent-soul">
			<Show when={soul()} fallback={<p class="px-2 py-1 text-[13px] text-muted-foreground">Loading</p>}>
				{(s) => (
					<Show
						when={draft() !== null}
						fallback={
							<div class="flex flex-col gap-2 px-2 py-1">
								<pre class="whitespace-pre-wrap font-sans text-[13px] leading-5 text-foreground" data-component="soul-text">
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
								class="min-h-72 w-full resize-y rounded-lg bg-card p-2 font-mono text-[13px] text-foreground outline-none"
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
