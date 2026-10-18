import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [join(import.meta.dir, ".."), join(import.meta.dir, "../../../../packages/ui/src")];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|tsx)$/.test(name) ? [path] : [];
  });
}

const sources = roots.flatMap(files).map((path) => ({ path, text: readFileSync(path, "utf8") }));

// A mouse click focuses a text field without :focus-visible being a keyboard signal, so a ring or
// border painted on :focus or :focus-within shows on every click.
test("no stylesheet paints a border, ring, or shadow on :focus or :focus-within", () => {
  const bad: string[] = [];
  for (const { path, text } of sources.filter((s) => s.path.endsWith(".css"))) {
    for (const rule of text.matchAll(/([^{}]*:focus(?:-within)?(?![-\w])[^{}]*)\{([^}]*)\}/g)) {
      if (/border|box-shadow|outline\s*:\s*[^n;\s]/.test(rule[2]!)) bad.push(`${path}: ${rule[1]!.trim()}`);
    }
  }
  expect(bad).toEqual([]);
});

test("no class paints a border, ring, or shadow on focus-within or plain focus", () => {
  const bad: string[] = [];
  for (const { path, text } of sources.filter((s) => s.path.endsWith(".tsx"))) {
    for (const m of text.matchAll(/(?<![-\w])(?:focus|focus-within):(?:border|ring|shadow|outline)[^\s"'`]*/g)) bad.push(`${path}: ${m[0]}`);
  }
  expect(bad).toEqual([]);
});

test("a text field never shows a ring: its caret is the focus", () => {
  for (const file of ["../index.css", "../settings/kit.css"]) {
    const css = readFileSync(join(import.meta.dir, file), "utf8");
    expect(css).not.toMatch(/:is\(input, textarea, select\)[^{]*:focus-visible/);
    expect(css).not.toContain(".kit-field:focus-visible");
  }
});
