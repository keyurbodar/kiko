import { describe, expect, test } from "bun:test";
import { CHARM_NAMES, LEAF_NAMES, MOOD_NAMES, avatar } from "../src/index";
import { outline, type OutlineTraits } from "../src/outline";

const sample: OutlineTraits[] = [
  ...LEAF_NAMES.map((leaf) => ({ leaf })),
  ...MOOD_NAMES.map((mood) => ({ leaf: "camellia" as const, mood })),
  ...CHARM_NAMES.map((charm) => ({ leaf: "nandina" as const, charm, blush: true, mouth: true, facing: "left" as const })),
];

describe("outline", () => {
  test("paints nothing of its own, so the caller's ink and paper hold", () => {
    for (const t of sample) {
      expect(outline(t), JSON.stringify(t)).not.toMatch(/#[0-9a-f]{3}|opacity=|stroke-width=|stroke="(?!none")|fill="(?!none"|currentColor")/i);
    }
  });

  test("draws the avatar's silhouette", () => {
    const silhouette = avatar("kiko").match(/<clipPath id="[^"]+"><path d="([^"]+)"/)![1];
    for (const t of sample) expect(outline(t)).toContain(`<path d="${silhouette}"/>`);
  });

  test("keeps a charm's lines open and drops its white shine", () => {
    const plain = outline({ leaf: "nandina" });
    const added = outline({ leaf: "nandina", charm: "cherries" }).slice(plain.length - 4, -4);
    // Two cherries, without the two shines on them, and their stems unfilled.
    expect(added.match(/<circle/g)).toHaveLength(2);
    expect(added).toMatch(/<path d="M[^"]+Q[^"]+"[^>]* fill="none"\/>/);
  });
});
