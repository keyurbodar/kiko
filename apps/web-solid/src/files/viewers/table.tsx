import type { FileRef } from "@kiko/protocol"
import { createResource, For, Show } from "solid-js"
import { readFile } from "../api"
import { parseDelimited } from "../kind"

const LIMIT = 1000

/** A CSV or TSV file as a table: the first row is the header, and only the first rows draw. */
export default function TableView(props: { roomId: string; file: FileRef }) {
	const [rows] = createResource(
		() => props.file.id,
		async (id) => {
			const { text } = await readFile(props.roomId, id)
			return parseDelimited(text, /\.tsv$/i.test(props.file.name) ? "\t" : ",", LIMIT + 1)
		},
	)
	return (
		<div class="fv-scroll fv-table-scroll" data-component="file-table">
			<Show when={rows()} fallback={<p class="fv-note">{rows.error ? "This file did not load" : "Loading..."}</p>}>
				{(all) => (
					<>
						<table class="fv-table">
							<thead>
								<tr>
									<For each={all()[0] ?? []}>{(cell) => <th>{cell}</th>}</For>
								</tr>
							</thead>
							<tbody>
								<For each={all().slice(1, LIMIT)}>
									{(row) => (
										<tr>
											<For each={row}>{(cell) => <td>{cell}</td>}</For>
										</tr>
									)}
								</For>
							</tbody>
						</table>
						<Show when={all().length > LIMIT}>
							<p class="fv-note">Showing the first {LIMIT} rows. Source shows all of it.</p>
						</Show>
					</>
				)}
			</Show>
		</div>
	)
}
