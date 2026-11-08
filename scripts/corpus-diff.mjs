#!/usr/bin/env node
// Readable summary of what a re-bake changed in the generated corpus.
//
// src/corpus.generated.ts is one 1.6 MB line, so a re-bake PR's git diff is
// unreadable and too large for a reviewer. The rebuild-and-hash check proves
// the bytes; this script says what they mean: which documents, projects, repo
// profiles and OPERANT figures were added, removed or changed, and in which
// fields.
//
//   node scripts/corpus-diff.mjs <before.generated.ts> <after.generated.ts>
//
// Prints Markdown to stdout (CI appends it to the job summary). It reads only
// the two files it is given and never fails a build over content: exit 1 means
// a file could not be read or parsed.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PREFIX = "const corpus: Corpus = ";
const SUFFIX = ";\n\nexport default corpus;";
/** Entries listed per section before the rest are counted, not named. */
const MAX_LISTED = 40;
/** Scalar values longer than this are named, not shown. */
const MAX_VALUE = 40;

/** Parse the corpus object out of a generated corpus.generated.ts text. */
export function parseGenerated(text) {
	const start = text.indexOf(PREFIX);
	const end = text.lastIndexOf(SUFFIX);
	if (start === -1 || end === -1 || end < start) {
		throw new Error("not a generated corpus file (corpus literal not found)");
	}
	return JSON.parse(text.slice(start + PREFIX.length, end));
}

const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const omit = (value, keys) =>
	isObject(value)
		? Object.fromEntries(
				Object.entries(value).filter(([key]) => !keys.includes(key)),
			)
		: value;

const KNOWN = ["index", "documents", "projects", "repoProfiles", "operant"];

/** Each section is a keyed object compared entry by entry. The index's and the
 * repo-profile index's own lists are compared separately, in LIST_SECTIONS. */
const SECTIONS = [
	{
		label: "Documents",
		get: (c) => c.documents,
		title: (d) => d?.title,
	},
	{ label: "Index fields", get: (c) => omit(c.index, ["documents"]) },
	{ label: "Curated projects", get: (c) => c.projects?.curated },
	{ label: "Projects fields", get: (c) => omit(c.projects, ["curated"]) },
	{
		label: "Repo profiles",
		get: (c) => c.repoProfiles?.profiles,
		title: (p) => p?.display_name,
	},
	{
		label: "Repo profile index fields",
		get: (c) => omit(c.repoProfiles?.index, ["profiles"]),
	},
	{ label: "OPERANT figures", get: (c) => c.operant?.figures },
	{ label: "OPERANT profile fields", get: (c) => c.operant?.profiles },
	{ label: "Other top-level sections", get: (c) => omit(c, KNOWN) },
];

/** Index lists that MCP list responses serve, in order. The generator does not
 * make them mirror their keyed records, so each is compared by id, field and
 * order. A change that exactly mirrors the keyed record's (same field, same
 * before and after) is already reported there and is not repeated. */
const LIST_SECTIONS = [
	{
		label: "Index document list",
		list: (c) => c.index?.documents,
		id: (r) => r?.id,
		mirror: (c) => c.documents,
		title: (r) => r?.title,
	},
	{
		label: "Repo profile index list",
		list: (c) => c.repoProfiles?.index?.profiles,
		id: (r) => r?.repo_id,
		mirror: (c) => c.repoProfiles?.profiles,
		title: (r) => r?.display_name,
	},
];

/** A short display of a scalar, or null when it is too long or not a scalar. */
function shortValue(value) {
	if (value !== null && typeof value === "object") return null;
	const text = JSON.stringify(value) ?? "undefined";
	return text.length <= MAX_VALUE ? text : null;
}

/** How one entry changed: its differing fields, with before → after for short
 * scalars; an entry that is itself a scalar shows its own before → after. */
function entryChange(before, after) {
	if (!isObject(before) || !isObject(after)) {
		const a = shortValue(before);
		const b = shortValue(after);
		return { fields: [], value: a !== null && b !== null ? [a, b] : null };
	}
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
	const fields = keys
		.filter((key) => !same(before[key], after[key]))
		.map((key) => {
			const a = shortValue(before[key]);
			const b = shortValue(after[key]);
			return { name: key, value: a !== null && b !== null ? [a, b] : null };
		});
	return { fields, value: null };
}

/** Own keys only: a key such as "constructor" is data, not Object.prototype. */
const has = (object, key) => isObject(object) && Object.hasOwn(object, key);

function diffKeyed(before, after, title) {
	const a = isObject(before) ? before : {};
	const b = isObject(after) ? after : {};
	const titled = (key, entry) => ({ key, title: title?.(entry) ?? null });
	return {
		added: Object.keys(b)
			.filter((key) => !has(a, key))
			.map((key) => titled(key, b[key])),
		removed: Object.keys(a)
			.filter((key) => !has(b, key))
			.map((key) => titled(key, a[key])),
		changed: Object.keys(b)
			.filter((key) => has(a, key) && !same(a[key], b[key]))
			.map((key) => ({
				...titled(key, b[key]),
				...entryChange(a[key], b[key]),
			})),
	};
}

const asList = (value) => (Array.isArray(value) ? value : []);

function diffList(section, before, after) {
	const ids = (list) => asList(list).map((r) => String(section.id(r)));
	const keyBy = (list) =>
		Object.fromEntries(asList(list).map((r) => [String(section.id(r)), r]));
	const lb = keyBy(section.list(before));
	const la = keyBy(section.list(after));
	const kb = section.mirror(before);
	const ka = section.mirror(after);
	const mirrored = (key, field) =>
		same(lb[key]?.[field], kb?.[key]?.[field]) &&
		same(la[key]?.[field], ka?.[key]?.[field]);
	const diff = diffKeyed(lb, la, section.title);
	const added = diff.added.filter(
		({ key }) =>
			!(
				has(ka, key) &&
				!has(kb, key) &&
				Object.keys(la[key] ?? {}).every((field) =>
					same(la[key][field], ka[key][field]),
				)
			),
	);
	const removed = diff.removed.filter(
		({ key }) => !(has(kb, key) && !has(ka, key)),
	);
	const changed = diff.changed
		.map((entry) => ({
			...entry,
			fields: entry.fields.filter((f) => !mirrored(entry.key, f.name)),
		}))
		.filter((entry) => entry.value || entry.fields.length > 0);
	// Order of the entries present on both sides; additions and removals alone
	// do not count as a reorder.
	const order = !same(
		ids(section.list(before)).filter((key) => has(la, key)),
		ids(section.list(after)).filter((key) => has(lb, key)),
	);
	return { added, removed, changed, order };
}

const hasChange = (s) =>
	s.order || s.added.length + s.removed.length + s.changed.length > 0;

/** Structured summary of the change from one corpus to another. */
export function summarize(before, after) {
	return {
		documents: {
			before: Object.keys(before.documents ?? {}).length,
			after: Object.keys(after.documents ?? {}).length,
		},
		sections: [
			...SECTIONS.map((section) => ({
				label: section.label,
				order: false,
				...diffKeyed(section.get(before), section.get(after), section.title),
			})),
			...LIST_SECTIONS.map((section) => ({
				label: section.label,
				...diffList(section, before, after),
			})),
		].filter(hasChange),
	};
}

/** Corpus text is data from the source repository: flatten it to one line and
 * escape inline Markdown and HTML so it renders as plain text. It never starts
 * a line, so block markers (#, -, +) need no escape. */
function text(value) {
	const flat = String(value).replace(/\s+/g, " ").trim();
	const cut = flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
	return cut.replace(/[\\`*_[\]<>|~]/g, "\\$&");
}
const code = (value) => `\`${String(value).replace(/[`\s]+/g, " ")}\``;
const arrow = ([a, b]) => `${text(a)} → ${text(b)}`;

function entryLine(mark, entry) {
	let line = `- ${mark} ${code(entry.key)}`;
	if (entry.title) line += ` ${text(entry.title)}`;
	if (entry.value) line += `: ${arrow(entry.value)}`;
	if (entry.fields?.length) {
		const fields = entry.fields.map((f) =>
			f.value ? `${code(f.name)} ${arrow(f.value)}` : code(f.name),
		);
		line += `: ${fields.join(", ")}`;
	}
	return line;
}

/** Render a summary as Markdown for a CI job summary or a terminal. */
export function render(summary, sizes) {
	const lines = ["## Corpus re-bake summary", ""];
	let docs = `Documents: ${summary.documents.before} → ${summary.documents.after}`;
	if (sizes) docs += ` · file size: ${sizes.before} → ${sizes.after} bytes`;
	lines.push(docs, "");
	if (summary.sections.length === 0) {
		lines.push("No content change.");
		return `${lines.join("\n")}\n`;
	}
	for (const section of summary.sections) {
		const counts = [
			`${section.added.length} added`,
			`${section.removed.length} removed`,
			`${section.changed.length} changed`,
			...(section.order ? ["order changed"] : []),
		].join(", ");
		lines.push(`### ${section.label} (${counts})`, "");
		if (section.order) {
			lines.push(
				"- order changed: a limited list response can return other entries",
			);
		}
		const entries = [
			...section.added.map((e) => entryLine("added", e)),
			...section.removed.map((e) => entryLine("removed", e)),
			...section.changed.map((e) => entryLine("changed", e)),
		];
		lines.push(...entries.slice(0, MAX_LISTED));
		if (entries.length > MAX_LISTED) {
			lines.push(`- …and ${entries.length - MAX_LISTED} more`);
		}
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

async function main(args) {
	if (args.length !== 2) {
		throw new Error(
			"usage: corpus-diff.mjs <before.generated.ts> <after.generated.ts>",
		);
	}
	const [beforeText, afterText] = await Promise.all(
		args.map((file) => readFile(resolve(file), "utf8")),
	);
	const summary = summarize(
		parseGenerated(beforeText),
		parseGenerated(afterText),
	);
	const sizes = {
		before: Buffer.byteLength(beforeText),
		after: Buffer.byteLength(afterText),
	};
	process.stdout.write(render(summary, sizes));
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(`corpus-diff: ${error.message}`);
		process.exitCode = 1;
	}
}
