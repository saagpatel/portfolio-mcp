import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/build-corpus.mjs");
const temporaryDirs = [];

async function fixture() {
	const root = await mkdtemp(join(resolve("."), ".portfolio-corpus-test-"));
	temporaryDirs.push(root);
	await mkdir(join(root, "corpus/writing"), { recursive: true });
	await writeFile(
		join(root, "corpus-index.json"),
		JSON.stringify({ documents: [{ id: "writing/example", type: "essay" }] }),
	);
	await writeFile(
		join(root, "corpus/writing/example.json"),
		JSON.stringify({
			id: "writing/example",
			type: "essay",
			body_markdown: "Public text.",
		}),
	);
	await writeFile(
		join(root, "projects-data.json"),
		JSON.stringify({ curated: {}, archive: {} }),
	);
	return root;
}

function run(root, output) {
	return spawnSync(
		process.execPath,
		[script, `--dir=${root}`, `--out=${output}`],
		{ encoding: "utf8" },
	);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirs
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("build-corpus", () => {
	it("reports malformed optional JSON instead of treating it as absent", async () => {
		const root = await fixture();
		const output = join(root, "generated.ts");
		await mkdir(join(root, "repo-profiles"));
		await writeFile(join(root, "repo-profiles/index.json"), "{");

		const result = run(root, output);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("repo-profiles/index.json");
		expect(result.stderr).toContain("JSON");
	});

	it("allows a missing optional dataset", async () => {
		const root = await fixture();
		const output = join(root, "generated.ts");

		const result = run(root, output);
		expect(result.status).toBe(0);
		expect(await readFile(output, "utf8")).toContain('"operant":null');
	});

	it("preserves the previous output when validation fails", async () => {
		const root = await fixture();
		const output = join(root, "generated.ts");
		await writeFile(output, "previous generated output\n");
		await writeFile(
			join(root, "corpus/writing/example.json"),
			JSON.stringify({
				id: "wrong/id",
				type: "essay",
				body_markdown: "Public text.",
			}),
		);

		const result = run(root, output);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("document id does not match index");
		expect(await readFile(output, "utf8")).toBe("previous generated output\n");
	});
});
