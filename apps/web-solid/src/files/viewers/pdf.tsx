import { createResource, onCleanup, Show } from "solid-js"

/*
 * A PDF in the browser's own viewer. The file route answers with `content-security-policy:
 * sandbox`, and Chrome will not run its PDF viewer in a sandboxed document, so the bytes are
 * fetched once and shown from a blob URL, which carries no such header.
 */
export default function PdfView(props: { src: string; title: string }) {
	let url: string | undefined
	const [blob] = createResource(
		() => props.src,
		async (src) => {
			const res = await fetch(src)
			if (!res.ok) throw new Error(`The server said ${res.status}`)
			if (url) URL.revokeObjectURL(url)
			url = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: "application/pdf" }))
			return url
		},
	)
	onCleanup(() => url && URL.revokeObjectURL(url))
	return (
		<Show when={blob()} fallback={<p class="fv-note">{blob.error ? "This file did not load" : "Loading..."}</p>}>
			{(href) => <iframe class="fv-frame" src={`${href()}#view=FitH`} title={props.title} data-component="file-pdf" />}
		</Show>
	)
}
