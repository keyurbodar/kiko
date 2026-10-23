import type { FileRef } from "@kiko/protocol"
import { For, Show } from "solid-js"
import { SurfaceNotice } from "../chrome"
import { CELL_LIMIT, parseDelimited } from "../delimited"
import { WithText } from "./with-text"

const ROWS = 100
const COLUMNS = 30

export default function TableView(props: { roomId: string; file: FileRef }) {
  return (
    <WithText roomId={props.roomId} file={props.file}>
      {(text) => {
        const parsed = parseDelimited(text, /\.tsv$/i.test(props.file.name) ? "\t" : ",", ROWS + 2)
        const rows = parsed.rows.slice(0, ROWS + 1).map((row) => row.slice(0, COLUMNS))
        const cut = parsed.cut || parsed.rows.length > ROWS + 1 || parsed.rows.some((row) => row.length > COLUMNS)
        return (
          <div class="flex min-h-0 flex-1 flex-col" data-component="file-table">
            <Show when={cut}>
              <SurfaceNotice>
                Table limited to the first {ROWS} rows, {COLUMNS} columns and {CELL_LIMIT.toLocaleString()} characters a
                cell. Switch to source for the rest.
              </SurfaceNotice>
            </Show>
            <div class="min-h-0 flex-1 overflow-auto">
              <table class="min-w-full border-separate border-spacing-0 text-xs">
                <thead class="sticky top-0 z-10">
                  <tr>
                    <For each={rows[0] ?? []}>
                      {(cell) => (
                        <th class="max-w-80 border-b border-[var(--border)] bg-card px-3 py-1.5 text-left align-bottom font-medium break-words whitespace-pre-wrap">
                          {cell}
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={rows.slice(1)}>
                    {(row) => (
                      <tr class="even:bg-accent">
                        <For each={row}>
                          {(cell) => (
                            <td class="max-w-80 border-b border-[var(--border)] px-3 py-1.5 align-top break-words whitespace-pre-wrap tabular-nums">
                              {cell}
                            </td>
                          )}
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
