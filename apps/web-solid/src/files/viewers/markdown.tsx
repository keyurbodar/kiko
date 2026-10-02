import type { FileRef } from "@kiko/protocol"
import { createResource, Show } from "solid-js"
// ASSUMPTION: a markdown file renders with the same parser the room uses for agent messages, so a
// file and a message that hold the same markdown look the same. The parser is pure (marked and
// the protocol types), and this chunk loads only when a markdown file opens, in tier 4.
import { parseRichText } from "../../../../server/src/room/rich-text"
import { RichText } from "../../chat/rich/RichText"
import { readFile } from "../api"

/** A markdown file, rendered. The file's id keys the fetch, so a new version renders again. */
export default function MarkdownView(props: { roomId: string; file: FileRef }) {
	const [tree] = createResource(
		() => props.file.id,
		async (id) => parseRichText((await readFile(props.roomId, id)).text),
	)
	return (
		<div class="fv-scroll" data-component="file-markdown">
			<Show when={tree()} fallback={<p class="fv-note">{tree.error ? "this file did not load" : "loading..."}</p>}>
				{(t) => <RichText tree={t()} class="fv-markdown" />}
			</Show>
		</div>
	)
}
