import type { FileRef } from "@yuki/protocol"
import { For, Show } from "solid-js"
import { SurfaceNotice } from "../chrome"
import { parseDelimited } from "../kind"
import { WithText } from "./with-text"

/** The table draws at most this many rows and columns, as t3code's does. Source shows the rest. */
const ROWS = 100
const COLUMNS = 30

/** A CSV or TSV file as a table. The first row is the header. */
export default function TableView(props: { roomId: string; file: FileRef }) {
	return (
		<WithText roomId={props.roomId} file={props.file}>
			{(text) => {
				const all = parseDelimited(text, /\.tsv$/i.test(props.file.name) ? "\t" : ",", ROWS + 2)
				const rows = all.slice(0, ROWS + 1).map((row) => row.slice(0, COLUMNS))
				const cut = all.length > ROWS + 1 || all.some((row) => row.length > COLUMNS)
				return (
					<div class="flex min-h-0 flex-1 flex-col" data-component="file-table">
						<Show when={cut}>
							<SurfaceNotice>Table limited to the first {ROWS} rows and {COLUMNS} columns. Switch to source for the rest.</SurfaceNotice>
						</Show>
						<div class="min-h-0 flex-1 overflow-auto">
							<table class="min-w-full border-separate border-spacing-0 text-xs">
								<thead class="sticky top-0 z-10">
									<tr>
										<For each={rows[0] ?? []}>
											{(cell) => <th class="max-w-80 border-b border-[var(--panel-edge)] bg-bg-subtle px-3 py-1.5 text-left align-bottom font-medium break-words whitespace-pre-wrap">{cell}</th>}
										</For>
									</tr>
								</thead>
								<tbody>
									<For each={rows.slice(1)}>
										{(row) => (
											<tr class="even:bg-hover">
												<For each={row}>
													{(cell) => <td class="max-w-80 border-b border-[var(--panel-edge)] px-3 py-1.5 align-top break-words whitespace-pre-wrap tabular-nums">{cell}</td>}
												</For>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</div>
					</div>
				)
			}}
		</WithText>
	)
}
