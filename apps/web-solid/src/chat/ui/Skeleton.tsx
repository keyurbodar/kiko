import { For, Show } from "solid-js";
import type { SkeletonRowShape } from "../lib/skeletonGeometry";
import { skeletonRowOuterHeight } from "../lib/skeletonGeometry";

const LINE_WIDTH_PERCENT = [100, 92, 64, 78];

export function Skeleton(props: { rows: readonly SkeletonRowShape[] }) {
  const isRunEnd = (index: number) => props.rows[index + 1]?.isRunStart ?? true;

  return (
    <div class="chat-skeleton" data-component="chat-skeleton" aria-hidden="true">
      <For each={props.rows}>
        {(row, index) => (
          <div
            class="chat-skeleton__row"
            data-component="chat-skeleton-row"
            data-run-start={String(row.isRunStart)}
            data-run-end={String(isRunEnd(index()))}
            style={{
              height: `${skeletonRowOuterHeight(row.lineCount, row.isRunStart, isRunEnd(index()))}px`,
            }}
          >
            <Show when={row.isRunStart}>
              <div class="chat-skeleton__rail" data-component="chat-skeleton-rail" />
            </Show>
            <div class="chat-skeleton__cell" data-component="chat-skeleton-cell">
              <Show when={row.isRunStart}>
                <div class="chat-skeleton__header" data-component="chat-skeleton-header">
                  <span data-component="chat-skeleton-author" />
                  <span data-component="chat-skeleton-time" />
                </div>
              </Show>
              <div class="chat-skeleton__lines" data-component="chat-skeleton-lines">
                <For each={Array.from({ length: row.lineCount }, (_, line) => line)}>
                  {(line) => (
                    <span
                      data-component="chat-skeleton-line"
                      data-last={String(line === row.lineCount - 1)}
                      style={{ width: `${LINE_WIDTH_PERCENT[line] ?? 64}%` }}
                    />
                  )}
                </For>
              </div>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
