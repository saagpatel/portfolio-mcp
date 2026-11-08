// Re-bake summary: what changed between two generated corpus files.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGenerated, render, summarize } from "../scripts/corpus-diff.mjs";

const script = resolve("scripts/corpus-diff.mjs");
const builder = resolve("scripts/build-corpus.mjs");
const temporaryDirs = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirs
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function tempDir() {
	const dir = await mkdtemp(join(tmpdir(), "corpus-diff-test-"));
	temporaryDirs.push(dir);
	return dir;
}

/** Bake a corpus with the real generator from fixture documents. */
async function bake(dir, documents) {
	const source = join(dir, "source");
	await mkdir(join(source, "corpus/writing"), { recursive: true });
	await writeFile(
		join(source, "corpus-index.json"),
		JSON.stringify({
			documents: documents.map(({ id, type, title }) => ({ id, type, title })),
		}),
	);
	for (const doc of documents) {
		await writeFile(join(source, `corpus/${doc.id}.json`), JSON.stringify(doc));
	}
	await writeFile(
		join(source, "projects-data.json"),
		JSON.stringify({ curated: {}, archive: {} }),
	);
	const out = join(dir, "corpus.generated.ts");
	const result = spawnSync(
		process.execPath,
		[builder, `--dir=${source}`, `--out=${out}`],
		{ encoding: "utf8" },
	);
	expect(result.status).toBe(0);
	return out;
}

const doc = (id, fields = {}) => ({
	id,
	slug: id.split("/").pop(),
	type: "essay",
	title: `Title of ${id}`,
	date: "2026-10-01",
	word_count: 100,
	body_markdown: "Public text.",
	...fields,
});

const corpus = (documents, extra = {}) => ({
	index: {
		site: "https://example.test",
		title: "Example",
		summary: "",
		generated: "2026-10-01",
		counts: { essay: documents.length },
		documents: documents.map(({ body_markdown, ...record }) => record),
	},
	documents: Object.fromEntries(documents.map((d) => [d.id, d])),
	projects: {
		generated_at: "",
		source_schema_version: "1",
		public: true,
		curated: {},
		archive: {},
	},
	...extra,
});

describe("corpus-diff re-bake summary", () => {
	it("summarizes a real re-bake from the generator's own output", async () => {
		const before = await bake(await tempDir(), [
			doc("writing/kept"),
			doc("writing/edited"),
			doc("writing/dropped"),
		]);
		const after = await bake(await tempDir(), [
			doc("writing/kept"),
			doc("writing/edited", {
				word_count: 140,
				body_markdown: "Longer public text.",
			}),
			doc("writing/new"),
		]);
		const result = spawnSync(process.execPath, [script, before, after], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			"### Documents (1 added, 1 removed, 1 changed)",
		);
		expect(result.stdout).toContain(
			"- added `writing/new` Title of writing/new",
		);
		expect(result.stdout).toContain("- removed `writing/dropped`");
		expect(result.stdout).toContain(
			"- changed `writing/edited` Title of writing/edited: `word_count` 100 → 140, `body_markdown`",
		);
		expect(result.stdout).not.toContain("writing/kept");
	});

	it("says so when nothing changed", async () => {
		const same = corpus([doc("writing/a")]);
		const summary = summarize(same, structuredClone(same));
		expect(summary.sections).toEqual([]);
		expect(render(summary)).toContain("No content change.");
	});

	it("reports index counts and optional sections appearing", () => {
		const before = corpus([doc("writing/a")]);
		const after = corpus([doc("writing/a"), doc("writing/b")], {
			operant: { profiles: { models: [] }, figures: { demo: { n: 1 } } },
		});
		const out = render(summarize(before, after));
		expect(out).toContain("- changed `counts`: `essay` 1 → 2");
		expect(out).toContain(
			"### OPERANT figures (1 added, 0 removed, 0 changed)",
		);
		expect(out).toContain("- added `demo`");
		// The index's document list mirrors documents; it is not reported twice.
		expect(out).not.toContain("- changed `documents`");
	});

	it("names a changed OPERANT figure so a re-bake that reshapes it is visible", () => {
		const figures = { demo: { scenarios: [1, 2] }, labels: { a: "A" } };
		const before = corpus([], { operant: { profiles: {}, figures } });
		const after = corpus([], {
			operant: {
				profiles: {},
				figures: { ...figures, demo: { scenes: [1, 2] } },
			},
		});
		expect(render(summarize(before, after))).toContain(
			"- changed `demo`: `scenarios`, `scenes`",
		);
	});

	it("renders source text as plain text, not Markdown or HTML", () => {
		const before = corpus([]);
		const after = corpus([
			doc("writing/x", { title: "<img src=x> **bold**\n| [link](u)" }),
		]);
		const out = render(summarize(before, after));
		expect(out).toContain("\\<img src=x\\> \\*\\*bold\\*\\* \\| \\[link\\](u)");
		expect(out).not.toMatch(/(^|[^\\])<img/m);
	});

	it("caps a long section and counts the rest", () => {
		const many = Array.from({ length: 45 }, (_, n) => doc(`writing/d${n}`));
		const out = render(summarize(corpus([]), corpus(many)));
		expect(out).toContain("### Documents (45 added, 0 removed, 0 changed)");
		expect(out).toContain("- …and 5 more");
		expect(out.match(/^- added /gm)).toHaveLength(40);
	});

	it("parses only generated corpus files", () => {
		expect(() => parseGenerated("export default {};\n")).toThrow(
			"not a generated corpus file",
		);
	});

	it("exits 1 when a file cannot be read", async () => {
		const dir = await tempDir();
		const result = spawnSync(
			process.execPath,
			[script, join(dir, "missing.ts"), join(dir, "missing.ts")],
			{ encoding: "utf8" },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("corpus-diff:");
	});
});
