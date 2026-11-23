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
		JSON.stringify({
			counts: { essay: 1 },
			documents: [{ id: "writing/example", type: "essay" }],
		}),
	);
	await writeFile(
		join(root, "corpus/writing/example.json"),
		JSON.stringify({
			id: "writing/example",
			title: "Example",
			type: "essay",
			body_markdown: "Public text.",
		}),
	);
	await writeFile(
		join(root, "projects-data.json"),
		JSON.stringify({ public: true, curated: {}, archive: {} }),
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
	it.each(["document", "profile"])(
		"rejects a noncanonical %s reference before reading it",
		async (kind) => {
			const root = await fixture();
			const index =
				kind === "document" ? "corpus-index.json" : "repo-profiles/index.json";
			const data =
				kind === "document"
					? { documents: [{ id: "writing/./missing", type: "essay" }] }
					: {
							profiles: [
								{ repo_id: "missing", profile_json: "./missing.json" },
							],
						};
			await mkdir(join(root, "repo-profiles"));
			await writeFile(join(root, index), JSON.stringify(data));
			const result = run(root, join(root, "generated.ts"));
			expect(result.status).toBe(1);
			expect(result.stderr).toContain(`${index}: invalid artifact reference`);
			expect(result.stderr).not.toContain("ENOENT");
		},
	);
	const profiles = "calibration-profiles.json";
	const figures = "operant-figures.json";
	it.each([
		["missing figures", { [profiles]: { models: [] } }, figures],
		["missing profiles", { [figures]: {} }, profiles],
		["empty objects", { [profiles]: {}, [figures]: {} }, profiles],
		["invalid figures", { [profiles]: { models: [] }, [figures]: [] }, figures],
	])("rejects incomplete OPERANT data: %s", async (_case, files, invalid) => {
		const root = await fixture();
		const dir = join(root, "scripts/sources/operant");
		await mkdir(dir, { recursive: true });
		for (const [name, data] of Object.entries(files)) {
			await writeFile(join(dir, name), JSON.stringify(data));
		}
		const result = run(root, join(root, "generated.ts"));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`scripts/sources/operant/${invalid}:`);
	});

	it.each([false, null])(
		"rejects a present repo-profile index of %s",
		async (value) => {
			const root = await fixture();
			await mkdir(join(root, "repo-profiles"));
			await writeFile(
				join(root, "repo-profiles/index.json"),
				JSON.stringify(value),
			);
			const result = run(root, join(root, "generated.ts"));
			expect(result.status).toBe(1);
			expect(result.stderr).toContain(
				"repo-profiles/index.json: expected a profiles array",
			);
		},
	);
	it("rejects a count that contradicts the indexed documents", async () => {
		const root = await fixture();
		await writeFile(
			join(root, "corpus-index.json"),
			JSON.stringify({
				documents: [{ id: "writing/example", type: "essay" }],
				counts: { essay: 0 },
			}),
		);
		const result = run(root, join(root, "generated.ts"));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"corpus-index.json: expected essay count 1",
		);
	});
	it("rejects a document without a title", async () => {
		const root = await fixture();
		await writeFile(
			join(root, "corpus/writing/example.json"),
			JSON.stringify({
				id: "writing/example",
				type: "essay",
				body_markdown: "",
			}),
		);
		const result = run(root, join(root, "generated.ts"));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"corpus/writing/example.json: title must be a string",
		);
	});
	it("rejects projects without public consent", async () => {
		const root = await fixture();
		await writeFile(
			join(root, "projects-data.json"),
			JSON.stringify({ public: false, curated: {}, archive: {} }),
		);
		const result = run(root, join(root, "generated.ts"));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("projects-data.json: public must be true");
	});
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
