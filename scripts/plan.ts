import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PHASES_DIR = join(ROOT, "docs/phases");
const ISSUES_DIR = join(ROOT, "issues");
const TSV_PATH = join(ROOT, "tasks.tsv");

const AREAS = ["backend", "frontend", "infra", "docs"] as const;
type Area = (typeof AREAS)[number];

type Task = {
	id: string;
	phase: number;
	title: string;
	deps: string[];
	difficulty: number;
	area: Area;
	parallel: boolean;
	worktree: boolean;
	human: boolean;
	verification: string;
	body: string;
	source: string;
	wave: number;
};

const errors: string[] = [];
const fail = (message: string) => errors.push(message);

function parsePhaseFile(path: string): Task[] {
	const source = relative(ROOT, path);
	const lines = readFileSync(path, "utf8").split("\n");
	const tasks: Task[] = [];
	let index = 0;
	while (index < lines.length) {
		const heading = /^### (P(\d+)-\d{2}) (.+)$/.exec(lines[index]);
		if (!heading) {
			index++;
			continue;
		}
		const [, id, phase, title] = heading;
		let end = index + 1;
		while (end < lines.length && !/^#{2,3} /.test(lines[end])) end++;
		const block = lines.slice(index + 1, end);
		index = end;

		const metaLine = block.find((line) => line.startsWith("`deps:"));
		const verifyLine = block.find((line) => line.startsWith("**Verify.**"));
		if (!metaLine) fail(`${id}: missing the meta line that starts with \`deps:`);
		if (!verifyLine) fail(`${id}: missing the **Verify.** line`);
		const meta = new Map<string, string>();
		for (const match of (metaLine ?? "").matchAll(/`(\w+): ([^`]*)`/g)) meta.set(match[1], match[2].trim());

		const deps = (meta.get("deps") ?? "none") === "none" ? [] : meta.get("deps")!.split(/,\s*/);
		const difficulty = Number(meta.get("difficulty"));
		const area = meta.get("area") as Area;
		const parallel = (meta.get("parallel") ?? "yes") === "yes";
		const worktree = (meta.get("worktree") ?? (parallel ? "yes" : "no")) === "yes";
		if (!(difficulty >= 1 && difficulty <= 5)) fail(`${id}: difficulty must be 1 to 5`);
		if (!AREAS.includes(area)) fail(`${id}: area must be one of ${AREAS.join(", ")}`);
		if (!source.includes(`/${phase.padStart(2, "0")}-`)) fail(`${id}: lives in ${source}, which is another phase`);

		const body = block
			.filter((line) => line !== metaLine && line !== verifyLine)
			.join("\n")
			.trim();
		tasks.push({
			id,
			phase: Number(phase),
			title,
			deps,
			difficulty,
			area,
			parallel,
			worktree,
			human: meta.get("human") === "yes",
			verification: (verifyLine ?? "").replace("**Verify.**", "").trim(),
			body,
			source,
			wave: -1,
		});
	}
	return tasks;
}

function assignWaves(tasks: Task[]) {
	const byId = new Map(tasks.map((task) => [task.id, task]));
	if (byId.size !== tasks.length) fail("duplicate task ids");
	const visiting = new Set<string>();
	const waveOf = (task: Task): number => {
		if (task.wave >= 0) return task.wave;
		if (visiting.has(task.id)) {
			fail(`${task.id}: dependency cycle`);
			return 0;
		}
		visiting.add(task.id);
		let wave = 0;
		for (const dep of task.deps) {
			const parent = byId.get(dep);
			if (!parent) fail(`${task.id}: unknown dependency ${dep}`);
			else wave = Math.max(wave, waveOf(parent) + 1);
		}
		visiting.delete(task.id);
		task.wave = wave;
		return wave;
	};
	tasks.forEach(waveOf);
}

const slug = (title: string) =>
	title
		.toLowerCase()
		.replace(/`/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.split("-")
		.slice(0, 7)
		.join("-");
const branch = (task: Task) => `kiko/${task.id.toLowerCase()}-${slug(task.title)}`;
const waveDir = (wave: number) => `wave-${String(wave).padStart(2, "0")}`;
const issuePath = (task: Task) => `issues/${waveDir(task.wave)}/${task.id}-${slug(task.title)}.md`;
const yesNo = (value: boolean) => (value ? "yes" : "no");

function renderIssue(task: Task): string {
	return `# ${task.id} ${task.title}

| Field | Value |
| --- | --- |
| Phase | ${task.phase} (\`${task.source}\`) |
| Wave | ${task.wave} |
| Depends on | ${task.deps.join(", ") || "none"} |
| Difficulty | ${task.difficulty} of 5 |
| Area | ${task.area} |
| Parallel with its wave | ${yesNo(task.parallel)} |
| Needs a worktree | ${yesNo(task.worktree)} |
| Needs a human step | ${yesNo(task.human)} |
| Branch | \`${branch(task)}\` |

## Verification

${task.verification}

## Task

${task.body}

## Rules for this task

- Read \`AGENTS.md\` first. One task is one session and one pull request.
- Start only when every task in "Depends on" is merged.
- Stay inside the files this task names. If the task needs a file that another open task owns, stop and say so.
- The task is done when the verification above passes and you have shown its output.

This file is generated from \`${task.source}\` by \`bun scripts/plan.ts\`. Edit the phase file, not this file.
`;
}

function renderTsv(tasks: Task[]): string {
	const header = [
		"id",
		"phase",
		"wave",
		"title",
		"depends_on",
		"parallel_ok",
		"needs_worktree",
		"branch_name",
		"difficulty",
		"area",
		"verification",
		"needs_human",
		"issue",
	];
	const rows = tasks.map((task) =>
		[
			task.id,
			task.phase,
			task.wave,
			task.title,
			task.deps.join(","),
			yesNo(task.parallel),
			yesNo(task.worktree),
			branch(task),
			task.difficulty,
			task.area,
			task.verification.replace(/\s+/g, " "),
			yesNo(task.human),
			issuePath(task),
		].join("\t"),
	);
	return [header.join("\t"), ...rows].join("\n") + "\n";
}

function renderIndex(tasks: Task[]): string {
	const waves = [...new Set(tasks.map((task) => task.wave))].sort((a, b) => a - b);
	const sections = waves.map((wave) => {
		const rows = tasks
			.filter((task) => task.wave === wave)
			.map(
				(task) =>
					`| [${task.id}](${relative("issues", issuePath(task))}) | ${task.title} | ${task.area} | ${task.difficulty} | ${task.deps.join(", ") || "none"} | ${yesNo(task.parallel)} |`,
			);
		return `## Wave ${wave}\n\n| Task | Title | Area | Difficulty | Depends on | Parallel |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
	});
	return `# Issues by wave

Every task in a wave can start once all earlier waves it depends on are merged. Tasks in one wave run at the same time in separate worktrees, except the ones marked "Parallel: no", which run first and alone.

${tasks.length} tasks in ${waves.length} waves. This tree is generated from \`docs/phases/\` by \`bun scripts/plan.ts\`.

${sections.join("\n")}`;
}

const tasks = readdirSync(PHASES_DIR)
	.filter((name) => /^\d{2}-.+\.md$/.test(name))
	.sort()
	.flatMap((name) => parsePhaseFile(join(PHASES_DIR, name)));
assignWaves(tasks);
tasks.sort((a, b) => a.wave - b.wave || a.id.localeCompare(b.id));

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}

const outputs = new Map<string, string>([
	[TSV_PATH, renderTsv(tasks)],
	[join(ISSUES_DIR, "README.md"), renderIndex(tasks)],
	...tasks.map((task) => [join(ROOT, issuePath(task)), renderIssue(task)] as [string, string]),
]);

if (process.argv.includes("--check")) {
	const stale = [...outputs].filter(([path, content]) => !existsSync(path) || readFileSync(path, "utf8") !== content);
	if (stale.length > 0) {
		console.error(`out of date, run bun scripts/plan.ts:\n${stale.map(([path]) => relative(ROOT, path)).join("\n")}`);
		process.exit(1);
	}
	console.log(`plan is in sync: ${tasks.length} tasks`);
} else {
	rmSync(ISSUES_DIR, { recursive: true, force: true });
	for (const [path, content] of outputs) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	const perWave = new Map<number, number>();
	for (const task of tasks) perWave.set(task.wave, (perWave.get(task.wave) ?? 0) + 1);
	console.log(`wrote ${tasks.length} tasks: ${[...perWave].map(([wave, count]) => `wave ${wave} has ${count}`).join(", ")}`);
}
