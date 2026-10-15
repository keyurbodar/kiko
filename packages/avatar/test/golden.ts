import { render } from "../src/render";
import { resolve } from "../src/traits";

export function goldenLines(): string[] {
  const lines: string[] = [];
  for (let i = 0; i < 400; i++) {
    const name = `user${i}@kiko.dev`;
    const y = resolve(name);
    lines.push(`${name} ${y.flavour} ${y.leaf} ${y.eye} ${y.charm ?? "-"} ${y.outfit ?? "-"} ${y.pattern ?? "-"} ${y.facing} ${Bun.hash(render(y)).toString(36)}`);
  }
  return lines;
}
