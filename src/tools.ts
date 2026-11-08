// The MCP tools as pure functions behind a factory: no SDK, no transport,
// no I/O. createTools(corpus) builds the BM25 index once and returns the tool
// set; server.ts wires these into MCP, tests call them with a fixture corpus.

import { Bm25, type SearchDoc, snippet } from "./bm25";
import type {
	ArchiveSummary,
	Corpus,
	CountPair,
	DocType,
	FullDoc,
	GalleryCard,
	IndexRecord,
	ProjectGalleryView,
	ProjectRecord,
	ProjectTimelineView,
	RepoProfile,
	RepoProfileIndex,
	RepoProfileIndexRecord,
	TimelineEvent,
	TimelineMonth,
} from "./types";

/** Keep only well-formed [label, count] pairs from an untyped aggregate list. */
function countPairs(list: unknown[]): CountPair[] {
	const pairs: CountPair[] = [];
	for (const item of list) {
		if (
			Array.isArray(item) &&
			typeof item[0] === "string" &&
			typeof item[1] === "number"
		) {
			pairs.push([item[0], item[1]]);
		}
	}
	return pairs;
}

/** Only https links leave the server as clickable URLs. */
function httpsUrl(value: string | undefined): string | null {
	if (!value) return null;
	try {
		return new URL(value).protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

/** Newest first, undated last, then by name. */
function byRecency(a: GalleryCard, b: GalleryCard): number {
	if (a.last_active !== b.last_active) {
		if (!a.last_active) return 1;
		if (!b.last_active) return -1;
		return a.last_active < b.last_active ? 1 : -1;
	}
	return a.name.localeCompare(b.name);
}

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
		for (const hit of index.search(query, searchDocs.length)) {
			if (!Object.hasOwn(corpus.documents, hit.id)) continue;
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
		return Object.hasOwn(corpus.documents, id)
			? corpus.documents[id]
			: {
					error: `No document with id "${id}". Call list_corpus to see available ids.`,
				};
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
			Object.hasOwn(corpus.documents, id)
				? (corpus.documents[id]?.body_markdown ?? "")
				: "";
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

	/** list_repo_profiles: the public-safe repo answering profile index. */
	function listRepoProfiles(
		opts: { attentionState?: string; limit?: number } = {},
	):
		| {
				available: true;
				generated_at: string;
				count: number;
				profiles: RepoProfileIndexRecord[];
				public_safety: RepoProfileIndex["public_safety"];
		  }
		| { available: false; note: string } {
		const repoProfiles = corpus.repoProfiles;
		if (!repoProfiles) {
			return {
				available: false,
				note: "No public repo-profile dataset is baked into this server build.",
			};
		}
		let profiles = repoProfiles.index.profiles;
		if (opts.attentionState) {
			profiles = profiles.filter(
				(profile) => profile.attention_state === opts.attentionState,
			);
		}
		if (opts.limit) profiles = profiles.slice(0, Math.max(opts.limit, 1));
		return {
			available: true,
			generated_at: repoProfiles.index.generated_at,
			count: profiles.length,
			profiles,
			public_safety: repoProfiles.index.public_safety,
		};
	}

	/** get_repo_profile: one public-safe repo answering profile by repo id. */
	function getRepoProfile(repoId: string): RepoProfile | { error: string } {
		const repoProfiles = corpus.repoProfiles;
		if (!repoProfiles) {
			return {
				error:
					"No public repo-profile dataset is baked into this server build.",
			};
		}
		return Object.hasOwn(repoProfiles.profiles, repoId)
			? repoProfiles.profiles[repoId]
			: {
					error: `No repo profile with repo_id "${repoId}". Call list_repo_profiles to see available ids.`,
				};
	}

	/** get_operant_results: the public, sanitized OPERANT calibration results
	 * (per-model OCS profiles + headline figures). Returns availability + note
	 * when no public dataset was baked. */
	function getOperantResults(): Record<string, unknown> {
		const op = corpus.operant;
		if (!op) {
			return {
				available: false,
				note: "No public OPERANT dataset is baked into this server build.",
			};
		}
		const fig = op.figures;
		return {
			available: true,
			headline: fig.headline ?? null,
			metric: fig.metric ?? null,
			decision: fig.decision ?? null,
			framing: op.profiles.presentation ?? null,
			models: op.profiles.models,
			provenance: fig._provenance ?? null,
			links: fig.links ?? null,
		};
	}

	/** Archive aggregates with the untyped lists narrowed to [label, count]. */
	function archiveSummary(): ArchiveSummary {
		const a = corpus.projects.archive;
		return {
			total: a.total,
			maintained: a.maintained,
			tested: a.tested,
			ci: a.ci,
			shown: a.shown,
			stacks: countPairs(a.stacks),
			lifecycle: countPairs(a.lifecycle),
		};
	}

	/** Curated projects joined with their public repo profile, newest first. */
	function galleryCards(): GalleryCard[] {
		const profiles = corpus.repoProfiles?.profiles ?? {};
		return Object.entries(corpus.projects.curated)
			.map(([slug, p]): GalleryCard => {
				const profile = Object.hasOwn(profiles, slug)
					? profiles[slug]
					: undefined;
				const purpose = profile?.summary.purpose;
				return {
					slug,
					name: profile?.display_name || slug,
					category: profile?.summary.category || null,
					purpose: purpose && purpose !== "unknown" ? purpose : null,
					stack: p.stack,
					status: p.status,
					lifecycle: p.lifecycle,
					last_active: p.last_active,
					tests: p.tests,
					ci: p.ci,
					url: httpsUrl(profile?.public_reference),
				};
			})
			.sort(byRecency);
	}

	/** show_project_gallery: the data behind the gallery app. Empty filters mean
	 * no filter; lifecycle "none" selects projects with no declared lifecycle,
	 * matching the app's "No lifecycle" chip. */
	function projectGallery(
		opts: { status?: string; lifecycle?: string } = {},
	): ProjectGalleryView {
		const status = opts.status || null;
		const lifecycle = opts.lifecycle || null;
		const cards = galleryCards().filter(
			(c) =>
				(!status || c.status === status) &&
				(!lifecycle ||
					(lifecycle === "none"
						? c.lifecycle === null
						: c.lifecycle === lifecycle)),
		);
		return {
			view: "gallery",
			generated_at: corpus.projects.generated_at,
			filters: { status, lifecycle },
			count: cards.length,
			cards,
			archive: archiveSummary(),
		};
	}

	/** show_project_timeline: curated projects grouped by last-active month. */
	function projectTimeline(): ProjectTimelineView {
		const cards = galleryCards();
		const months = new Map<string, TimelineEvent[]>();
		const undated: string[] = [];
		for (const c of cards) {
			if (!c.last_active) {
				undated.push(c.slug);
				continue;
			}
			const month = c.last_active.slice(0, 7);
			const events = months.get(month) ?? [];
			events.push({
				date: c.last_active,
				slug: c.slug,
				name: c.name,
				lifecycle: c.lifecycle,
				status: c.status,
				stack: c.stack,
				url: c.url,
			});
			months.set(month, events);
		}
		const grouped: TimelineMonth[] = [...months.entries()].map(
			([month, events]) => ({ month, events }),
		);
		return {
			view: "timeline",
			title: "Project timeline",
			basis:
				"Each project sits at its last-active date in the public portfolio audit.",
			generated_at: corpus.projects.generated_at,
			count: cards.length - undated.length,
			undated,
			months: grouped,
			archive: archiveSummary(),
		};
	}

	return {
		search,
		getDocument,
		listCorpus,
		getProfile,
		listProjects,
		listRepoProfiles,
		getRepoProfile,
		getOperantResults,
		projectGallery,
		projectTimeline,
	};
}
