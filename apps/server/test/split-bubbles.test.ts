import { describe, expect, test } from "vitest";
import { createSplitter, type Reaction } from "../src/agent/split-bubbles";

function run(text: string, size: number) {
	const s = createSplitter();
	const blocks: string[] = [];
	const reactions: Reaction[] = [];
	const drafts: string[] = [];
	const add = (o: ReturnType<typeof s.push>) => {
		blocks.push(...o.blocks);
		reactions.push(...o.reactions);
		if (o.draft) drafts.push(o.draft);
	};
	for (let i = 0; i < text.length; i += size) add(s.push(text.slice(i, i + size)));
	add(s.end());
	return { blocks, reactions, drafts };
}

describe("splitBubbles", () => {
	test("one turn is one bubble: blank lines are paragraph breaks, and runs of them collapse", () => {
		expect(run("\n\none\ntwo\n\nthree\n\n\n\nfour", 4096).blocks).toEqual(["one\ntwo\n\nthree\n\nfour"]);
	});

	test("keeps a blank line inside a code fence", () => {
		const text = "before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
		for (const size of [1, 7, 4096]) {
			expect(run(text, size).blocks).toEqual(["before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter"]);
		}
	});

	test("flushes an unterminated fence at the end", () => {
		expect(run("```\na\n\nb", 3).blocks).toEqual(["```\na\n\nb"]);
	});

	test("strips tags and emits reactions", () => {
		const r = run("nice [react:👍] work\n\n[react:🔥:m42] ok", 4096);
		expect(r.blocks).toEqual(["nice  work\n\n ok"]);
		expect(r.reactions).toEqual([{ emoji: "👍" }, { emoji: "🔥", messageId: "m42" }]);
	});

	test("a tag split across chunks is stripped, not leaked", () => {
		const s = createSplitter();
		const a = s.push("hi [rea");
		expect(a.blocks).toEqual([]);
		s.push("ct:👍");
		const c = s.push("]\n\nbye");
		expect(c.reactions).toEqual([{ emoji: "👍" }]);
		expect(c.blocks).toEqual([]);
		expect(s.end().blocks).toEqual(["hi \n\nbye"]);
	});

	test("held back text that is not a tag comes back", () => {
		const r = run("see [react: nope] and [reac and [x]", 5);
		expect(r.blocks).toEqual(["see [react: nope] and [reac and [x]"]);
		expect(r.reactions).toEqual([]);
		expect(run("ends with [react:", 3).blocks).toEqual(["ends with [react:"]);
	});

	test("a reply that is only a tag gives a reaction and no bubble", () => {
		for (const size of [1, 7, 4096]) {
			const r = run("[react:❤️]", size);
			expect(r.blocks).toEqual([]);
			expect(r.reactions).toEqual([{ emoji: "❤️" }]);
		}
	});

	test("tags inside a code fence are literal", () => {
		const r = run("```\n[react:👍]\n```", 2);
		expect(r.blocks).toEqual(["```\n[react:👍]\n```"]);
		expect(r.reactions).toEqual([]);
	});

	test("drafts appear after 400 characters while open", () => {
		const long = "x".repeat(401);
		const s = createSplitter();
		expect(s.push("x".repeat(400)).draft).toBeNull();
		expect(s.push("x").draft).toBe(long);
		expect(s.push("\n\nnext").draft).toBe(`${long}\n\nnext`);
		const done = s.end();
		expect(done.blocks).toEqual([`${long}\n\nnext`]);
		expect(done.draft).toBeNull();
	});

	test("chunk size does not change the result", () => {
		const text =
			"hello [react:👍] there\n\n```py\nx = 1\n\ny = 2\n```\n\n[react:🔥:abc]\n\n" +
			"long ".repeat(120) +
			"\n\nlast [react:👀]";
		const base = run(text, 4096);
		expect(base.blocks.length).toBe(1);
		for (const size of [1, 7]) {
			const r = run(text, size);
			expect(r.blocks).toEqual(base.blocks);
			expect(r.reactions).toEqual(base.reactions);
		}
	});
});

test("[skip] posts nothing, alone or around a reaction", () => {
  const blocks = (text: string) => {
    const s = createSplitter()
    return [...s.push(text).blocks, ...s.end().blocks]
  }
  expect(blocks("[skip]")).toEqual([])
  expect(blocks("[SKIP]\n")).toEqual([])
  expect(blocks("[react:👍]\n\n[skip]")).toEqual([])
  expect(blocks("i'd skip that one")).toEqual(["i'd skip that one"])
})
