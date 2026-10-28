import { For, type JSX } from "solid-js"

const ROW = 28
const TRUNK_X = 12.5
const BEND = 9
const MID = 14
const BRANCH_END = 28
const INDENT = 20
const GUTTER = TRUNK_X + (BRANCH_END - TRUNK_X) + (32 - BRANCH_END)

const branchGutter = (depth: number) => GUTTER + depth * INDENT

function elbow(x: number, end: number): string {
  const start = MID - BEND
  return `M ${x} ${start} Q ${x} ${MID} ${x + BEND} ${MID} H ${end}`
}

function trunk(x: number): string {
  return `M ${x} 0 V ${MID - BEND}`
}

export function Branch(props: {
  depth: number
  liveTrunk: boolean
  liveBranch: boolean
  failed: boolean
  fresh: boolean
}): JSX.Element {
  const x = () => TRUNK_X + props.depth * INDENT
  const end = () => BRANCH_END + props.depth * INDENT
  const guides = () => Array.from({ length: props.depth }, (_, i) => TRUNK_X + i * INDENT)
  return (
    <svg
      class="run-tree-branch"
      data-fresh={props.fresh ? "" : undefined}
      width={branchGutter(props.depth)}
      height={ROW}
      viewBox={`0 0 ${branchGutter(props.depth)} ${ROW}`}
      aria-hidden="true"
    >
      <For each={guides()}>
        {(guide) => (
          <path
            d={`M ${guide} 0 V ${ROW}`}
            pathLength="1"
            class="run-tree-branch-line"
            data-part="guide"
            data-live={props.liveTrunk ? "" : undefined}
            data-failed={props.failed ? "" : undefined}
          />
        )}
      </For>
      <path
        d={trunk(x())}
        pathLength="1"
        class="run-tree-branch-line"
        data-part="incoming"
        data-live={props.liveTrunk ? "" : undefined}
        data-failed={props.failed ? "" : undefined}
      />
      <path
        d={elbow(x(), end())}
        pathLength="1"
        class="run-tree-branch-line"
        data-part="branch"
        data-live={props.liveBranch ? "" : undefined}
        data-failed={props.failed ? "" : undefined}
      />
    </svg>
  )
}
