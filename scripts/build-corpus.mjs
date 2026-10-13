#!/usr/bin/env node
// Bake public Layer 0 corpus artifacts into src/corpus.generated.ts.

import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const option = (name) =>
	args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const urlArg = option("--url");
const dirArg =
	option("--dir") ?? process.env.PORTFOLIO_DIR ?? "../portfolio-index";
const outputPath = resolve(
	option("--out") ??
		fileURLToPath(new URL("../src/corpus.generated.ts", import.meta.url)),
);

function errorWithFile(error, file) {
	return new Error(
		`${file}: ${error instanceof Error ? error.message : String(error)}`,
		{
			cause: error,
		},
	);
}

async function loadCorpus(read, readOptional) {
	const index = await read("corpus-index.json");
	if (!Array.isArray(index?.documents)) {
		throw new Error("corpus-index.json: expected a documents array");
	}
	const documents = Object.create(null);
	for (const item of index.documents) {
		if (typeof item?.id !== "string" || !item.id) {
			throw new Error("corpus-index.json: each document needs a non-empty id");
		}
		if (Object.hasOwn(documents, item.id)) {
			throw new Error(`corpus-index.json: duplicate document id ${item.id}`);
		}
		documents[item.id] = await read(`corpus/${item.id}.json`);
	}
	const projects = await read("projects-data.json");
	if (
		!projects?.curated ||
		typeof projects.curated !== "object" ||
		!projects.archive ||
		typeof projects.archive !== "object"
	) {
		throw new Error(
			"projects-data.json: expected curated projects and archive data",
		);
	}

	const repoProfileIndex = await readOptional("repo-profiles/index.json");
	let repoProfiles = null;
	if (repoProfileIndex) {
		if (!Array.isArray(repoProfileIndex.profiles)) {
			throw new Error("repo-profiles/index.json: expected a profiles array");
		}
		const profiles = Object.create(null);
		for (const item of repoProfileIndex.profiles) {
			if (
				typeof item?.repo_id !== "string" ||
				!item.repo_id ||
				typeof item.profile_json !== "string" ||
				!item.profile_json
			) {
				throw new Error(
					"repo-profiles/index.json: each profile needs repo_id and profile_json",
				);
			}
			if (Object.hasOwn(profiles, item.repo_id)) {
				throw new Error(
					`repo-profiles/index.json: duplicate repo_id ${item.repo_id}`,
				);
			}
			const profile = await read(`repo-profiles/${item.profile_json}`);
			if (profile?.repo_id !== item.repo_id) {
				throw new Error(
					`repo-profiles/${item.profile_json}: repo_id does not match index entry ${item.repo_id}`,
				);
			}
			profiles[item.repo_id] = profile;
		}
		repoProfiles = { index: repoProfileIndex, profiles };
	}

	const profiles = await readOptional(
		"scripts/sources/operant/calibration-profiles.json",
	);
	const figures = await readOptional(
		"scripts/sources/operant/operant-figures.json",
	);
	return {
		index,
		documents,
		projects,
		repoProfiles,
		operant: profiles && figures ? { profiles, figures } : null,
	};
}

function validateCorpus(corpus) {
	for (const item of corpus.index.documents) {
		if (typeof item.type !== "string") {
			throw new Error(`corpus-index.json: document ${item.id} has no type`);
		}
		const document = corpus.documents[item.id];
		if (!document || document.id !== item.id) {
			throw new Error(
				`corpus/${item.id}.json: document id does not match index`,
			);
		}
		if (typeof document.body_markdown !== "string") {
			throw new Error(`corpus/${item.id}.json: body_markdown must be a string`);
		}
		if (document.type !== item.type) {
			throw new Error(
				`corpus/${item.id}.json: type does not match corpus-index.json`,
			);
		}
	}
	if (
		corpus.repoProfiles &&
		corpus.repoProfiles.index.profile_count !==
			corpus.repoProfiles.index.profiles.length
	) {
		throw new Error(
			"repo-profiles/index.json: profile_count does not match profiles",
		);
	}
}

async function main() {
	const root = resolve(dirArg);
	const readDir = async (file) => {
		try {
			return JSON.parse(await readFile(join(root, file), "utf8"));
		} catch (error) {
			if (file === "corpus-index.json" && error?.code === "ENOENT") {
				throw new Error(
					`portfolio-index not found at ${root}; use --dir=<path> or --url=<https-url>`,
					{ cause: error },
				);
			}
			throw errorWithFile(error, file);
		}
	};
	const readDirOptional = async (file) => {
		try {
			return await readDir(file);
		} catch (error) {
			if (error?.cause?.code === "ENOENT" || error?.code === "ENOENT")
				return null;
			throw error;
		}
	};
	const readUrl = async (base, file, optional = false) => {
		try {
			const response = await fetch(`${base.replace(/\/$/, "")}/${file}`);
			if (optional && response.status === 404) return null;
			if (!response.ok) throw new Error(`GET ${file} -> ${response.status}`);
			return await response.json();
		} catch (error) {
			throw errorWithFile(error, file);
		}
	};
	const corpus = urlArg
		? await loadCorpus(
				(file) => readUrl(urlArg, file),
				(file) => readUrl(urlArg, file, true),
			)
		: await loadCorpus(readDir, readDirOptional);
	validateCorpus(corpus);

	const output =
		"// AUTO-GENERATED by scripts/build-corpus.mjs — do not edit by hand.\n" +
		'import type { Corpus } from "./types";\n\n' +
		`const corpus: Corpus = ${JSON.stringify(corpus)};\n\n` +
		"export default corpus;\n";
	const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, output, { flag: "wx" });
		await rename(temporaryPath, outputPath);
	} finally {
		await unlink(temporaryPath).catch(() => {});
	}
	console.log(
		`baked corpus: ${corpus.index.documents.length} docs, ` +
			`${Object.keys(corpus.projects.curated).length} curated projects ` +
			`${corpus.repoProfiles?.index.profile_count ?? 0} repo profiles ` +
			`(source: ${urlArg ?? root})`,
	);
}

await main();
