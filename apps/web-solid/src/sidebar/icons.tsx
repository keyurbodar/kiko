import type { Component, JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

import AddRegular from "@mingcute/solid/core-regular/add";
import Chat1Filled from "@mingcute/solid/core-filled/chat-1";
import Chat1Regular from "@mingcute/solid/core-regular/chat-1";
import CodeFilled from "@mingcute/solid/core-filled/code";
import CodeRegular from "@mingcute/solid/core-regular/code";
import GlobeFilled from "@mingcute/solid/core-filled/globe";
import GlobeRegular from "@mingcute/solid/core-regular/globe";
import Settings3Filled from "@mingcute/solid/core-filled/settings-3";
import Settings3Regular from "@mingcute/solid/core-regular/settings-3";
import TerminalBoxFilled from "@mingcute/solid/core-filled/terminal-box";
import TerminalBoxRegular from "@mingcute/solid/core-regular/terminal-box";

/** The four panels, in rail order. */
export type PanelId = "chats" | "terminal" | "code" | "browser";

/** Mirrors `--rail-icon`; the rail tab sizes its `svg` to this. */
const RAIL_ICON = 22;

type Glyph = Component<{ size?: number | string }>;

/**
 * kat swaps weight by panel state: the open panel renders the FILLED glyph,
 * every closed panel renders the REGULAR one.
 */
const PANEL_GLYPHS: Record<PanelId, { filled: Glyph; regular: Glyph }> = {
  chats: { filled: Chat1Filled, regular: Chat1Regular },
  terminal: { filled: TerminalBoxFilled, regular: TerminalBoxRegular },
  code: { filled: CodeFilled, regular: CodeRegular },
  browser: { filled: GlobeFilled, regular: GlobeRegular },
};

export function RailIcon(props: {
  panel: PanelId;
  active?: boolean;
}): JSX.Element {
  return (
    <Dynamic
      component={PANEL_GLYPHS[props.panel][props.active ? "filled" : "regular"]}
      size={RAIL_ICON}
    />
  );
}

export function SettingsIcon(props: { active?: boolean }): JSX.Element {
  return (
    <Dynamic
      component={props.active ? Settings3Filled : Settings3Regular}
      size={RAIL_ICON}
    />
  );
}

export function PlusIcon(): JSX.Element {
  return <AddRegular size={RAIL_ICON} />;
}