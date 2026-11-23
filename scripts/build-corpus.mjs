#!/usr/bin/env node
// Bake public Layer 0 corpus artifacts into src/corpus.generated.ts.

import { randomUUID } from "node:crypto";
import {
	readFile,
	realpath,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
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

// These references become both filesystem paths and URL paths. Keep each
// segment literal so both readers resolve it beneath the supplied directory.
function validateReference(reference, indexFile) {
	const segments = reference.split("/");
	if (
		/[\\%?#:]|\p{Cc}/u.test(reference) ||
		segments.some((part) => part === "" || part === "." || part === "..")
	) {
		throw new Error(
			`${indexFile}: invalid artifact reference ${JSON.stringify(reference)}`,
		);
	}
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
		validateReference(item.id, "corpus-index.json");
		documents[item.id] = await read(`corpus/${item.id}.json`, "corpus");
	}
	const projects = await read("projects-data.json");
	if (projects?.public !== true) {
		throw new Error("projects-data.json: public must be true");
	}
	if (
		!projects?.curated ||
		typeof projects.curated !== "object" ||
		Array.isArray(projects.curated) ||
		!projects.archive ||
		typeof projects.archive !== "object"
	) {
		throw new Error(
			"projects-data.json: expected curated projects and archive data",
		);
	}

	const repoProfileIndex = await readOptional("repo-profiles/index.json");
	let repoProfiles = null;
	if (repoProfileIndex !== undefined) {
		if (!Array.isArray(repoProfileIndex?.profiles)) {
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
			validateReference(item.profile_json, "repo-profiles/index.json");
			const profile = await read(
				`repo-profiles/${item.profile_json}`,
				"repo-profiles",
			);
			if (profile?.repo_id !== item.repo_id) {
				throw new Error(
					`repo-profiles/${item.profile_json}: repo_id does not match index entry ${item.repo_id}`,
				);
			}
			profiles[item.repo_id] = profile;
		}
		repoProfiles = { index: repoProfileIndex, profiles };
	}

	const profilesFile = "scripts/sources/operant/calibration-profiles.json";
	const figuresFile = "scripts/sources/operant/operant-figures.json";
	const profiles = await readOptional(profilesFile);
	const figures = await readOptional(figuresFile);
	let operant = null;
	if (profiles !== undefined || figures !== undefined) {
		if (profiles === undefined || figures === undefined) {
			const missing = profiles === undefined ? profilesFile : figuresFile;
			throw new Error(`${missing}: both OPERANT files are required`);
		}
		if (!Array.isArray(profiles?.models)) {
			throw new Error(`${profilesFile}: expected a models array`);
		}
		if (!figures || typeof figures !== "object" || Array.isArray(figures)) {
			throw new Error(`${figuresFile}: expected a figures object`);
		}
		operant = { profiles, figures };
	}
	return {
		index,
		documents,
		projects,
		repoProfiles,
		operant,
	};
}

function validateCorpus(corpus) {
	const tally = new Map();
	for (const item of corpus.index.documents) {
		if (typeof item.title !== "string") {
			throw new Error(
				`corpus-index.json: document ${item.id} title must be a string`,
			);
		}
		if (typeof item.type !== "string") {
			throw new Error(`corpus-index.json: document ${item.id} has no type`);
		}
		tally.set(item.type, (tally.get(item.type) ?? 0) + 1);
		const document = corpus.documents[item.id];
		if (!document || document.id !== item.id) {
			throw new Error(
				`corpus/${item.id}.json: document id does not match index`,
			);
		}
		if (typeof document.title !== "string") {
			throw new Error(`corpus/${item.id}.json: title must be a string`);
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
	const { counts } = corpus.index;
	if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
		throw new Error("corpus-index.json: expected a counts object");
	}
	for (const type of new Set([...tally.keys(), ...Object.keys(counts)])) {
		const expected = tally.get(type) ?? 0;
		if (counts[type] !== expected) {
			throw new Error(
				`corpus-index.json: expected ${type} count ${expected}, got ${counts[type]}`,
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
	const readDir = async (file, artifactDir) => {
		try {
			let path = join(root, file);
			if (artifactDir) {
				path = await realpath(path);
				const directory = join(await realpath(root), artifactDir);
				if (!path.startsWith(directory + sep)) {
					throw new Error(`resolved path is outside ${artifactDir}`);
				}
			}
			return JSON.parse(await readFile(path, "utf8"));
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
				return undefined;
			throw error;
		}
	};
	const readUrl = async (file, artifactDir, optional = false) => {
		try {
			const path = file.split("/").map(encodeURIComponent).join("/");
			const response = await fetch(`${urlArg.replace(/\/$/, "")}/${path}`, {
				redirect: artifactDir ? "error" : "follow",
			});
			if (optional && response.status === 404) return undefined;
			if (!response.ok) throw new Error(`GET ${file} -> ${response.status}`);
			return await response.json();
		} catch (error) {
			throw errorWithFile(error, file);
		}
	};
	const corpus = urlArg
		? await loadCorpus(readUrl, (file) => readUrl(file, undefined, true))
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
