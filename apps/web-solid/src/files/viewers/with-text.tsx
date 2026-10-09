import type { FileRef } from "@yuki/protocol"
import { createResource, Match, Show, Switch, type JSX } from "solid-js"
import { PREVIEW_BYTES, readText } from "../api"
import { SurfaceFailure, SurfaceLoading, SurfaceNotice, UNREADABLE } from "../chrome"

/**
 * Reads a file's first 1 MB as text for a rendered view, and draws its loading, failure and cut
 * notice the way the source view does. The file's id keys the read, so a new version reads again.
 */
export function WithText(props: { roomId: string; file: FileRef; children: (text: string) => JSX.Element }) {
	const [read, { refetch }] = createResource(
		() => props.file.id,
		(id) => readText(props.roomId, id, PREVIEW_BYTES),
	)
	return (
		<Switch fallback={<SurfaceLoading />}>
			<Match when={read.error}>
				<SurfaceFailure message={read.error instanceof Error ? read.error.message : "This file did not load."} onRetry={() => void refetch()} />
			</Match>
			<Match when={read()} keyed>
				{(value) => {
					if (value.kind !== "text") return <SurfaceFailure message={UNREADABLE[value.kind]} />
					return (
						<>
							<Show when={value.truncated}>
								<SurfaceNotice>Preview limited to the first 1 MB of a {value.size.toLocaleString()} byte file.</SurfaceNotice>
							</Show>
							{props.children(value.text)}
						</>
					)
				}}
			</Match>
		</Switch>
	)
}
