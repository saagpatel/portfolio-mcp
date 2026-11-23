import {
	mkdtemp,
	mkdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

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
			documents: [
				{ id: "writing/example", type: "essay", title: "Index title" },
			],
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
	it.each(["corpus", "corpus-other"])(
		"checks a local document symlink resolving into %s",
		async (directory) => {
			const root = await fixture();
			const document = join(root, "corpus/writing/example.json");
			const target = join(root, directory, "target.json");
			await mkdir(join(root, directory), { recursive: true });
			await rename(document, target);
			await symlink(target, document);
			const output = join(root, "generated.ts");
			const result = run(root, output);
			if (directory === "corpus") {
				expect(result.status).toBe(0);
				expect(await readFile(output, "utf8")).toContain("Public text.");
			} else {
				expect(result.status).toBe(1);
				expect(result.stderr).toContain(
					"corpus/writing/example.json: resolved path is outside corpus",
				);
				await expect(readFile(output)).rejects.toMatchObject({
					code: "ENOENT",
				});
			}
		},
	);
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
				documents: [{ id: "writing/example", type: "essay", title: "Example" }],
				counts: { essay: 0 },
			}),
		);
		const result = run(root, join(root, "generated.ts"));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"corpus-index.json: expected essay count 1",
		);
	});
	it.each([undefined, "", " \t "])(
		"rejects invalid index title %j even when the full document has one",
		async (title) => {
			const root = await fixture();
			const path = join(root, "corpus-index.json");
			const index = JSON.parse(await readFile(path, "utf8"));
			index.documents[0].title = title;
			await writeFile(path, JSON.stringify(index));
			const result = run(root, join(root, "generated.ts"));
			expect(result.status).toBe(1);
			expect(result.stderr).toContain(
				"corpus-index.json: document writing/example title must be a nonblank string",
			);
		},
	);
	it.each(["corpus/writing/example.json", "repo-profiles/example.json"])(
		"rejects an HTTP redirect for indexed artifact %s",
		async (redirected) => {
			const root = await fixture();
			await mkdir(join(root, "repo-profiles"));
			await writeFile(
				join(root, "repo-profiles/index.json"),
				JSON.stringify({
					profile_count: 1,
					profiles: [{ repo_id: "example", profile_json: "example.json" }],
				}),
			);
			await writeFile(
				join(root, "repo-profiles/example.json"),
				'{"repo_id":"example"}',
			);
			const base = "https://example.invalid/";
			vi.stubGlobal("fetch", async (url, options) => {
				const file = new URL(url).pathname.slice(1);
				if (file === redirected && options?.redirect === "error") {
					throw new TypeError("redirect rejected");
				}
				if (file === redirected && options?.redirect === "manual") {
					return Response.redirect(new URL("/elsewhere", base));
				}
				if (file.startsWith("scripts/"))
					return new Response(null, { status: 404 });
				return new Response(await readFile(join(root, file), "utf8"));
			});
			const argv = process.argv;
			try {
				process.argv = [
					argv[0],
					script,
					`--url=${base}`,
					`--out=${join(root, "generated.ts")}`,
				];
				vi.resetModules();
				await expect(import("../scripts/build-corpus.mjs")).rejects.toThrow(
					redirected,
				);
			} finally {
				process.argv = argv;
				vi.unstubAllGlobals();
			}
		},
	);
	it.each([undefined, "", " \t "])(
		"rejects invalid full document title %j",
		async (title) => {
			const root = await fixture();
			await writeFile(
				join(root, "corpus/writing/example.json"),
				JSON.stringify({
					id: "writing/example",
					type: "essay",
					title,
					body_markdown: "",
				}),
			);
			const result = run(root, join(root, "generated.ts"));
			expect(result.status).toBe(1);
			expect(result.stderr).toContain(
				"corpus/writing/example.json: title must be a nonblank string",
			);
		},
	);
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
	it("rejects a curated projects array before writing output", async () => {
		const root = await fixture();
		await writeFile(
			join(root, "projects-data.json"),
			JSON.stringify({ public: true, curated: [], archive: {} }),
		);
		const output = join(root, "generated.ts");
		const result = run(root, output);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"projects-data.json: expected curated projects",
		);
		await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
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
