import {
  createTree as createCoreTree,
  hotkeysCoreFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type ItemInstance,
  type TreeInstance,
  type TreeState,
} from "@headless-tree/core";
import { batch, createComputed, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

export interface CreateTreeOptions<T> {
  rootItemId: string;
  getItemName: (item: ItemInstance<T>) => string;
  isItemFolder: (item: ItemInstance<T>) => boolean;
  getItem: (id: string) => T;
  getChildren: (id: string) => string[];
  /** Arrow keys move the selection together with focus. */
  selectionFollowsFocus?: boolean;
  initialExpanded?: string[];
}

export interface SolidTree<T> {
  /** The visible rows, in order. Re-evaluates when expansion changes. */
  items: Accessor<ItemInstance<T>[]>;
  expanded: Accessor<string[]>;
  focused: Accessor<string | null>;
  selected: Accessor<string[]>;
  /** Props for one row. Reactive: tracks every state change. */
  itemProps: (item: ItemInstance<T>) => Record<string, unknown>;
  /** Props for the container. Pass as a spread. */
  containerProps: () => Record<string, unknown>;
  core: TreeInstance<T>;
}

export function createTree<T>(options: CreateTreeOptions<T>): SolidTree<T> {
  const [state, setState] = createSignal<TreeState<T>>(
    { expandedItems: options.initialExpanded ?? [], focusedItem: null, selectedItems: [] } as unknown as TreeState<T>,
    { equals: false },
  );

  const core = createCoreTree<T>({
    rootItemId: options.rootItemId,
    getItemName: options.getItemName,
    isItemFolder: options.isItemFolder,
    dataLoader: {
      getItem: options.getItem,
      getChildren: options.getChildren,
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
    state: state(),
    setState: (updater) => {
      const prev = state();
      const next = (typeof updater === "function" ? updater(prev) : updater) as TreeState<T>;
      batch(() => {
        setState({ ...prev, ...next });
        if (options.selectionFollowsFocus && next.focusedItem && next.focusedItem !== prev.focusedItem) {
          setState((s) => ({ ...s, selectedItems: [next.focusedItem as string] }));
        }
      });
    },
  });

  createComputed(() => {
    const s = state();
    core.setConfig((prev) => ({ ...prev, state: s }));
  });

  const items = createMemo(() => {
    state();
    return [...core.getItems()];
  });

  onCleanup(() => core.registerElement(null));

  const containerProps = () => {
    const props = core.getContainerProps();
    const { ref } = props as { ref: (el: HTMLElement | null) => void };
    return {
      ...props,
      ref: (el: HTMLElement | null) => {
        ref(el);
        if (!el) return;
        core.setMounted(true);
        core.rebuildTree();
      },
    };
  };

  return {
    items,
    expanded: () => state().expandedItems,
    focused: () => state().focusedItem,
    selected: () => state().selectedItems,
    itemProps: (item) => {
      state();
      return item.getProps();
    },
    containerProps,
    core,
  };
}
