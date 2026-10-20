import { createResource, Match, onCleanup, Switch } from "solid-js"
import { SurfaceFailure, SurfaceLoading } from "../chrome"
import { apiFetch } from "../../lib/api"

export default function PdfView(props: { src: string; title: string }) {
	let url: string | undefined
	const [blob, { refetch }] = createResource(
		() => props.src,
		async (src) => {
			const res = await apiFetch(src)
			if (!res.ok) throw new Error(`The server said ${res.status}`)
			if (url) URL.revokeObjectURL(url)
			url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "application/pdf" }))
			return url
		},
	)
	onCleanup(() => url && URL.revokeObjectURL(url))
	return (
		<Switch fallback={<SurfaceLoading />}>
			<Match when={blob.error}>
				<SurfaceFailure message="Unable to load PDF." onRetry={() => void refetch()} />
			</Match>
			<Match when={blob()}>{(href) => <iframe class="min-h-0 flex-1 border-0 bg-white" src={`${href()}#view=FitH`} title={props.title} data-component="file-pdf" />}</Match>
		</Switch>
	)
}
