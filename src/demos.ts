// Playable demos rebuilt from public corpus pages. Pure: takes the baked
// corpus, returns plain view data. Only pages whose mechanics are fully
// described in their own text are used, so nothing here is invented: the
// Interleaving Explorer (two writers, six schedules, warn vs enforce) and the
// Agent Failure Museum (synthetic failures and the controls that catch them).

import type {
	Corpus,
	DemoName,
	DemoView,
	InterleavingDemoView,
	MuseumDemoView,
	MuseumExhibit,
} from "./types";

const INTERLEAVING_ID = "interleaving-explorer";
const MUSEUM_ID = "agent-failure-museum/index";

/** Markdown-ish page text to plain prose: collapse whitespace, drop emphasis
 * and inline-code markers, and turn [text](url) links into their text. */
export function plain(text: string): string {
	return text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[*`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Paragraphs of the section under `## heading`, or of the lead when the
 * heading is null (everything before the first `## `). */
export function sectionParagraphs(
	body: string,
	heading: string | null,
): string[] {
	let text: string;
	if (heading === null) {
		text = body.split(/\n## /)[0] ?? "";
	} else {
		const start = body.indexOf(`\n## ${heading}\n`);
		if (start < 0) return [];
		const rest = body.slice(start + heading.length + 5);
		const next = rest.indexOf("\n## ");
		text = next < 0 ? rest : rest.slice(0, next);
	}
	return text
		.split(/\n\s*\n/)
		.map(plain)
		.filter((p) => p.length > 0);
}

const FIELD_ENDS = [
	"### Why it is tempting",
	"### What goes wrong",
	"**Control that catches it**",
	"**Still uncertain**",
	"**Fire the failure**",
	"\n[",
];

function field(chunk: string, start: string): string | null {
	const i = chunk.indexOf(start);
	if (i < 0) return null;
	const rest = chunk.slice(i + start.length);
	let cut = rest.length;
	for (const end of FIELD_ENDS) {
		const j = rest.indexOf(end);
		if (j >= 0 && j < cut) cut = j;
	}
	const value = plain(rest.slice(0, cut));
	return value || null;
}

/** Each `## ` section of the museum page that carries all five exhibit
 * fields; the category label is the short line right before its heading. */
export function parseExhibits(body: string): MuseumExhibit[] {
	const chunks = body.split(/\n## /);
	const exhibits: MuseumExhibit[] = [];
	for (let i = 1; i < chunks.length; i++) {
		const chunk = chunks[i] ?? "";
		const title = plain(chunk.split("\n")[0] ?? "");
		const failure = field(chunk, "**Synthetic failure**");
		const tempting = field(chunk, "### Why it is tempting");
		const wrong = field(chunk, "### What goes wrong");
		const control = field(chunk, "**Control that catches it**");
		const uncertain = field(chunk, "**Still uncertain**");
		if (!title || !failure || !tempting || !wrong || !control || !uncertain) {
			continue;
		}
		const before = (chunks[i - 1] ?? "").trimEnd().split("\n");
		const label = plain(before[before.length - 1] ?? "");
		exhibits.push({
			category: /^[A-Z][A-Za-z ]{1,24}$/.test(label) ? label : null,
			title,
			failure,
			tempting,
			wrong,
			control,
			uncertain,
		});
	}
	return exhibits;
}

function unavailable(demo: DemoName, note: string): DemoView {
	return { view: "demo", demo, available: false, note };
}

export function interleavingDemo(corpus: Corpus): DemoView {
	const doc = Object.hasOwn(corpus.documents, INTERLEAVING_ID)
		? corpus.documents[INTERLEAVING_ID]
		: undefined;
	if (!doc) {
		return unavailable(
			"interleaving",
			"The Interleaving Explorer page is not in this build's corpus.",
		);
	}
	const body = doc.body_markdown;
	const sweep =
		sectionParagraphs(body, "The sweep that flipped a default").find((p) =>
			/seeds reached the lost update/i.test(p),
		) ?? null;
	const view: InterleavingDemoView = {
		view: "demo",
		demo: "interleaving",
		available: true,
		title: doc.title,
		url: doc.url,
		intro: sectionParagraphs(body, null).slice(0, 3),
		receipt: sectionParagraphs(body, "The receipt")[0] ?? null,
		sweep,
		small_print: sectionParagraphs(body, "Honest small print")[0] ?? null,
		initial: { content: "baseline content", version: 1 },
	};
	return view;
}

export function museumDemo(corpus: Corpus): DemoView {
	const doc = Object.hasOwn(corpus.documents, MUSEUM_ID)
		? corpus.documents[MUSEUM_ID]
		: undefined;
	if (!doc) {
		return unavailable(
			"failure-museum",
			"The Agent Failure Museum page is not in this build's corpus.",
		);
	}
	const exhibits = parseExhibits(doc.body_markdown);
	if (exhibits.length < 3) {
		return unavailable(
			"failure-museum",
			"The Agent Failure Museum page has too few exhibits to play.",
		);
	}
	const lead = sectionParagraphs(doc.body_markdown, null);
	const view: MuseumDemoView = {
		view: "demo",
		demo: "failure-museum",
		available: true,
		title: doc.title,
		url: doc.url,
		intro: lead.slice(0, 1),
		fixture_rule: lead.find((p) => p.startsWith("Fixture rule")) ?? null,
		exhibits,
	};
	return view;
}

export function demoView(corpus: Corpus, demo: DemoName): DemoView {
	return demo === "failure-museum"
		? museumDemo(corpus)
		: interleavingDemo(corpus);
}
