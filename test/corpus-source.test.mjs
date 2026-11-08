// Rebuild-and-hash check, exercised offline with --source-dir so the test
// needs no network; CI runs the real fetch of the pinned commit.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/corpus-source.mjs");
const builder = resolve("scripts/build-corpus.mjs");
const temporaryDirs = [];

const PIN = {
	repository: "https://github.com/example/portfolio-index",
	commit: "0123456789abcdef0123456789abcdef01234567",
};

async function workspace() {
	const root = await mkdtemp(join(tmpdir(), "corpus-source-test-"));
	temporaryDirs.push(root);
	const source = join(root, "source");
	await mkdir(join(source, "corpus/writing"), { recursive: true });
	await writeFile(
		join(source, "corpus-index.json"),
		JSON.stringify({ documents: [{ id: "writing/example", type: "essay" }] }),
	);
	await writeFile(
		join(source, "corpus/writing/example.json"),
		JSON.stringify({
			id: "writing/example",
			type: "essay",
			body_markdown: "Public text.",
		}),
	);
	await writeFile(
		join(source, "projects-data.json"),
		JSON.stringify({ curated: {}, archive: {} }),
	);
	const pin = join(root, "corpus.source.json");
	await writeFile(pin, JSON.stringify(PIN));
	const corpus = join(root, "corpus.generated.ts");
	return { root, source, pin, corpus };
}

function corpusSource(ws, ...extra) {
	return spawnSync(
		process.execPath,
		[
			script,
			`--pin=${ws.pin}`,
			`--corpus=${ws.corpus}`,
			`--source-dir=${ws.source}`,
			...extra,
		],
		{ encoding: "utf8" },
	);
}

function bake(ws) {
	const result = spawnSync(
		process.execPath,
		[builder, `--dir=${ws.source}`, `--out=${ws.corpus}`],
		{ encoding: "utf8" },
	);
	expect(result.status).toBe(0);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirs
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("corpus-source rebuild-and-hash check", () => {
	it("passes when the committed corpus is byte-identical to a rebuild", async () => {
		const ws = await workspace();
		bake(ws);
		const result = corpusSource(ws, "--check");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("matches the rebuild byte for byte");
	});

	it("fails on any difference, including a hand edit", async () => {
		const ws = await workspace();
		bake(ws);
		const committed = await readFile(ws.corpus, "utf8");
		await writeFile(ws.corpus, committed.replace("Public text.", "Edited."));
		const result = corpusSource(ws, "--check");
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("does not match a rebuild");
	});

	it("fails when the source moved but the corpus was not re-baked", async () => {
		const ws = await workspace();
		bake(ws);
		await writeFile(
			join(ws.source, "corpus/writing/example.json"),
			JSON.stringify({
				id: "writing/example",
				type: "essay",
				body_markdown: "Newer public text.",
			}),
		);
		expect(corpusSource(ws, "--check").status).toBe(1);
	});

	it("re-bakes the committed file with --write", async () => {
		const ws = await workspace();
		await writeFile(ws.corpus, "stale");
		expect(corpusSource(ws, "--write").status).toBe(0);
		expect(corpusSource(ws, "--check").status).toBe(0);
		expect(await readFile(ws.corpus, "utf8")).toContain("Public text.");
	});

	it("rejects a pin that is not a full commit SHA on github.com", async () => {
		const ws = await workspace();
		bake(ws);
		for (const pin of [
			{ ...PIN, commit: "main" },
			{ ...PIN, commit: "0123456" },
			{ ...PIN, repository: "https://example.com/portfolio-index" },
		]) {
			await writeFile(ws.pin, JSON.stringify(pin));
			const result = corpusSource(ws, "--check");
			expect(result.status).toBe(1);
			expect(result.stderr).toContain(ws.pin);
		}
	});

	it("pins the real corpus to a full portfolio-index commit", async () => {
		const pin = JSON.parse(
			await readFile(resolve("corpus.source.json"), "utf8"),
		);
		expect(pin.repository).toBe("https://github.com/saagpatel/portfolio-index");
		expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
	});
});
