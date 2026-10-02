import type { Component, JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

import AddRegular from "@mingcute/solid/core-regular/add";
import Chat1Filled from "@mingcute/solid/core-filled/chat-1";
import Chat1Regular from "@mingcute/solid/core-regular/chat-1";
import LayoutLeftFilled from "@mingcute/solid/core-filled/layout-left";
import LayoutLeftRegular from "@mingcute/solid/core-regular/layout-left";
import FolderFilled from "@mingcute/solid/core-filled/folder";
import FolderRegular from "@mingcute/solid/core-regular/folder";
import Settings3Filled from "@mingcute/solid/core-filled/settings-3";
import Settings3Regular from "@mingcute/solid/core-regular/settings-3";

/** The panels above settings, in rail order. */
export type PanelId = "chat" | "files";

/** Mirrors `--rail-icon`; the rail tab sizes its `svg` to this. */
const RAIL_ICON = 22;

type Glyph = Component<{ size?: number | string }>;

/**
 * kat swaps weight by panel state: the open panel renders the FILLED glyph,
 * every closed panel renders the REGULAR one.
 */
const PANEL_GLYPHS: Record<PanelId, { filled: Glyph; regular: Glyph }> = {
  chat: { filled: Chat1Filled, regular: Chat1Regular },
  files: { filled: FolderFilled, regular: FolderRegular },
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

/** The sidebar toggle: filled while the column is open, regular while shut. */
export function SidebarPanelIcon(props: { open?: boolean }): JSX.Element {
  return (
    <Dynamic
      component={props.open ? LayoutLeftFilled : LayoutLeftRegular}
      size={RAIL_ICON}
    />
  );
}
