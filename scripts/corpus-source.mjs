#!/usr/bin/env node
// Rebuild-and-hash check for the generated corpus.
//
// src/corpus.generated.ts is baked by scripts/build-corpus.mjs from the
// portfolio-index commit pinned in corpus.source.json. This script fetches that
// commit, re-bakes it with the committed generator, and compares SHA-256 hashes:
//
//   node scripts/corpus-source.mjs --check   # fail unless byte-identical (CI)
//   node scripts/corpus-source.mjs --write   # re-bake the committed file
//
// --source-dir=<dir> uses a local portfolio-index tree instead of fetching (the
// pinned commit is then not verified); --pin and --corpus override the default
// paths. Generated corpus PRs land on this check, not on a two-key review: the
// file is too large for a reviewer's diff, and the check proves it is exactly
// what the reviewed generator makes from the pinned source.
//
// portfolio-index is a private repository (its built artifacts are the public
// corpus), so fetching it needs a read-only token in PORTFOLIO_INDEX_TOKEN. The
// token reaches git through GIT_CONFIG_* environment variables, never through
// arguments, so it cannot appear in a logged command line.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) =>
	args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const mode = args.includes("--write") ? "write" : "check";
const pinPath = resolve(option("--pin") ?? join(root, "corpus.source.json"));
const corpusPath = resolve(
	option("--corpus") ?? join(root, "src/corpus.generated.ts"),
);
const sourceDirArg = option("--source-dir");

const COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;

function fail(message) {
	console.error(`corpus-source: ${message}`);
	process.exit(1);
}

function run(command, commandArgs, options = {}, hint = "") {
	const result = spawnSync(command, commandArgs, {
		encoding: "utf8",
		...options,
	});
	if (result.status !== 0) {
		fail(
			`${command} ${commandArgs.join(" ")} failed:\n${result.stderr || result.stdout}${hint}`,
		);
	}
	return result.stdout;
}

async function readPin() {
	let pin;
	try {
		pin = JSON.parse(await readFile(pinPath, "utf8"));
	} catch (error) {
		fail(`cannot read ${pinPath}: ${error.message}`);
	}
	if (typeof pin?.repository !== "string" || !REPOSITORY.test(pin.repository)) {
		fail(
			`${pinPath}: repository must be an https://github.com/<owner>/<name> URL`,
		);
	}
	if (typeof pin?.commit !== "string" || !COMMIT.test(pin.commit)) {
		fail(`${pinPath}: commit must be a full 40-character lowercase SHA`);
	}
	return pin;
}

/** Git environment for fetching the pinned repository: never prompt, and send
 * PORTFOLIO_INDEX_TOKEN (when set) as an auth header via config variables. */
function gitEnv(pin) {
	const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
	const token = process.env.PORTFOLIO_INDEX_TOKEN;
	if (token) {
		const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
		env.GIT_CONFIG_COUNT = "1";
		env.GIT_CONFIG_KEY_0 = `http.${new URL(pin.repository).origin}/.extraheader`;
		env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
	}
	return env;
}

/** Fetch exactly the pinned commit into a fresh directory and verify it. */
function fetchSource(pin, dir) {
	const env = gitEnv(pin);
	const hint = process.env.PORTFOLIO_INDEX_TOKEN
		? ""
		: "\nportfolio-index is private: set PORTFOLIO_INDEX_TOKEN to a read-only token (CI: the PORTFOLIO_INDEX_READ_TOKEN secret).";
	run("git", ["init", "-q", dir]);
	run(
		"git",
		["-C", dir, "fetch", "-q", "--depth", "1", pin.repository, pin.commit],
		{ env },
		hint,
	);
	const fetched = run("git", ["-C", dir, "rev-parse", "FETCH_HEAD"]).trim();
	if (fetched !== pin.commit) {
		fail(`fetched ${fetched}, expected the pinned ${pin.commit}`);
	}
	run("git", [
		"-C",
		dir,
		"-c",
		"advice.detachedHead=false",
		"checkout",
		"-q",
		"FETCH_HEAD",
	]);
}

const sha256 = async (file) =>
	createHash("sha256")
		.update(await readFile(file))
		.digest("hex");

async function main() {
	const pin = await readPin();
	const work = await mkdtemp(join(tmpdir(), "portfolio-corpus-"));
	try {
		const sourceDir = sourceDirArg
			? resolve(sourceDirArg)
			: join(work, "source");
		if (!sourceDirArg) fetchSource(pin, sourceDir);
		const rebuilt = join(work, "corpus.generated.ts");
		run(process.execPath, [
			join(root, "scripts/build-corpus.mjs"),
			`--dir=${sourceDir}`,
			`--out=${rebuilt}`,
		]);
		const source = sourceDirArg
			? `${sourceDir} (local, pin not verified)`
			: `${pin.repository}@${pin.commit.slice(0, 12)}`;

		if (mode === "write") {
			await copyFile(rebuilt, corpusPath);
			console.log(`corpus-source: re-baked ${corpusPath} from ${source}`);
			return;
		}
		const [want, got] = await Promise.all([
			sha256(corpusPath),
			sha256(rebuilt),
		]);
		console.log(`committed sha256 ${want}`);
		console.log(`rebuilt   sha256 ${got}  (${source})`);
		if (want !== got) {
			fail(
				"the committed corpus does not match a rebuild from the pinned source. " +
					"Run `npm run corpus:rebake` after changing corpus.source.json, and never edit the generated file by hand.",
			);
		}
		console.log(
			"corpus-source: committed corpus matches the rebuild byte for byte",
		);
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

await main();
