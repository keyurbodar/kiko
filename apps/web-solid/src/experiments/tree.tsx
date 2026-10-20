import { For } from "solid-js";
import { render } from "solid-js/web";
import { createTree } from "@kiko/ui/v2/tree/create-tree";

const children = new Map<string, string[]>();
const names = new Map<string, string>();
const folders = new Set<string>();
children.set("root", []);
for (let a = 0; a < 10; a += 1) {
  const aId = `a${a}`;
  folders.add(aId);
  names.set(aId, `folder ${a}`);
  children.get("root")!.push(aId);
  children.set(aId, []);
  for (let b = 0; b < 9; b += 1) {
    const bId = `${aId}-b${b}`;
    folders.add(bId);
    names.set(bId, `folder ${a}.${b}`);
    children.get(aId)!.push(bId);
    children.set(bId, []);
    for (let c = 0; c < 10; c += 1) {
      const cId = `${bId}-c${c}`;
      names.set(cId, `file ${a}.${b}.${c}`);
      children.get(bId)!.push(cId);
    }
  }
}

function App() {
  const tree = createTree<string>({
    rootItemId: "root",
    getItem: (id) => names.get(id) ?? id,
    getChildren: (id) => children.get(id) ?? [],
    getItemName: (item) => item.getItemData(),
    isItemFolder: (item) => folders.has(item.getId()),
    selectionFollowsFocus: true,
  });
  (window as unknown as { tree: typeof tree }).tree = tree;
  document.getElementById("status")!.textContent = `${names.size} nodes`;
  return (
    <div {...tree.containerProps()}>
      <For each={tree.items()}>
        {(item) => (
          <div {...tree.itemProps(item)} style={{ "padding-left": `${item.getItemMeta().level * 16}px` }}>
            {folders.has(item.getId()) ? (tree.expanded().includes(item.getId()) ? "v " : "> ") : "  "}
            {item.getItemName()}
          </div>
        )}
      </For>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
