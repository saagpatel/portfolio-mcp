// The five MCP tools as PURE functions behind a factory: no SDK, no transport,
// no I/O. createTools(corpus) builds the BM25 index once and returns the tool
// set; src/index.ts wires these into MCP, tests call them with a fixture corpus.

import { Bm25, type SearchDoc, snippet } from "./bm25";
import type {
	Corpus,
	DocType,
	FullDoc,
	IndexRecord,
	ProjectRecord,
} from "./types";

export interface SearchResult {
	id: string;
	slug: string;
	type: DocType;
	title: string;
	url: string;
	date: string | null;
	score: number;
	snippet: string;
}

export function createTools(corpus: Corpus) {
	const searchDocs: SearchDoc[] = Object.values(corpus.documents).map((d) => ({
		id: d.id,
		title: d.title,
		text: `${d.description} ${d.body_markdown}`,
	}));
	const index = new Bm25(searchDocs);

	/** search: BM25 over the whole corpus, optionally filtered to one section. */
	function search(
		query: string,
		opts: { section?: DocType; limit?: number } = {},
	): { query: string; count: number; results: SearchResult[] } {
		const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
		const results: SearchResult[] = [];
		for (const hit of index.search(query, 50)) {
			const d = corpus.documents[hit.id];
			if (!d) continue;
			if (opts.section && d.type !== opts.section) continue;
			results.push({
				id: d.id,
				slug: d.slug,
				type: d.type,
				title: d.title,
				url: d.url,
				date: d.date,
				score: Number(hit.score.toFixed(4)),
				snippet: snippet(d.body_markdown || d.description, query),
			});
			if (results.length >= limit) break;
		}
		return { query, count: results.length, results };
	}

	/** get_document: the full Markdown of one document by id. */
	function getDocument(id: string): FullDoc | { error: string } {
		return (
			corpus.documents[id] ?? {
				error: `No document with id "${id}". Call list_corpus to see available ids.`,
			}
		);
	}

	/** list_corpus: the table of contents, optionally filtered by type. */
	function listCorpus(opts: { type?: DocType } = {}): {
		counts: Record<string, number>;
		count: number;
		documents: IndexRecord[];
	} {
		const docs = opts.type
			? corpus.index.documents.filter((d) => d.type === opts.type)
			: corpus.index.documents;
		return { counts: corpus.index.counts, count: docs.length, documents: docs };
	}

	/** get_profile: the agent's "who is this" card, from about/now/uses. */
	function getProfile(): {
		name: string;
		summary: string;
		site: string;
		about: string;
		now: string;
		uses: string;
	} {
		const body = (id: string): string =>
			corpus.documents[id]?.body_markdown ?? "";
		return {
			name: corpus.index.title,
			summary: corpus.index.summary,
			site: corpus.index.site,
			about: body("about/index"),
			now: body("now/index"),
			uses: body("uses/index"),
		};
	}

	/** list_projects: the curated, public-safe project set + anonymized aggregates. */
	function listProjects(opts: { status?: string; limit?: number } = {}): {
		count: number;
		projects: ProjectRecord[];
		archive: Corpus["projects"]["archive"];
	} {
		let projects: ProjectRecord[] = Object.entries(corpus.projects.curated).map(
			([slug, v]) => ({
				slug,
				...v,
			}),
		);
		if (opts.status)
			projects = projects.filter((p) => p.status === opts.status);
		if (opts.limit) projects = projects.slice(0, Math.max(opts.limit, 1));
		return {
			count: projects.length,
			projects,
			archive: corpus.projects.archive,
		};
	}

	return { search, getDocument, listCorpus, getProfile, listProjects };
}

export type Tools = ReturnType<typeof createTools>;
